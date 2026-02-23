import logging
import math
import os
import random
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import make_asgi_app

from fraud_service.api.schemas import PredictRequest, PredictResponse, DriftInfo
from fraud_service.api.decisions import decide_action
from fraud_service.api.constants import (
    ACTION_FALLBACK,
    REASON_DATA_CONTRACT,
    FALLBACK_SCHEMA_MISMATCH,
)
from fraud_service.modeling.predict import BundleManager, predict_one
from fraud_service.monitoring.metrics import (
    REQS,
    ACTIONS,
    DRIFT_SCORE,
    P_FRAUD,
    SHADOW_RUNS,
    SHADOW_DISAGREE,
    FEATURE_SOFT_COUNT,
    FEATURE_HARD_COUNT,
    RETRAIN_TRIGGERS,
    REQUEST_LATENCY,
)
from fraud_service.drift.retrain import RetrainTrigger
from fraud_service.drift.emitter import RetrainEmitter
from fraud_service.utils.config_validator import validate_config, validate_cors_origins, ConfigValidationError

logger = logging.getLogger(__name__)

app = FastAPI(title="Drift_Shield API")

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

try:
    validate_cors_origins(CORS_ORIGINS, ENVIRONMENT)
    logger.info(f"CORS configured for {ENVIRONMENT} with origins: {CORS_ORIGINS}")
except ConfigValidationError as e:
    logger.error(f"CORS configuration error: {e}")
    raise

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

app.mount("/metrics", make_asgi_app())

try:
    manager = BundleManager("config.yaml")
    _cfg = manager.cfg
    validate_config(_cfg, "config.yaml")
except Exception as e:
    logger.error(f"Startup failed: {e}")
    raise

retrain_trigger = RetrainTrigger(
    soft_thr=float(_cfg["drift"]["soft_threshold"]),
    hard_thr=float(_cfg["drift"]["hard_threshold"]),
    required_hard_windows=int(_cfg["drift"].get("required_hard_windows", 3)),
)

_requests_dir = _cfg.get("paths", {}).get("retrain_requests_dir", "artifacts/retrain_requests")
Path(_requests_dir).mkdir(parents=True, exist_ok=True)

emitter = RetrainEmitter(
    request_dir=str(_requests_dir),
    cooldown_seconds=float(_cfg.get("retrain", {}).get("cooldown_seconds", 600)),
    max_pending=int(_cfg.get("retrain", {}).get("max_pending", 1)),
)

SHADOW_SAMPLING_RATE = float(_cfg.get("shadow", {}).get("sampling_rate", 1.0))


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


PROMETHEUS_UPSTREAM = os.getenv("PROMETHEUS_URL", "http://localhost:9090")


@app.get("/health")
def health():
    return {"status": "ok", "service": "drift_shield"}


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
    REQS.inc()

    try:
        bundle = manager.get_active()
    except Exception as e:
        logger.error(f"Failed to load active model bundle: {e}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"Model service unavailable: {str(e)}"
        )

    schema_cfg = bundle.cfg.get("schema", {})
    ok_schema, schema_reasons = _schema_check(
        list(bundle.feature_names),
        req.transaction_features,
        req.schema_version,
        schema_cfg,
    )
    if not ok_schema:
        action = ACTION_FALLBACK
        reasons = [REASON_DATA_CONTRACT] + schema_reasons
        ACTIONS.labels(code=action).inc()

        drift_info = DriftInfo(
            drift_score=0.0,
            soft_drift=False,
            hard_drift=False,
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
        REQUEST_LATENCY.observe(time.perf_counter() - t0)
        return resp

    try:
        out = predict_one(bundle, req.transaction_features)
    except Exception as e:
        logger.error(f"Prediction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    drift_score = float(out.get("drift_score", 0.0))
    DRIFT_SCORE.set(drift_score)

    soft_thr = float(bundle.cfg["drift"]["soft_threshold"])
    hard_thr = float(bundle.cfg["drift"]["hard_threshold"])

    action, reasons = decide_action(
        pred_set=out.get("prediction_set", []),
        drift_score=drift_score,
        soft_thr=soft_thr,
        hard_thr=hard_thr,
    )
    ACTIONS.labels(code=action).inc()

    p_fraud = out.get("p_fraud")
    if p_fraud is not None:
        P_FRAUD.observe(float(p_fraud))

    fsoft = out.get("feature_soft_count")
    fhard = out.get("feature_hard_count")
    if fsoft is not None:
        FEATURE_SOFT_COUNT.set(float(fsoft))
    if fhard is not None:
        FEATURE_HARD_COUNT.set(float(fhard))

    # numpy scalars don't serialize — .item() coerces them to plain python
    def _unwrap(v):
        return v.item() if hasattr(v, "item") else v

    trig = retrain_trigger.on_drift_update(
        drift_score=drift_score,
        extra={
            "top_drifted_features": out.get("top_drifted_features", []),
            "feature_soft_count": fsoft,
            "feature_hard_count": fhard,
            "psi_mean": out.get("psi_mean"),
            "ks_flag_frac": out.get("ks_flag_frac"),
        },
    )

    if trig.get("triggered"):
        RETRAIN_TRIGGERS.inc()

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

        emitter.emit(
            reason=drift_dict["reason"],
            drift_score=float(drift_dict["drift_score"]),
            model_version=str(bundle.model_version),
            action_code=str(action),
            p_fraud=float(_unwrap(p_fraud)) if p_fraud is not None else None,
            drift=drift_dict,
        )


    try:
        shadow = manager.get_shadow()
        if shadow is not None and random.random() < SHADOW_SAMPLING_RATE:
            SHADOW_RUNS.inc()
            s_out = predict_one(shadow, req.transaction_features)

            s_drift = float(s_out.get("drift_score", 0.0))
            s_action, _ = decide_action(
                pred_set=s_out.get("prediction_set", []),
                drift_score=s_drift,
                soft_thr=float(shadow.cfg["drift"]["soft_threshold"]),
                hard_thr=float(shadow.cfg["drift"]["hard_threshold"]),
            )

            disagree = (s_out.get("prediction_set") != out.get("prediction_set")) or (s_action != action)
            if disagree:
                SHADOW_DISAGREE.inc()
    except Exception as e:
        logger.warning(f"Shadow model prediction failed: {e}")

    prediction = None
    pred_set = out.get("prediction_set", [])
    if len(pred_set) == 1 and action in ("ACTION_PREDICT", "ACTION_MONITOR"):
        prediction = pred_set[0]

    drift_info = DriftInfo(
        drift_score=drift_score,
        soft_drift=drift_score >= soft_thr,
        hard_drift=drift_score >= hard_thr,
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

    REQUEST_LATENCY.observe(time.perf_counter() - t0)
    return resp
    
    
@app.get("/dashboard/stats")
def dashboard_stats():
    try:
        bundle = manager.get_active()
    except Exception as e:
        logger.error(f"Failed to get active bundle for stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve model information")

    def get_val(metric, prefer_total: bool = False):
        for metric_family in metric.collect():
            if not metric_family.samples:
                continue
            if prefer_total:
                for sample in metric_family.samples:
                    if sample.name.endswith("_total"):
                        return sample.value
            return metric_family.samples[0].value
        return 0.0

    def get_action_count(action_code):
        for metric_family in ACTIONS.collect():
            for sample in metric_family.samples:
                if sample.labels.get("code") == action_code:
                    return sample.value
        return 0.0

    return {
        "total_requests": get_val(REQS, prefer_total=True),
        "drift_score": get_val(DRIFT_SCORE),
        "retrain_triggers": get_val(RETRAIN_TRIGGERS, prefer_total=True),
        "shadow_runs": get_val(SHADOW_RUNS, prefer_total=True),
        "model_version": bundle.model_version,
        "action_counts": {
            "predict": get_action_count("ACTION_PREDICT"),
            "fallback": get_action_count("ACTION_FALLBACK"),
        }
    }


@app.post("/retrain")
def trigger_retrain():
    try:
        bundle = manager.get_active()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model service unavailable: {str(e)}")

    emitted = emitter.emit(
        reason="MANUAL_RETRAIN",
        drift_score=0.0,
        model_version=str(bundle.model_version),
        action_code="ACTION_MANUAL",
        drift={"drift_score": 0.0, "reason": "MANUAL_RETRAIN", "top_drifted_features": []},
    )
    if not emitted:
        raise HTTPException(status_code=429, detail="Retrain request throttled: cooldown active or backlog full")
    return {"status": "queued", "model_version": bundle.model_version}


@app.get("/models/info")
def models_info():
    try:
        active = manager.get_active()
    except Exception as e:
        logger.error(f"Failed to get active model info: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve active model information")

    try:
        shadow = manager.get_shadow()
    except Exception as e:
        logger.warning(f"Failed to get shadow model info: {e}")
        shadow = None

    return {
        "active": {
            "version": active.model_version,
            "feature_count": len(active.feature_names),
            "drift_threshold_soft": float(active.cfg["drift"]["soft_threshold"]),
            "drift_threshold_hard": float(active.cfg["drift"]["hard_threshold"]),
            "alpha": float(active.cfg["conformal"]["alpha"]),
            "coverage": 1.0 - float(active.cfg["conformal"]["alpha"]),
        },
        "shadow": {
            "version": shadow.model_version if shadow else None,
            "enabled": shadow is not None,
        } if shadow else None
    }
    
