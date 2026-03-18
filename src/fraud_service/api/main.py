import json
import logging
import math
import os
import random
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import make_asgi_app

from fraud_service.api.constants import (
    ACTION_FALLBACK,
    ACTION_MANUAL,
    ACTION_CODES,
    REASON_CODES,
    REASON_DATA_CONTRACT,
    FALLBACK_SCHEMA_MISMATCH,
)
from fraud_service.api.decisions import decide_action
from fraud_service.api.schemas import (
    ActionCode,
    ApiReadiness,
    DriftInfo,
    PredictContract,
    PredictRequest,
    PredictResponse,
    ReasonCode,
)
from fraud_service.drift.emitter import RetrainEmitter
from fraud_service.drift.request_store import RecentPredictFeatureStore
from fraud_service.drift.retrain import RetrainTrigger
from fraud_service.modeling.predict import BundleManager, predict_one
from fraud_service.monitoring.metrics import (
    ACTIVE_EVAL_LABELED_CORRECT,
    ACTIVE_EVAL_LABELED_TOTAL,
    ACTIONS,
    DRIFT_READY,
    DRIFT_SCORE,
    FEATURE_HARD_COUNT,
    FEATURE_SOFT_COUNT,
    P_FRAUD,
    REQS,
    REQUEST_LATENCY,
    RETRAIN_TRIGGERS,
    SHADOW_DRIFT_READY,
    SHADOW_DRIFT_SCORE,
    SHADOW_DISAGREE,
    SHADOW_EVAL_LABELED_CORRECT,
    SHADOW_EVAL_LABELED_TOTAL,
    SHADOW_P_FRAUD,
    SHADOW_RUNS,
)
from fraud_service.utils.config_validator import ConfigValidationError, validate_config, validate_cors_origins

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = PROJECT_ROOT / "config.yaml"
PROMETHEUS_UPSTREAM = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
CONTRACT_VERSION = "2026-02-23"

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
if ENVIRONMENT == "production":
    cors_origins_str = os.getenv("CORS_ORIGINS", "")
    CORS_ORIGINS = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
    if not CORS_ORIGINS:
        logger.warning("No CORS origins configured for production. Set CORS_ORIGINS environment variable.")
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3001",
    ]


@dataclass
class DomainRuntime:
    schema_version: int
    config_path: Path
    manager: BundleManager
    retrain_trigger: RetrainTrigger
    emitter: RetrainEmitter
    shadow_sampling_rate: float
    feature_store: RecentPredictFeatureStore | None


def _build_domain_runtime(config_path: Path) -> DomainRuntime:
    manager = BundleManager(str(config_path))
    cfg = manager.cfg
    validate_config(cfg, str(config_path))

    retrain_trigger = RetrainTrigger(
        soft_thr=float(cfg["drift"]["soft_threshold"]),
        hard_thr=float(cfg["drift"]["hard_threshold"]),
        required_hard_windows=int(cfg["drift"].get("required_hard_windows", 3)),
    )

    repo_root = Path(cfg.get("paths", {}).get("repo_root", PROJECT_ROOT)).resolve()
    requests_dir = cfg.get("paths", {}).get("retrain_requests_dir", "artifacts/retrain_requests")
    requests_dir_path = Path(requests_dir)
    if not requests_dir_path.is_absolute():
        requests_dir_path = (repo_root / requests_dir_path).resolve()
    requests_dir_path.mkdir(parents=True, exist_ok=True)

    emitter = RetrainEmitter(
        request_dir=str(requests_dir_path),
        cooldown_seconds=float(cfg.get("retrain", {}).get("cooldown_seconds", 600)),
        max_pending=int(cfg.get("retrain", {}).get("max_pending", 1)),
    )

    recent_features_path = cfg.get("paths", {}).get(
        "recent_predict_features_path",
        "artifacts/retrain_requests/recent_predict_features.jsonl",
    )
    recent_features_path = Path(recent_features_path)
    if not recent_features_path.is_absolute():
        recent_features_path = (repo_root / recent_features_path).resolve()

    feature_store = RecentPredictFeatureStore(
        path=str(recent_features_path),
        max_entries=int(cfg.get("retrain", {}).get("recent_requests_max", 5000)),
        compact_every=int(cfg.get("retrain", {}).get("recent_requests_compact_every", 100)),
    )

    active = manager.get_active()
    logger.info("Loaded active bundle at startup (%s): %s", config_path.name, active.model_version)

    schema_version = int(cfg.get("schema", {}).get("version", 1))
    return DomainRuntime(
        schema_version=schema_version,
        config_path=config_path,
        manager=manager,
        retrain_trigger=retrain_trigger,
        emitter=emitter,
        shadow_sampling_rate=float(cfg.get("shadow", {}).get("sampling_rate", 1.0)),
        feature_store=feature_store,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.bootstrap_error = None
    app.state.ready = False
    app.state.domains = {}
    app.state.secondary_config_paths = []
    app.state.contract_version = CONTRACT_VERSION

    try:
        validate_cors_origins(CORS_ORIGINS, ENVIRONMENT)
        logger.info("CORS configured for %s with origins: %s", ENVIRONMENT, CORS_ORIGINS)

        runtimes: dict[int, DomainRuntime] = {}
        primary_runtime = _build_domain_runtime(CONFIG_PATH)
        runtimes[primary_runtime.schema_version] = primary_runtime

        secondary_cfgs_env = os.getenv("SECONDARY_CONFIG_PATHS")
        if secondary_cfgs_env:
            secondary_paths = [Path(p.strip()) for p in secondary_cfgs_env.split(",") if p.strip()]
            strict_secondary = True
        else:
            secondary_paths = [PROJECT_ROOT / "config_ieee.yaml"]
            strict_secondary = False
        app.state.secondary_config_paths = [str(p) for p in secondary_paths]

        for secondary in secondary_paths:
            secondary_path = secondary if secondary.is_absolute() else (PROJECT_ROOT / secondary)
            if not secondary_path.exists():
                if strict_secondary:
                    raise FileNotFoundError(f"Secondary config not found: {secondary_path}")
                continue
            try:
                runtime = _build_domain_runtime(secondary_path)
            except Exception as e:
                if strict_secondary:
                    raise
                logger.warning(
                    "Skipping optional secondary config %s due to startup error: %s",
                    secondary_path,
                    e,
                )
                continue
            if runtime.schema_version in runtimes:
                raise ValueError(
                    f"Duplicate schema.version {runtime.schema_version} across configs: "
                    f"{runtimes[runtime.schema_version].config_path} and {secondary_path}"
                )
            runtimes[runtime.schema_version] = runtime
            logger.info(
                "Loaded secondary schema runtime: schema_version=%s from %s",
                runtime.schema_version,
                secondary_path,
            )

        for schema_version in runtimes:
            schema_label = str(schema_version)
            DRIFT_READY.labels(schema_version=schema_label).set(0.0)
            SHADOW_DRIFT_READY.labels(schema_version=schema_label).set(0.0)

        # Primary fields retained for backward compatibility in existing endpoints.
        app.state.domains = runtimes
        primary = runtimes.get(1) or runtimes[min(runtimes.keys())]
        app.state.manager = primary.manager
        app.state.retrain_trigger = primary.retrain_trigger
        app.state.emitter = primary.emitter
        app.state.feature_store = primary.feature_store
        app.state.shadow_sampling_rate = float(primary.shadow_sampling_rate)
        app.state.ready = True
    except Exception as e:
        app.state.bootstrap_error = str(e)
        app.state.ready = False
        logger.error("Startup failed: %s", e, exc_info=True)

    yield


app = FastAPI(title="Drift_Shield API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

app.mount("/metrics", make_asgi_app())


def _schema_check(bundle_features, payload, version, schema):
    reasons = []

    expected_version = schema.get("version", 1)
    if version != expected_version:
        reasons.append(f"SCHEMA_MISMATCH:{version}!={expected_version}")

    keys = set(payload.keys())
    required = set(bundle_features)

    missing = sorted(required - keys)
    if missing:
        shown = missing[:20]
        reasons.append(f"MISSING_FEATURES:{','.join(shown)}" + ("..." if len(missing) > 20 else ""))

    if not schema.get("allow_extras", False):
        extras = sorted(keys - required)
        if extras:
            shown = extras[:20]
            reasons.append(f"EXTRA_FEATURES:{','.join(shown)}" + ("..." if len(extras) > 20 else ""))

    invalid_values = []
    for name in bundle_features:
        if name not in payload:
            continue
        value = payload[name]
        if value is None or isinstance(value, bool):
            invalid_values.append(name)
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            invalid_values.append(name)
            continue
        if not math.isfinite(numeric_value):
            invalid_values.append(name)

    if invalid_values:
        shown = invalid_values[:20]
        reasons.append(
            f"INVALID_FEATURE_VALUES:{','.join(shown)}"
            + ("..." if len(invalid_values) > 20 else "")
        )

    return len(reasons) == 0, reasons


def _normalize_actual_label(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value == 1:
            return True
        if value == 0:
            return False
        return None
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "fraud", "yes", "y"}:
            return True
        if v in {"0", "false", "non_fraud", "non-fraud", "legit", "no", "n"}:
            return False
    return None


def _single_label_is_fraud(pred_set: list[str], action: ActionCode) -> bool | None:
    if len(pred_set) != 1 or action not in (ActionCode.ACTION_PREDICT, ActionCode.ACTION_MONITOR):
        return None
    return str(pred_set[0]).strip().lower() == "fraud"


def _require_runtime(schema_version: int = 1) -> DomainRuntime:
    runtimes: dict[int, DomainRuntime] = getattr(app.state, "domains", {}) or {}
    if not runtimes:
        detail = getattr(app.state, "bootstrap_error", None) or "Service is still initializing"
        raise HTTPException(status_code=503, detail=f"Model service unavailable: {detail}")

    try:
        sv = int(schema_version)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid schema_version: {schema_version}")

    runtime = runtimes.get(sv)
    if runtime is None:
        runtime = _try_lazy_load_runtime(sv)
    if runtime is None:
        supported = sorted(runtimes.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported schema_version={sv}. Supported schema versions: {supported}",
        )
    return runtime


def _default_schema_version() -> int:
    runtimes: dict[int, DomainRuntime] = getattr(app.state, "domains", {}) or {}
    if not runtimes:
        return 1
    return 1 if 1 in runtimes else min(runtimes.keys())


def _try_lazy_load_runtime(schema_version: int) -> DomainRuntime | None:
    runtimes: dict[int, DomainRuntime] = getattr(app.state, "domains", {}) or {}
    candidate_paths = getattr(app.state, "secondary_config_paths", []) or []
    for raw in candidate_paths:
        p = Path(raw)
        cfg_path = p if p.is_absolute() else (PROJECT_ROOT / p)
        if not cfg_path.exists():
            continue
        try:
            runtime = _build_domain_runtime(cfg_path)
        except Exception:
            continue
        if runtime.schema_version != schema_version:
            continue
        runtimes[runtime.schema_version] = runtime
        app.state.domains = runtimes
        logger.info(
            "Lazily loaded runtime for schema_version=%s from %s",
            runtime.schema_version,
            cfg_path,
        )
        return runtime
    return None


@app.get("/health")
def health():
    return {
        "status": "alive",
        "service": "drift_shield",
        "ready": bool(getattr(app.state, "ready", False)),
    }


@app.get("/ready", response_model=ApiReadiness)
def readiness() -> ApiReadiness:
    try:
        runtime = _require_runtime(schema_version=_default_schema_version())
        active = runtime.manager.get_active()
        shadow = runtime.manager.get_shadow()
        app.state.ready = True
        return ApiReadiness(
            ready=True,
            detail=f"ready (schema_version={runtime.schema_version})",
            active_model_version=active.model_version,
            shadow_model_version=shadow.model_version if shadow else None,
        )
    except HTTPException as e:
        return ApiReadiness(ready=False, detail=str(e.detail))
    except Exception as e:
        app.state.ready = False
        return ApiReadiness(ready=False, detail=str(e))


@app.get("/contracts/predict", response_model=PredictContract)
def predict_contract() -> PredictContract:
    runtimes: dict[int, DomainRuntime] = getattr(app.state, "domains", {}) or {}
    schema_version = _default_schema_version()
    supported = sorted(runtimes.keys()) if runtimes else [schema_version]

    return PredictContract(
        contract_version=str(getattr(app.state, "contract_version", CONTRACT_VERSION)),
        schema_version=schema_version,
        supported_schema_versions=supported,
        action_codes=[ActionCode(code) for code in ACTION_CODES],
        reason_codes=[ReasonCode(code) for code in REASON_CODES],
        notes=[
            "reasons may include structured details such as MISSING_FEATURES:* or EXTRA_FEATURES:*",
            "schema_version must match one of supported_schema_versions",
        ],
    )


@app.api_route("/prometheus/{path:path}", methods=["GET"])
async def prometheus_proxy(path: str, request: Request):
    url = f"{PROMETHEUS_UPSTREAM}/{path}"
    params = dict(request.query_params)
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, params=params, timeout=10.0)
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Prometheus is not reachable")
    return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type"))


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    t0 = time.perf_counter()

    runtime = _require_runtime(schema_version=req.schema_version)
    schema_label = str(runtime.schema_version)
    REQS.labels(schema_version=schema_label).inc()
    manager = runtime.manager
    retrain_trigger = runtime.retrain_trigger
    emitter = runtime.emitter
    shadow_sampling_rate = runtime.shadow_sampling_rate
    feature_store = runtime.feature_store

    try:
        bundle = manager.get_active()
    except Exception as e:
        logger.error("Failed to load active model bundle: %s", e, exc_info=True)
        raise HTTPException(status_code=503, detail=f"Model service unavailable: {str(e)}")

    schema_cfg = bundle.cfg.get("schema", {})
    ok_schema, schema_reasons = _schema_check(
        list(bundle.feature_names),
        req.transaction_features,
        req.schema_version,
        schema_cfg,
    )
    if not ok_schema:
        action = ActionCode.ACTION_FALLBACK
        reasons = [REASON_DATA_CONTRACT] + schema_reasons
        ACTIONS.labels(schema_version=schema_label, code=action.value).inc()

        drift_info = DriftInfo(
            drift_score=0.0,
            soft_drift=False,
            hard_drift=False,
            ready=False,
            warmup_samples_remaining=None,
            top_drifted_features=[],
            psi_mean=0.0,
            ks_flag_frac=0.0,
        )

        resp = PredictResponse(
            prediction=None,
            prediction_set=[],
            p_fraud=None,
            coverage=1.0 - float(bundle.cfg["conformal"]["alpha"]),
            action_code=action,
            reasons=reasons,
            fallback_risk=None,
            fallback_reason=FALLBACK_SCHEMA_MISMATCH,
            retrain_triggered=False,
            retrain_reason=None,
            model_version=bundle.model_version,
            drift=drift_info,
        )
        REQUEST_LATENCY.labels(schema_version=schema_label).observe(time.perf_counter() - t0)
        return resp

    actual_label_is_fraud = _normalize_actual_label(req.actual_label)

    try:
        out = predict_one(bundle, req.transaction_features)
    except Exception as e:
        logger.error("Prediction failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    drift_score = float(out.get("drift_score", 0.0))
    drift_ready = bool(out.get("drift_ready", False))
    DRIFT_READY.labels(schema_version=schema_label).set(1.0 if drift_ready else 0.0)
    if drift_ready:
        DRIFT_SCORE.labels(schema_version=schema_label).set(drift_score)

    soft_thr = float(bundle.cfg["drift"]["soft_threshold"])
    hard_thr = float(bundle.cfg["drift"]["hard_threshold"])

    pred_set = list(out.get("prediction_set", []))
    action_raw, reasons = decide_action(
        pred_set=pred_set,
        drift_score=drift_score,
        soft_thr=soft_thr,
        hard_thr=hard_thr,
    )
    action = ActionCode(action_raw)
    ACTIONS.labels(schema_version=schema_label, code=action.value).inc()

    active_pred_is_fraud = _single_label_is_fraud(pred_set, action)
    if actual_label_is_fraud is not None and active_pred_is_fraud is not None:
        ACTIVE_EVAL_LABELED_TOTAL.labels(schema_version=schema_label).inc()
        if active_pred_is_fraud == actual_label_is_fraud:
            ACTIVE_EVAL_LABELED_CORRECT.labels(schema_version=schema_label).inc()

    p_fraud = out.get("p_fraud")
    if p_fraud is not None:
        P_FRAUD.labels(schema_version=schema_label).observe(float(p_fraud))

    fsoft = out.get("feature_soft_count")
    fhard = out.get("feature_hard_count")
    if fsoft is not None:
        FEATURE_SOFT_COUNT.labels(schema_version=schema_label).set(float(fsoft))
    if fhard is not None:
        FEATURE_HARD_COUNT.labels(schema_version=schema_label).set(float(fhard))

    def _unwrap(v):
        return v.item() if hasattr(v, "item") else v

    trig = retrain_trigger.on_drift_update(
        drift_score=drift_score,
        extra={
            "updated": bool(out.get("drift_updated", False)),
            "ready": drift_ready,
            "top_drifted_features": out.get("top_drifted_features", []),
            "feature_soft_count": fsoft,
            "feature_hard_count": fhard,
            "psi_mean": out.get("psi_mean"),
            "ks_flag_frac": out.get("ks_flag_frac"),
        },
    )

    if feature_store is not None:
        try:
            feature_store.append(
                features=req.transaction_features,
                feature_names=bundle.feature_names,
                model_version=str(bundle.model_version),
                p_fraud=float(_unwrap(p_fraud)) if p_fraud is not None else None,
                actual_label=int(actual_label_is_fraud) if actual_label_is_fraud is not None else None,
                action_code=str(action.value),
                drift_score=float(drift_score) if drift_ready else None,
                drift_ready=drift_ready,
            )
        except Exception as e:
            logger.warning("Failed to capture recent /predict feature payload: %s", e)

    if trig.get("triggered"):
        top_feats = [str(x) for x in (out.get("top_drifted_features") or [])]

        drift_dict = {
            "drift_score": float(drift_score),
            "reason": str(trig.get("reason") or "DRIFT"),
            "top_drifted_features": top_feats,
            "feature_soft_count": int(_unwrap(fsoft)) if fsoft is not None else None,
            "feature_hard_count": int(_unwrap(fhard)) if fhard is not None else None,
            "psi_mean": float(_unwrap(out.get("psi_mean"))) if out.get("psi_mean") is not None else None,
            "ks_flag_frac": float(_unwrap(out.get("ks_flag_frac"))) if out.get("ks_flag_frac") is not None else None,
        }

        emitted = emitter.emit(
            reason=str(trig.get("reason") or "DRIFT"),
            drift_score=float(drift_score),
            model_version=str(bundle.model_version),
            action_code=str(action.value),
            p_fraud=float(_unwrap(p_fraud)) if p_fraud is not None else None,
            drift=drift_dict,
        )

        if emitted:
            RETRAIN_TRIGGERS.labels(schema_version=schema_label).inc()

    try:
        shadow = manager.get_shadow()
        if shadow is None:
            SHADOW_DRIFT_READY.labels(schema_version=schema_label).set(0.0)
        elif random.random() < shadow_sampling_rate:
            SHADOW_RUNS.labels(schema_version=schema_label).inc()
            s_out = predict_one(shadow, req.transaction_features)

            s_drift = float(s_out.get("drift_score", 0.0))
            s_ready = bool(s_out.get("drift_ready", False))
            SHADOW_DRIFT_READY.labels(schema_version=schema_label).set(1.0 if s_ready else 0.0)
            if s_ready:
                SHADOW_DRIFT_SCORE.labels(schema_version=schema_label).set(s_drift)

            s_p_fraud = s_out.get("p_fraud")
            if s_p_fraud is not None:
                SHADOW_P_FRAUD.labels(schema_version=schema_label).observe(float(s_p_fraud))

            s_action_raw, _ = decide_action(
                pred_set=s_out.get("prediction_set", []),
                drift_score=s_drift,
                soft_thr=float(shadow.cfg["drift"]["soft_threshold"]),
                hard_thr=float(shadow.cfg["drift"]["hard_threshold"]),
            )
            s_action = ActionCode(s_action_raw)
            s_pred_set = list(s_out.get("prediction_set", []))

            shadow_pred_is_fraud = _single_label_is_fraud(s_pred_set, s_action)
            if actual_label_is_fraud is not None and shadow_pred_is_fraud is not None:
                SHADOW_EVAL_LABELED_TOTAL.labels(schema_version=schema_label).inc()
                if shadow_pred_is_fraud == actual_label_is_fraud:
                    SHADOW_EVAL_LABELED_CORRECT.labels(schema_version=schema_label).inc()

            disagree = (s_pred_set != pred_set) or (s_action != action)
            if disagree:
                SHADOW_DISAGREE.labels(schema_version=schema_label).inc()
        else:
            # Clear readiness when we intentionally skip shadow execution so dashboards do not show stale state.
            SHADOW_DRIFT_READY.labels(schema_version=schema_label).set(0.0)
    except Exception as e:
        logger.warning("Shadow model prediction failed: %s", e)

    prediction = None
    if len(pred_set) == 1 and action in (ActionCode.ACTION_PREDICT, ActionCode.ACTION_MONITOR):
        prediction = pred_set[0]

    drift_info = DriftInfo(
        drift_score=drift_score,
        soft_drift=bool(drift_ready and drift_score >= soft_thr),
        hard_drift=bool(drift_ready and drift_score >= hard_thr),
        ready=drift_ready,
        warmup_samples_remaining=(
            int(out.get("drift_samples_until_ready"))
            if out.get("drift_samples_until_ready") is not None
            else None
        ),
        top_drifted_features=list(out.get("top_drifted_features", [])),
        psi_mean=out.get("psi_mean"),
        ks_flag_frac=out.get("ks_flag_frac"),
    )

    resp = PredictResponse(
        prediction=prediction,
        prediction_set=list(pred_set),
        p_fraud=float(p_fraud) if p_fraud is not None else None,
        coverage=1.0 - float(bundle.cfg["conformal"]["alpha"]),
        action_code=action,
        reasons=reasons,
        fallback_risk=None,
        fallback_reason=None,
        retrain_triggered=bool(trig.get("triggered", False)),
        retrain_reason=trig.get("reason"),
        model_version=bundle.model_version,
        drift=drift_info,
    )

    REQUEST_LATENCY.labels(schema_version=schema_label).observe(time.perf_counter() - t0)
    return resp


@app.get("/dashboard/stats")
def dashboard_stats(schema_version: int = Query(default=1, ge=1)):
    runtime = _require_runtime(schema_version=schema_version)
    schema_label = str(runtime.schema_version)
    manager = runtime.manager

    try:
        bundle = manager.get_active()
    except Exception as e:
        logger.error("Failed to get active bundle for stats: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve model information")

    def get_val(metric, prefer_total: bool = False):
        for metric_family in metric.collect():
            if not metric_family.samples:
                continue
            if prefer_total:
                for sample in metric_family.samples:
                    if (
                        sample.name.endswith("_total")
                        and sample.labels.get("schema_version") == schema_label
                    ):
                        return sample.value
            for sample in metric_family.samples:
                if sample.labels.get("schema_version") == schema_label:
                    return sample.value
        return 0.0

    def get_action_count(action_code):
        for metric_family in ACTIONS.collect():
            for sample in metric_family.samples:
                if (
                    sample.name.endswith("_total")
                    and sample.labels.get("code") == action_code
                    and sample.labels.get("schema_version") == schema_label
                ):
                    return sample.value
        return 0.0

    drift_ready = float(get_val(DRIFT_READY))
    drift_score_value = get_val(DRIFT_SCORE) if drift_ready >= 0.5 else None

    return {
        "schema_version": runtime.schema_version,
        "total_requests": get_val(REQS, prefer_total=True),
        "drift_score": drift_score_value,
        "drift_ready": bool(drift_ready >= 0.5),
        "retrain_triggers": get_val(RETRAIN_TRIGGERS, prefer_total=True),
        "shadow_runs": get_val(SHADOW_RUNS, prefer_total=True),
        "model_version": bundle.model_version,
        "action_counts": {
            "predict": get_action_count(ActionCode.ACTION_PREDICT.value),
            "fallback": get_action_count(ActionCode.ACTION_FALLBACK.value),
        },
    }


@app.post("/retrain")
def trigger_retrain(schema_version: int = Query(default=1, ge=1)):
    runtime = _require_runtime(schema_version=schema_version)
    manager = runtime.manager
    emitter = runtime.emitter

    try:
        bundle = manager.get_active()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model service unavailable: {str(e)}")

    emitted = emitter.emit(
        reason="MANUAL_RETRAIN",
        drift_score=0.0,
        model_version=str(bundle.model_version),
        action_code=ACTION_MANUAL,
        drift={"drift_score": 0.0, "reason": "MANUAL_RETRAIN", "top_drifted_features": []},
    )
    if not emitted:
        raise HTTPException(status_code=429, detail="Retrain request throttled: cooldown active or backlog full")
    return {"status": "queued", "model_version": bundle.model_version}


@app.get("/models/info")
def models_info(schema_version: int = Query(default=1, ge=1)):
    runtime = _require_runtime(schema_version=schema_version)
    manager = runtime.manager

    try:
        active = manager.get_active()
    except Exception as e:
        logger.error("Failed to get active model info: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve active model information")

    try:
        shadow = manager.get_shadow()
    except Exception as e:
        logger.warning("Failed to get shadow model info: %s", e)
        shadow = None

    return {
        "schema_version": runtime.schema_version,
        "active": {
            "version": active.model_version,
            "feature_count": len(active.feature_names),
            "feature_names": [str(x) for x in active.feature_names],
            "drift_threshold_soft": float(active.cfg["drift"]["soft_threshold"]),
            "drift_threshold_hard": float(active.cfg["drift"]["hard_threshold"]),
            "alpha": float(active.cfg["conformal"]["alpha"]),
            "coverage": 1.0 - float(active.cfg["conformal"]["alpha"]),
        },
        "shadow": {
            "version": shadow.model_version if shadow else None,
            "enabled": shadow is not None,
        } if shadow else None,
    }


@app.get("/system/status")
def system_status(schema_version: int = Query(default=1, ge=1)):
    runtime = _require_runtime(schema_version=schema_version)
    manager = runtime.manager
    emitter = runtime.emitter
    feature_store = runtime.feature_store
    now = float(time.time())
    cfg = manager.cfg
    pending = emitter.pending_requests()

    repo_root = Path(cfg.get("paths", {}).get("repo_root", PROJECT_ROOT)).resolve()
    reports_dir = repo_root / cfg.get("paths", {}).get("reports_dir", "artifacts/reports")

    def _load_json(path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            with path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
            return loaded if isinstance(loaded, dict) else {}
        except Exception:
            return {}

    def _file_meta(path: Path) -> dict[str, Any]:
        try:
            st = path.stat()
            mtime = float(st.st_mtime)
            return {
                "path": str(path),
                "mtime_unix": mtime,
                "age_seconds": now - mtime,
            }
        except Exception:
            return {
                "path": str(path),
                "mtime_unix": None,
                "age_seconds": None,
            }

    last_retrain = _load_json(reports_dir / "last_retrain.json")
    last_promotion = _load_json(reports_dir / "last_promotion.json")
    active_error = None
    try:
        active = manager.get_active()
    except Exception as e:
        logger.warning("Failed to get active model for system status: %s", e)
        active = None
        active_error = str(e)

    shadow_error = None
    try:
        shadow = manager.get_shadow()
    except Exception as e:
        logger.warning("Failed to get shadow model for system status: %s", e)
        shadow = None
        shadow_error = str(e)

    shadow_stats = None
    shadow_stats_meta = None
    if shadow:
        shadow_report_path = reports_dir / f"retrain_candidate_{shadow.model_version}.json"
        shadow_stats = _load_json(shadow_report_path) or None
        if shadow_stats is not None:
            shadow_stats_meta = {
                "kind": "candidate_report",
                **_file_meta(shadow_report_path),
            }

    active_stats = None
    active_stats_meta = None
    if active is not None:
        active_report_path = reports_dir / f"retrain_candidate_{active.model_version}.json"
        active_candidate_report = _load_json(active_report_path)
        if active_candidate_report:
            active_stats = (
                active_candidate_report.get("candidate_eval")
                or active_candidate_report.get("active_eval")
                or active_candidate_report
            )
            active_stats_meta = {
                "kind": "candidate_report_for_active",
                **_file_meta(active_report_path),
            }
        else:
            summary_path = reports_dir / "summary.json"
            summary_stats = _load_json(summary_path)
            if summary_stats:
                active_stats = summary_stats
                active_stats_meta = {
                    "kind": "summary",
                    **_file_meta(summary_path),
                }

    pending_requests: list[dict[str, Any]] = []
    for req_path in pending[:25]:
        row: dict[str, Any] = {"file": req_path.name}
        payload = _load_json(req_path)
        created_ts = payload.get("created_at_unix")
        try:
            created_ts = float(created_ts) if created_ts is not None else None
        except (TypeError, ValueError):
            created_ts = None
        row.update(
            {
                "created_at_unix": created_ts,
                "age_seconds": (now - created_ts) if created_ts else None,
                "reason": payload.get("reason"),
                "drift_score": payload.get("drift_score"),
                "model_version": payload.get("model_version"),
                "action_code": payload.get("action_code"),
            }
        )
        pending_requests.append(row)

    retrain_cfg = cfg.get("retrain", {})
    promote_cfg = cfg.get("promote", {})

    feature_capture = {
        "entries": 0,
        "max_entries": 0,
        "path": None,
        "oldest_ts": None,
        "newest_ts": None,
        "oldest_age_seconds": None,
        "newest_age_seconds": None,
    }
    if feature_store is not None:
        try:
            feature_capture = feature_store.stats()
        except Exception as e:
            logger.warning("Failed to get recent feature capture stats: %s", e)
            feature_capture["error"] = str(e)

    drift_active = None
    if active is not None:
        try:
            drift_active = active.drift.status_snapshot()
        except Exception as e:
            logger.warning("Failed to get active drift status: %s", e)
            drift_active = {"error": str(e)}

    drift_shadow = None
    if shadow:
        try:
            drift_shadow = shadow.drift.status_snapshot()
        except Exception as e:
            logger.warning("Failed to get shadow drift status: %s", e)
            drift_shadow = {"error": str(e)}

    return {
        "generated_at_unix": now,
        "schema_version": runtime.schema_version,
        "config_path": str(runtime.config_path),
        "retraining": {
            "is_active": len(pending) > 0,
            "pending_count": len(pending),
            "pending_requests": pending_requests,
            "cooldown_seconds": float(retrain_cfg.get("cooldown_seconds", 600)),
            "max_pending": int(retrain_cfg.get("max_pending", 1)),
            "last_retrain": last_retrain,
            "last_promotion": last_promotion,
        },
        "models": {
            "active_version": active.model_version if active else None,
            "active_error": active_error,
            "shadow_version": shadow.model_version if shadow else None,
            "shadow_error": shadow_error,
            "shadow_stats": shadow_stats,
            "shadow_stats_meta": shadow_stats_meta,
            "active_stats": active_stats,
            "active_stats_meta": active_stats_meta,
        },
        "drift": {
            "active": drift_active,
            "shadow": drift_shadow,
        },
        "capture": {
            "recent_predict_features": feature_capture,
        },
        "promotion_policy": {
            "auto_promote": bool(promote_cfg.get("auto_promote", True)),
            "cooldown_seconds": int(promote_cfg.get("cooldown_seconds", 120)),
            "max_cost_increase": float(promote_cfg.get("max_cost_increase", 0.05)),
            "min_auc_delta": float(promote_cfg.get("min_auc_delta", 0.0)),
            "min_f1_delta": float(promote_cfg.get("min_f1_delta", 0.0)),
            "min_auc": promote_cfg.get("min_auc"),
            "min_f1": promote_cfg.get("min_f1"),
            "require_cost_metric": bool(promote_cfg.get("require_cost_metric", False)),
        },
    }
