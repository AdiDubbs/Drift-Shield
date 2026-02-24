from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd
import joblib
import xgboost as xgb

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
    repo_root: Path
    requests_dir: Path
    processed_dir: Path
    failed_dir: Path
    reports_dir: Path
    versions_dir: Path
    active_ptr: Path
    shadow_ptr: Path
    rollback_ptr: Path
    retrain: Dict[str, Any]
    promote: Dict[str, Any]
    cfg: Dict[str, Any]


def _load_cfg(config_path: str = "config.yaml") -> WatcherCfg:
    cfg = load_yaml(config_path)
    paths = cfg.get("paths", {})
    repo_root = Path(paths.get("repo_root", ".")).resolve()
    requests_dir = repo_root / paths.get("retrain_requests_dir", "artifacts/retrain_requests")

    return WatcherCfg(
        repo_root=repo_root,
        requests_dir=requests_dir,
        processed_dir=requests_dir / "processed",
        failed_dir=requests_dir / "failed",
        reports_dir=repo_root / paths.get("reports_dir", "artifacts/reports"),
        versions_dir=repo_root / paths.get("versions_dir", "artifacts/models/versions"),
        active_ptr=repo_root / paths.get("active_ptr", "artifacts/models/ACTIVE_MODEL.json"),
        shadow_ptr=repo_root / paths.get("shadow_ptr", "artifacts/models/SHADOW_MODEL.json"),
        rollback_ptr=repo_root / paths.get("rollback_ptr", "artifacts/models/ROLLBACK_MODEL.json"),
        retrain=cfg.get("retrain", {}),
        promote=cfg.get("promote", {}),
        cfg=cfg,
    )


def _ensure_dirs(w: WatcherCfg) -> None:
    for p in [w.requests_dir, w.processed_dir, w.failed_dir, w.reports_dir, w.versions_dir]:
        p.mkdir(parents=True, exist_ok=True)

def _prepare_retrain_data(w: WatcherCfg) -> tuple[str, str]:
    cfg = w.cfg
    seed = int(cfg["project"]["random_seed"])
    target_col = cfg["data"]["target_col"]
    old_ratio = float(cfg.get("retrain", {}).get("old_data_ratio", 0.7))

    original_train = w.repo_root / "data/processed/train.csv"
    original_calib = w.repo_root / "data/processed/calib.csv"
    drifted_path = w.repo_root / "data/processed/test_drifted.csv"
    fallback_test_path = w.repo_root / "data/processed/test.csv"

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

    n_old = int(len(df_orig) * old_ratio)
    df_combined = pd.concat([
        df_orig.sample(n=n_old, random_state=seed),
        df_drifted,
    ], ignore_index=True).sample(frac=1.0, random_state=seed).reset_index(drop=True)

    n_train = int(len(df_combined) * 0.85)
    df_train = df_combined.iloc[:n_train]
    df_calib = df_combined.iloc[n_train:]

    out_dir = w.repo_root / "data/retrain"
    out_dir.mkdir(parents=True, exist_ok=True)

    train_path = str(out_dir / "retrain_train.csv")
    calib_path = str(out_dir / "retrain_calib.csv")

    df_train.to_csv(train_path, index=False)
    df_calib.to_csv(calib_path, index=False)

    print(f"[watcher] retrain data: {len(df_train):,} train, {len(df_calib):,} calib")
    return train_path, calib_path

def _eval_candidate(w: WatcherCfg, candidate_version: str, active_version: str) -> Dict[str, Any]:
    cfg = w.cfg
    target_col = cfg["data"]["target_col"]
    seed = int(cfg["project"]["random_seed"])
    fp_cost = float(cfg.get("eval", {}).get("fp_cost", 1.0))
    fn_cost = float(cfg.get("eval", {}).get("fn_cost", 10.0))
    abstain_cost = float(cfg.get("eval", {}).get("abstain_cost", 0.2))

    test_df = pd.read_csv(w.repo_root / "data/processed/test.csv")
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
        }

    cand_metrics = _score_version(candidate_version)
    active_metrics = _score_version(active_version)

    baseline_path = w.reports_dir / "summary.json"
    baseline = load_json(str(baseline_path)) if baseline_path.exists() else {}
    baseline_cost = float((baseline.get("costs") or {}).get("avg_cost_per_txn", active_metrics["avg_cost_per_txn"]))

    return {
        "active_version": active_version,
        "candidate_version": candidate_version,
        "active_eval": active_metrics,
        "candidate_eval": cand_metrics,
        "baseline_cost": baseline_cost,
        "cand_cost": cand_metrics["avg_cost_per_txn"],
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

    max_cost_increase = float(w.promote.get("max_cost_increase", 0.05))
    cand_cost = report.get("cand_cost")
    base_cost = report.get("baseline_cost")
    if cand_cost is not None and base_cost is not None:
        if float(cand_cost) > float(base_cost) * (1.0 + max_cost_increase):
            return False, "COST_REGRESSION"

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

    train_path, calib_path = _prepare_retrain_data(w)

    candidate_version = train_and_save(
        "config.yaml",
        make_active=False,
        train_data_path=train_path,
        calib_data_path=calib_path,
    )

    active_version = read_active_model(str(w.active_ptr))
    if not active_version:
        raise RuntimeError("No active model found — cannot evaluate candidate")

    report = _eval_candidate(w, candidate_version, active_version)
    report_path = w.reports_dir / f"retrain_candidate_{candidate_version}.json"
    save_json(report, str(report_path))
    print(f"[watcher] wrote report: {report_path.name}")

    write_shadow_model(str(w.shadow_ptr), candidate_version)
    print(f"[watcher] SHADOW -> {candidate_version}")

    save_json(
        {"ts": time.time(), "candidate_version": candidate_version, "request_file": req_path.name},
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
    w = _load_cfg("config.yaml")
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
