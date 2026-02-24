from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import xgboost as xgb

from fraud_service.utils.io import load_yaml
from fraud_service.uncertainty.conformal import load_calib, prediction_set
from fraud_service.drift.detector import DriftDetector

logger = logging.getLogger(__name__)


@dataclass
class ModelBundle:
    model: xgb.Booster
    calibrator: Any
    calib: Any
    drift: DriftDetector
    feature_names: List[str]
    cfg: dict
    model_version: str


def _read_pointer(path: Path, key: str, retries: int = 3) -> Optional[str]:
    for attempt in range(retries):
        if not path.exists():
            return None

        try:
            raw = path.read_text()
        except OSError:
            if attempt < retries - 1:
                time.sleep(0.02)
                continue
            return None

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            if attempt < retries - 1:
                time.sleep(0.02)
                continue
            return None

        value = data.get(key)
        if value is None:
            return None

        cleaned = str(value).strip()
        return cleaned if cleaned else None

    return None


def _resolve_version_dir(cfg: dict, version: str) -> Path:
    paths = cfg.get("paths", {})
    versions_dir = Path(paths["versions_dir"])
    if not versions_dir.is_absolute():
        repo_root = Path(paths.get("repo_root", "."))
        versions_dir = repo_root / versions_dir
    return versions_dir / version


def _load_xgb(model_path: Path) -> xgb.Booster:
    booster = xgb.Booster()
    booster.load_model(str(model_path))
    return booster


def _load_versioned_bundle(cfg: dict, version: str) -> ModelBundle:
    vdir = _resolve_version_dir(cfg, version)
    if not vdir.exists():
        raise FileNotFoundError(f"Version dir not found: {vdir}")

    model_path = vdir / "xgb_model.json"
    cal_path = vdir / "proba_calibrator.joblib"
    qhat_path = vdir / "qhat.npy"
    meta_path = vdir / "calib_meta.json"

    drift_ref_path = vdir / "drift_reference.json"
    if not drift_ref_path.exists():
        drift_ref_path = vdir / "reference.json"

    if not model_path.exists():
        raise FileNotFoundError(f"Missing model: {model_path}")
    if not cal_path.exists():
        raise FileNotFoundError(f"Missing calibrator: {cal_path}")
    if not qhat_path.exists():
        raise FileNotFoundError(f"Missing qhat: {qhat_path}")
    if not meta_path.exists():
        raise FileNotFoundError(f"Missing calib_meta: {meta_path}")
    if not drift_ref_path.exists():
        raise FileNotFoundError(f"Missing drift reference: {drift_ref_path}")

    model = _load_xgb(model_path)
    calibrator = joblib.load(str(cal_path))
    calib = load_calib(str(qhat_path), str(meta_path))
    drift = DriftDetector.from_reference(str(drift_ref_path), cfg)

    feature_names = drift.feature_names

    return ModelBundle(
        model=model,
        calibrator=calibrator,
        calib=calib,
        drift=drift,
        feature_names=feature_names,
        cfg=cfg,
        model_version=version,
    )


class BundleManager:
    def __init__(self, config_path: str = "config.yaml"):
        self._config_path = Path(config_path).expanduser().resolve()
        self.cfg = load_yaml(str(self._config_path))
        self._lock = threading.Lock()

        self._active_version: Optional[str] = None
        self._shadow_version: Optional[str] = None

        self._active_bundle: Optional[ModelBundle] = None
        self._shadow_bundle: Optional[ModelBundle] = None

        repo_root_cfg = Path(self.cfg.get("paths", {}).get("repo_root", "."))
        if repo_root_cfg.is_absolute():
            self._repo_root = repo_root_cfg
        else:
            self._repo_root = (self._config_path.parent / repo_root_cfg).resolve()
        self.cfg.setdefault("paths", {})
        self.cfg["paths"]["repo_root"] = str(self._repo_root)
        self._active_ptr = self._repo_root / self.cfg["paths"]["active_ptr"]
        self._shadow_ptr = self._repo_root / self.cfg["paths"]["shadow_ptr"]

    def get_active(self) -> ModelBundle:
        with self._lock:
            version = _read_pointer(self._active_ptr, "active_version")
            if not version:
                if self._active_bundle is not None:
                    logger.warning(
                        "ACTIVE pointer missing/invalid at %s; keeping last loaded version %s",
                        self._active_ptr,
                        self._active_version,
                    )
                    return self._active_bundle
                raise RuntimeError(f"ACTIVE pointer missing or invalid: {self._active_ptr}")

            if self._active_bundle and self._active_version == version:
                return self._active_bundle

            try:
                bundle = _load_versioned_bundle(self.cfg, version)
            except Exception as e:
                if self._active_bundle is not None:
                    logger.warning(
                        "Failed to swap ACTIVE model to %s (%s). Keeping previous version %s",
                        version,
                        e,
                        self._active_version,
                    )
                    return self._active_bundle
                raise

            self._active_bundle = bundle
            self._active_version = version
            return bundle

    def get_shadow(self) -> Optional[ModelBundle]:
        with self._lock:
            version = _read_pointer(self._shadow_ptr, "shadow_version")
            if not version:
                if self._shadow_bundle is not None:
                    logger.warning(
                        "SHADOW pointer missing/invalid at %s; keeping last loaded shadow version %s",
                        self._shadow_ptr,
                        self._shadow_version,
                    )
                return self._shadow_bundle

            if self._shadow_bundle and self._shadow_version == version:
                return self._shadow_bundle

            try:
                bundle = _load_versioned_bundle(self.cfg, version)
            except Exception as e:
                if self._shadow_bundle is not None:
                    logger.warning(
                        "Failed to swap SHADOW model to %s (%s). Keeping previous version %s",
                        version,
                        e,
                        self._shadow_version,
                    )
                    return self._shadow_bundle
                logger.warning("Failed to load SHADOW model %s (%s). Shadow disabled.", version, e)
                return None

            self._shadow_bundle = bundle
            self._shadow_version = version
            return bundle


def _to_row(feature_names: List[str], feats: Dict[str, float]) -> np.ndarray:
    row = np.zeros((1, len(feature_names)), dtype=np.float32)
    for i, name in enumerate(feature_names):
        if name in feats:
            row[0, i] = float(feats[name])
    return row


def _booster_predict_proba(booster: xgb.Booster, x_row: np.ndarray, feature_names: List[str]) -> np.ndarray:
    dm = xgb.DMatrix(x_row, feature_names=feature_names)
    raw = np.asarray(booster.predict(dm))

    if raw.ndim == 0:
        p1 = float(raw)
        return np.array([1.0 - p1, p1], dtype=np.float64)

    if raw.ndim == 1:
        if raw.shape[0] == 1:
            p1 = float(raw[0])
            return np.array([1.0 - p1, p1], dtype=np.float64)
        probs = raw.astype(np.float64)
        probs = probs / probs.sum() if probs.sum() > 0 else probs
        return probs

    probs = raw[0].astype(np.float64)
    probs = probs / probs.sum() if probs.sum() > 0 else probs
    return probs


def predict_one(bundle: ModelBundle, feats: Dict[str, float]) -> Dict[str, Any]:
    x_row = _to_row(bundle.feature_names, feats)

    proba_raw = _booster_predict_proba(bundle.model, x_row, bundle.feature_names)
    if proba_raw.ndim != 1:
        proba_raw = proba_raw.reshape(-1)

    try:
        proba = bundle.calibrator.predict_proba(proba_raw.reshape(1, -1))[0]
    except Exception:
        p1 = proba_raw[1] if proba_raw.shape[0] >= 2 else proba_raw[0]
        p1_cal = bundle.calibrator.predict([p1])[0]
        proba = np.array([1.0 - p1_cal, p1_cal], dtype=np.float64)

    p_fraud = proba[1] if len(proba) >= 2 else proba[0]
    pred_set = prediction_set(bundle.calib, proba.astype(np.float64))
    drift_out = bundle.drift.update_and_score(x_row)

    return {
        "p_fraud": float(p_fraud),
        "prediction_set": list(pred_set),
        "drift_score": drift_out.get("drift_score", 0.0),
        "top_drifted_features": drift_out.get("top_drifted_features", []),
        "psi_mean": drift_out.get("psi_mean"),
        "ks_flag_frac": drift_out.get("ks_flag_frac"),
        "feature_soft_count": drift_out.get("feature_soft_count"),
        "feature_hard_count": drift_out.get("feature_hard_count"),
    }
