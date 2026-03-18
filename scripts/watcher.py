from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd
import joblib
import xgboost as xgb
from sklearn.metrics import f1_score, roc_auc_score

from fraud_service.utils.io import load_yaml, load_json, save_json
from fraud_service.modeling.train import train_and_save
from fraud_service.modeling.registry import (
    read_active_model,
    write_active_model,
    write_shadow_model,
    write_rollback_model,
)
from fraud_service.uncertainty.conformal import load_calib, prediction_set

@dataclass
class WatcherCfg:
    config_path: str
    repo_root: Path
    requests_dir: Path
    processed_dir: Path
    failed_dir: Path
    reports_dir: Path
    versions_dir: Path
    active_ptr: Path
    shadow_ptr: Path
    rollback_ptr: Path
    recent_features_path: Path
    retrain: Dict[str, Any]
    promote: Dict[str, Any]
    cfg: Dict[str, Any]


def _load_cfg(config_path: str = "config.yaml") -> WatcherCfg:
    resolved_config_path = Path(config_path).expanduser().resolve()
    cfg = load_yaml(str(resolved_config_path))
    paths = cfg.get("paths", {})
    repo_root_cfg = Path(paths.get("repo_root", "."))
    if repo_root_cfg.is_absolute():
        repo_root = repo_root_cfg
    else:
        repo_root = (resolved_config_path.parent / repo_root_cfg).resolve()

    def _resolve_repo_path(raw_path: str) -> Path:
        candidate = Path(raw_path)
        if candidate.is_absolute():
            return candidate
        return (repo_root / candidate).resolve()

    requests_dir = _resolve_repo_path(paths.get("retrain_requests_dir", "artifacts/retrain_requests"))
    recent_features_path = _resolve_repo_path(
        paths.get("recent_predict_features_path", "artifacts/retrain_requests/recent_predict_features.jsonl")
    )

    return WatcherCfg(
        config_path=str(resolved_config_path),
        repo_root=repo_root,
        requests_dir=requests_dir,
        processed_dir=requests_dir / "processed",
        failed_dir=requests_dir / "failed",
        reports_dir=_resolve_repo_path(paths.get("reports_dir", "artifacts/reports")),
        versions_dir=_resolve_repo_path(paths.get("versions_dir", "artifacts/models/versions")),
        active_ptr=_resolve_repo_path(paths.get("active_ptr", "artifacts/models/ACTIVE_MODEL.json")),
        shadow_ptr=_resolve_repo_path(paths.get("shadow_ptr", "artifacts/models/SHADOW_MODEL.json")),
        rollback_ptr=_resolve_repo_path(paths.get("rollback_ptr", "artifacts/models/ROLLBACK_MODEL.json")),
        recent_features_path=recent_features_path,
        retrain=cfg.get("retrain", {}),
        promote=cfg.get("promote", {}),
        cfg=cfg,
    )


def _ensure_dirs(w: WatcherCfg) -> None:
    for p in [w.requests_dir, w.processed_dir, w.failed_dir, w.reports_dir, w.versions_dir]:
        p.mkdir(parents=True, exist_ok=True)


def _coerce_binary_label(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value == 1:
            return 1
        if value == 0:
            return 0
        return None
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "fraud", "yes", "y"}:
            return 1
        if normalized in {"0", "false", "non_fraud", "non-fraud", "legit", "no", "n"}:
            return 0
    return None


def _load_recent_predict_rows(
    w: WatcherCfg,
    *,
    feature_names: list[str],
    target_col: str,
) -> tuple[pd.DataFrame, pd.DataFrame, Dict[str, Any]]:
    if not w.recent_features_path.exists():
        empty = pd.DataFrame(columns=[*feature_names, target_col])
        return empty, empty.copy(), {
            "seen": 0,
            "used_for_retrain": 0,
            "used_for_reference": 0,
        }

    low_thr = float(w.retrain.get("pseudo_label_low", 0.05))
    high_thr = float(w.retrain.get("pseudo_label_high", 0.95))
    max_for_retrain = int(w.retrain.get("recent_requests_for_retrain", 2000))
    max_for_reference = int(w.retrain.get("recent_requests_for_reference", 5000))

    parsed: list[dict[str, Any]] = []
    with w.recent_features_path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                parsed.append(row)

    if not parsed:
        empty = pd.DataFrame(columns=[*feature_names, target_col])
        return empty, empty.copy(), {
            "seen": 0,
            "used_for_retrain": 0,
            "used_for_reference": 0,
        }

    for_reference_rows: list[dict[str, float]] = []
    for_retrain_rows: list[dict[str, Any]] = []
    used_true_labels = 0
    used_pseudo_labels = 0

    for entry in parsed:
        features = entry.get("features")
        if not isinstance(features, dict):
            continue

        coerced = {}
        ok = True
        for name in feature_names:
            try:
                coerced[name] = float(features.get(name, 0.0))
            except (TypeError, ValueError):
                ok = False
                break
        if not ok:
            continue

        for_reference_rows.append(coerced)

        actual_label = _coerce_binary_label(entry.get("actual_label"))
        if actual_label is not None:
            labeled = dict(coerced)
            labeled[target_col] = int(actual_label)
            for_retrain_rows.append(labeled)
            used_true_labels += 1
            continue

        p_fraud = entry.get("p_fraud")
        try:
            p_fraud = float(p_fraud)
        except (TypeError, ValueError):
            continue

        if p_fraud >= high_thr:
            labeled = dict(coerced)
            labeled[target_col] = 1
            for_retrain_rows.append(labeled)
            used_pseudo_labels += 1
        elif p_fraud <= low_thr:
            labeled = dict(coerced)
            labeled[target_col] = 0
            for_retrain_rows.append(labeled)
            used_pseudo_labels += 1

    df_reference = pd.DataFrame(for_reference_rows)
    if not df_reference.empty:
        df_reference = df_reference.tail(max_for_reference).reset_index(drop=True)

    df_retrain = pd.DataFrame(for_retrain_rows)
    if not df_retrain.empty:
        df_retrain = df_retrain.tail(max_for_retrain).reset_index(drop=True)

    return (
        df_retrain,
        df_reference,
        {
            "seen": len(parsed),
            "used_for_retrain": len(df_retrain),
            "used_for_reference": len(df_reference),
            "used_true_labels_for_retrain": used_true_labels,
            "used_pseudo_labels_for_retrain": used_pseudo_labels,
        },
    )


def _prepare_retrain_data(w: WatcherCfg) -> tuple[str, str, str, Dict[str, Any]]:
    cfg = w.cfg
    seed = int(cfg["project"]["random_seed"])
    target_col = cfg["data"]["target_col"]
    old_ratio = float(cfg.get("retrain", {}).get("old_data_ratio", 0.7))
    data_cfg = cfg.get("data", {})

    original_train = w.repo_root / data_cfg.get("train_csv_path", "data/processed/train.csv")
    original_calib = w.repo_root / data_cfg.get("calib_csv_path", "data/processed/calib.csv")
    drifted_path = w.repo_root / data_cfg.get("test_drifted_csv_path", "data/processed/test_drifted.csv")
    fallback_test_path = w.repo_root / data_cfg.get("test_csv_path", "data/processed/test.csv")

    df_orig = pd.concat([
        pd.read_csv(original_train),
        pd.read_csv(original_calib),
    ], ignore_index=True)

    if drifted_path.exists():
        df_drifted = pd.read_csv(drifted_path)
    elif fallback_test_path.exists():
        print(f"[watcher] warning: {drifted_path} missing; falling back to {fallback_test_path}")
        df_drifted = pd.read_csv(fallback_test_path)
    else:
        raise FileNotFoundError(
            f"Missing retrain source files: expected {drifted_path} or {fallback_test_path}"
        )

    if list(df_orig.columns) != list(df_drifted.columns):
        raise ValueError("Column mismatch between original and drifted data")

    feature_names = [c for c in df_orig.columns if c != target_col]
    df_recent_labeled, df_recent_reference, recent_stats = _load_recent_predict_rows(
        w,
        feature_names=feature_names,
        target_col=target_col,
    )

    n_old = int(len(df_orig) * old_ratio)
    retrain_parts = [
        df_orig.sample(n=n_old, random_state=seed),
        df_drifted,
    ]
    if not df_recent_labeled.empty:
        retrain_parts.append(df_recent_labeled)

    df_combined = pd.concat(retrain_parts, ignore_index=True).sample(frac=1.0, random_state=seed).reset_index(drop=True)

    n_train = int(len(df_combined) * 0.85)
    df_train = df_combined.iloc[:n_train]
    df_calib = df_combined.iloc[n_train:]

    out_dir = w.repo_root / data_cfg.get("retrain_output_dir", "data/retrain")
    out_dir.mkdir(parents=True, exist_ok=True)

    train_path = str(out_dir / "retrain_train.csv")
    calib_path = str(out_dir / "retrain_calib.csv")
    drift_reference_source_path = str(out_dir / "retrain_reference_source.csv")

    df_train.to_csv(train_path, index=False)
    df_calib.to_csv(calib_path, index=False)

    if df_recent_reference.empty:
        df_reference_source = pd.concat([df_train, df_calib], ignore_index=True)
    else:
        df_recent_for_ref = df_recent_reference.copy()
        df_recent_for_ref[target_col] = 0
        df_reference_source = pd.concat([df_train, df_calib, df_recent_for_ref], ignore_index=True)

    df_reference_source = df_reference_source[df_orig.columns]
    df_reference_source.to_csv(drift_reference_source_path, index=False)

    print(
        "[watcher] retrain data: "
        f"{len(df_train):,} train, {len(df_calib):,} calib, "
        f"{recent_stats['used_for_retrain']:,} recent labeled "
        f"({recent_stats.get('used_true_labels_for_retrain', 0):,} true + "
        f"{recent_stats.get('used_pseudo_labels_for_retrain', 0):,} pseudo), "
        f"{recent_stats['used_for_reference']:,} recent rows in drift reference"
    )
    return train_path, calib_path, drift_reference_source_path, recent_stats

def _eval_candidate(w: WatcherCfg, candidate_version: str, active_version: str) -> Dict[str, Any]:
    cfg = w.cfg
    target_col = cfg["data"]["target_col"]
    seed = int(cfg["project"]["random_seed"])
    fp_cost = float(cfg.get("eval", {}).get("fp_cost", 1.0))
    fn_cost = float(cfg.get("eval", {}).get("fn_cost", 10.0))
    abstain_cost = float(cfg.get("eval", {}).get("abstain_cost", 0.2))

    test_df = pd.read_csv(w.repo_root / cfg.get("data", {}).get("test_csv_path", "data/processed/test.csv"))
    df_eval = test_df.sample(n=min(5000, len(test_df)), random_state=seed)
    y = df_eval[target_col].astype(int).values
    X = df_eval.drop(columns=[target_col]).values.astype(np.float32)

    def _score_version(version: str) -> Dict[str, float]:
        vdir = w.versions_dir / version
        # Load booster directly to avoid sklearn wrapper metadata issues
        booster = xgb.Booster()
        booster.load_model(str(vdir / "xgb_model.json"))
        
        calibrator = joblib.load(str(vdir / "proba_calibrator.joblib"))
        calib = load_calib(str(vdir / "qhat.npy"), str(vdir / "calib_meta.json"))

        # Use DMatrix for prediction
        dm = xgb.DMatrix(X, feature_names=test_df.drop(columns=[target_col]).columns.tolist())
        raw_probas = booster.predict(dm)
        
        # Booster.predict returns p1 for binary, so we need [p0, p1]
        if raw_probas.ndim == 1:
            raw_probas_2col = np.vstack([1.0 - raw_probas, raw_probas]).T
        else:
            raw_probas_2col = raw_probas

        probas = calibrator.predict_proba(raw_probas_2col)
        p1 = probas[:, 1] if probas.ndim == 2 and probas.shape[1] >= 2 else probas.reshape(-1)
        yhat = (p1 >= 0.5).astype(int)

        auc: Optional[float] = None
        try:
            auc = float(roc_auc_score(y, p1))
        except ValueError:
            auc = None

        f1 = float(f1_score(y, yhat, zero_division=0))
        total_cost = abstain = correct = kept = 0

        for i in range(len(y)):
            ps = prediction_set(calib, probas[i])
            if len(ps) != 1:
                abstain += 1
                total_cost += abstain_cost
                continue
            kept += 1
            pred_fraud = ps[0] == "fraud"
            actual_fraud = bool(y[i])
            if pred_fraud == actual_fraud:
                correct += 1
            elif pred_fraud and not actual_fraud:
                total_cost += fp_cost
            else:
                total_cost += fn_cost

        return {
            "abstain_rate": abstain / max(1, len(y)),
            "selective_accuracy": correct / max(1, kept),
            "avg_cost_per_txn": total_cost / max(1, len(y)),
            "auc": auc,
            "f1": f1,
        }

    cand_metrics = _score_version(candidate_version)
    active_metrics = _score_version(active_version)

    active_cost = float(active_metrics["avg_cost_per_txn"])
    cand_cost = float(cand_metrics["avg_cost_per_txn"])
    active_auc = active_metrics.get("auc")
    cand_auc = cand_metrics.get("auc")
    active_f1 = active_metrics.get("f1")
    cand_f1 = cand_metrics.get("f1")

    auc_delta: Optional[float] = None
    if active_auc is not None and cand_auc is not None:
        auc_delta = float(cand_auc) - float(active_auc)

    f1_delta: Optional[float] = None
    if active_f1 is not None and cand_f1 is not None:
        f1_delta = float(cand_f1) - float(active_f1)

    return {
        "active_version": active_version,
        "candidate_version": candidate_version,
        "active_eval": active_metrics,
        "candidate_eval": cand_metrics,
        # Keep key for backward compatibility, but tie it to current active eval.
        "baseline_cost": active_cost,
        "active_cost": active_cost,
        "cand_cost": cand_cost,
        "active_auc": active_auc,
        "cand_auc": cand_auc,
        "auc_delta": auc_delta,
        "active_f1": active_f1,
        "cand_f1": cand_f1,
        "f1_delta": f1_delta,
        "cand_acc": cand_metrics["selective_accuracy"],
    }

def _promotion_gate(w: WatcherCfg, report: Dict[str, Any]) -> tuple[bool, str]:
    # Cooldown check
    stamp_path = w.reports_dir / "last_promotion.json"
    cooldown_s = int(w.promote.get("cooldown_seconds", 300))
    if stamp_path.exists():
        try:
            last_ts = float(load_json(str(stamp_path)).get("ts", 0))
            if (time.time() - last_ts) < cooldown_s:
                return False, "PROMOTION_COOLDOWN"
        except Exception:
            pass

    require_cost_metric = bool(w.promote.get("require_cost_metric", False))
    max_cost_increase = float(w.promote.get("max_cost_increase", 0.05))
    cand_cost = report.get("cand_cost")
    active_cost = report.get("active_cost", report.get("baseline_cost"))

    if require_cost_metric and (cand_cost is None or active_cost is None):
        return False, "MISSING_COST_METRIC"

    if cand_cost is not None and active_cost is not None:
        if float(cand_cost) > float(active_cost) * (1.0 + max_cost_increase):
            return False, "COST_REGRESSION"

    min_auc_delta = float(w.promote.get("min_auc_delta", 0.0))
    cand_auc = report.get("cand_auc")
    active_auc = report.get("active_auc")
    if cand_auc is not None and active_auc is not None:
        if (float(cand_auc) - float(active_auc)) < min_auc_delta:
            return False, "AUC_REGRESSION"

    min_f1_delta = float(w.promote.get("min_f1_delta", 0.0))
    cand_f1 = report.get("cand_f1")
    active_f1 = report.get("active_f1")
    if cand_f1 is not None and active_f1 is not None:
        if (float(cand_f1) - float(active_f1)) < min_f1_delta:
            return False, "F1_REGRESSION"

    min_auc = w.promote.get("min_auc")
    if min_auc is not None:
        if cand_auc is None or float(cand_auc) < float(min_auc):
            return False, "AUC_BELOW_MIN"

    min_f1 = w.promote.get("min_f1")
    if min_f1 is not None:
        if cand_f1 is None or float(cand_f1) < float(min_f1):
            return False, "F1_BELOW_MIN"

    return True, "PASSED"


def _promote(w: WatcherCfg, new_version: str) -> None:
    cur = read_active_model(str(w.active_ptr))
    if cur:
        write_rollback_model(str(w.rollback_ptr), cur)
    write_active_model(str(w.active_ptr), new_version)
    save_json(
        {"ts": time.time(), "active_version": new_version},
        str(w.reports_dir / "last_promotion.json"),
    )

def _list_requests(requests_dir: Path) -> list[Path]:
    return sorted(requests_dir.glob("retrain_request_*.json"))


def _train_cooldown_ok(w: WatcherCfg) -> bool:
    cooldown_s = int(w.retrain.get("cooldown_seconds", 600))
    stamp_path = w.reports_dir / "last_retrain.json"
    if not stamp_path.exists():
        return True
    try:
        last_ts = float(load_json(str(stamp_path)).get("ts", 0))
        return (time.time() - last_ts) >= cooldown_s
    except Exception:
        return True


def _handle_request(w: WatcherCfg, req_path: Path) -> None:
    print(f"[watcher] processing: {req_path.name}")

    train_path, calib_path, drift_reference_source_path, recent_stats = _prepare_retrain_data(w)

    candidate_version = train_and_save(
        w.config_path,
        make_active=False,
        train_data_path=train_path,
        calib_data_path=calib_path,
        drift_reference_data_path=drift_reference_source_path,
    )

    active_version = read_active_model(str(w.active_ptr))
    if not active_version:
        raise RuntimeError("No active model found — cannot evaluate candidate")

    report = _eval_candidate(w, candidate_version, active_version)
    report["recent_features_seen"] = int(recent_stats.get("seen", 0))
    report["recent_features_used_for_retrain"] = int(recent_stats.get("used_for_retrain", 0))
    report["recent_features_used_for_reference"] = int(recent_stats.get("used_for_reference", 0))
    report["recent_features_used_true_labels_for_retrain"] = int(
        recent_stats.get("used_true_labels_for_retrain", 0)
    )
    report["recent_features_used_pseudo_labels_for_retrain"] = int(
        recent_stats.get("used_pseudo_labels_for_retrain", 0)
    )
    report_path = w.reports_dir / f"retrain_candidate_{candidate_version}.json"
    save_json(report, str(report_path))
    print(f"[watcher] wrote report: {report_path.name}")

    write_shadow_model(str(w.shadow_ptr), candidate_version)
    print(f"[watcher] SHADOW -> {candidate_version}")

    save_json(
        {
            "ts": time.time(),
            "candidate_version": candidate_version,
            "request_file": req_path.name,
            "recent_features_seen": int(recent_stats.get("seen", 0)),
            "recent_features_used_for_retrain": int(recent_stats.get("used_for_retrain", 0)),
            "recent_features_used_for_reference": int(recent_stats.get("used_for_reference", 0)),
            "recent_features_used_true_labels_for_retrain": int(
                recent_stats.get("used_true_labels_for_retrain", 0)
            ),
            "recent_features_used_pseudo_labels_for_retrain": int(
                recent_stats.get("used_pseudo_labels_for_retrain", 0)
            ),
        },
        str(w.reports_dir / "last_retrain.json"),
    )

    ok, reason = _promotion_gate(w, report)
    if ok and bool(w.promote.get("auto_promote", True)):
        _promote(w, candidate_version)
        print(f"[watcher] ACTIVE -> {candidate_version}")
    else:
        print(f"[watcher] not promoted: {reason}")

    dest = w.processed_dir / req_path.name
    req_path.replace(dest)


def main() -> None:
    ap = argparse.ArgumentParser(description="Retrain/promote watcher")
    ap.add_argument(
        "--config",
        default=os.getenv("WATCHER_CONFIG_PATH", "config.yaml"),
        help="Path to config file for this watcher domain",
    )
    args = ap.parse_args()

    w = _load_cfg(args.config)
    _ensure_dirs(w)

    poll_s = float(w.promote.get("poll_seconds", 1.0))

    print("[watcher] started")
    print(f"[watcher] watching: {w.requests_dir}")

    while True:
        reqs = _list_requests(w.requests_dir)
        if not reqs:
            time.sleep(poll_s)
            continue

        if not _train_cooldown_ok(w):
            print("[watcher] cooldown active, skipping")
            time.sleep(poll_s)
            continue

        req_path = reqs[0]
        try:
            _handle_request(w, req_path)
        except Exception as e:
            print(f"[watcher] error: {e!r}")
            try:
                req_path.replace(w.failed_dir / req_path.name)
            except Exception:
                pass

        for extra in reqs[1:]:
            try:
                extra.unlink()
                print(f"[watcher] dropped duplicate request: {extra.name}")
            except Exception:
                pass

        time.sleep(poll_s)


if __name__ == "__main__":
    main()
