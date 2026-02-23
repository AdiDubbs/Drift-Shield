from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression

from fraud_service.utils.io import load_yaml, save_json
from fraud_service.uncertainty.conformal import fit_split_conformal, save_calib
from fraud_service.drift.reference import build_reference_from_train_csv
from fraud_service.modeling.registry import utc_tag, register_version, write_active_model


def _load_split(path: str, target_col: str) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    df = pd.read_csv(path)
    if target_col not in df.columns:
        raise ValueError(f"Missing target col {target_col} in {path}")

    y = df[target_col].astype(int).values
    X_df = df.drop(columns=[target_col])

    feature_names = list(X_df.columns)
    X = X_df.values.astype(np.float32)
    return X, y, feature_names


@dataclass
class ProbaCalibrator:
    _iso: Any

    def fit(self, p_raw: np.ndarray, y: np.ndarray) -> "ProbaCalibrator":
        p_raw = np.asarray(p_raw, dtype=np.float64).reshape(-1)
        y = np.asarray(y, dtype=np.int32).reshape(-1)

        iso = IsotonicRegression(out_of_bounds="clip")
        iso.fit(p_raw, y)
        self._iso = iso
        return self

    def predict_p1(self, p_raw: np.ndarray) -> np.ndarray:
        p_raw = np.asarray(p_raw, dtype=np.float64).reshape(-1)
        p1 = np.asarray(self._iso.predict(p_raw), dtype=np.float64)
        return np.clip(p1, 1e-12, 1.0 - 1e-12)

    def predict_proba(self, raw_probas_2col: np.ndarray) -> np.ndarray:
        raw_probas_2col = np.asarray(raw_probas_2col, dtype=np.float64)
        if raw_probas_2col.ndim != 2 or raw_probas_2col.shape[1] != 2:
            raise ValueError("predict_proba expects [n,2] raw probas")
        p_raw = raw_probas_2col[:, 1]
        p1 = self.predict_p1(p_raw)
        p0 = 1.0 - p1
        return np.vstack([p0, p1]).T


def train_and_save(
    config_path: str = "config.yaml",
    make_active: bool = True,
    model_version: Optional[str] = None,
    train_data_path: Optional[str] = None,
    calib_data_path: Optional[str] = None,
) -> str:
    cfg = load_yaml(config_path)

    target_col = cfg["data"]["target_col"]
    alpha = float(cfg["conformal"]["alpha"])
    labels = list(cfg["conformal"]["labels"])
    seed = int(cfg["project"]["random_seed"])

    train_path = train_data_path or "data/processed/train.csv"
    calib_path = calib_data_path or "data/processed/calib.csv"

    X_train, y_train, feat_names_train = _load_split(train_path, target_col)
    X_calib, y_calib, feat_names_calib = _load_split(calib_path, target_col)

    if feat_names_train != feat_names_calib:
        raise ValueError("Train/calib feature columns don't match (unexpected)")

    params: Dict[str, Any] = dict(cfg["model"]["params"])
    params.setdefault("random_state", seed)

    n_pos = int(y_train.sum())
    n_neg = int(len(y_train) - n_pos)
    if n_pos > 0:
        params.setdefault("scale_pos_weight", n_neg / max(1, n_pos))

    model = xgb.XGBClassifier(**params)
    model.fit(X_train, y_train)

    raw_calib = model.predict_proba(X_calib)

    calibrator = ProbaCalibrator(_iso=None).fit(raw_calib[:, 1], y_calib)
    cal_calib = calibrator.predict_proba(raw_calib)

    calib = fit_split_conformal(
        probas_calib=cal_calib,
        y_calib=y_calib,
        alpha=alpha,
        labels=labels,
    )

    if model_version is None:
        model_version = f"v_{utc_tag()}"

    paths = cfg.get("paths", {})
    models_dir = paths.get("versions_dir", "artifacts/models/versions")
    manifest_path = paths.get("manifest_path", "artifacts/models/manifest.json")
    active_model_path = paths.get("active_ptr", "artifacts/models/ACTIVE_MODEL.json")

    vdir = Path(models_dir) / model_version
    vdir.mkdir(parents=True, exist_ok=True)

    model_path_v = str(vdir / "xgb_model.json")
    calibrator_path_v = str(vdir / "proba_calibrator.joblib")
    qhat_path_v = str(vdir / "qhat.npy")
    meta_path_v = str(vdir / "calib_meta.json")
    drift_ref_path_v = str(vdir / "drift_reference.json")
    ref_sample_path_v = str(vdir / "ref_sample.npy")

    model.save_model(model_path_v)
    joblib.dump(calibrator, calibrator_path_v)
    save_calib(calib, qhat_path=qhat_path_v, meta_path=meta_path_v)

    build_reference_from_train_csv(
        train_csv_path=train_path,
        target_col=target_col,
        out_json_path=drift_ref_path_v,
        out_ref_sample_path=ref_sample_path_v,
        n_ref_sample=5000,
        psi_bins=10,
        seed=seed,
    )

    register_version(
        manifest_path=manifest_path,
        model_version=model_version,
        version_artifacts={
            "model_path": model_path_v,
            "calibrator_path": calibrator_path_v,
            "qhat_path": qhat_path_v,
            "calib_meta_path": meta_path_v,
            "drift_ref_path": drift_ref_path_v,
        },
        make_active=make_active,
        active_path=active_model_path,
    )

    if make_active:
        write_active_model(active_model_path, model_version)

        legacy_model = paths.get("model_path", "artifacts/models/xgb_model.json")
        legacy_cal = paths.get("calibrator_path", "artifacts/models/proba_calibrator.joblib")
        legacy_qhat = paths.get("qhat_path", "artifacts/conformal/qhat.npy")
        legacy_meta = paths.get("calib_meta_path", "artifacts/conformal/calib_meta.json")
        legacy_drift = paths.get("drift_ref_path", "artifacts/drift/reference.json")

        Path(legacy_model).parent.mkdir(parents=True, exist_ok=True)
        Path(legacy_qhat).parent.mkdir(parents=True, exist_ok=True)
        Path(legacy_drift).parent.mkdir(parents=True, exist_ok=True)

        model.save_model(legacy_model)
        joblib.dump(calibrator, legacy_cal)
        save_calib(calib, qhat_path=legacy_qhat, meta_path=legacy_meta)
        save_json(
            {
                "feature_names": feat_names_train,
                "train_rows": int(X_train.shape[0]),
                "calib_rows": int(X_calib.shape[0]),
                "alpha": alpha,
                "qhat": float(calib.qhat),
                "model_version": model_version,
            },
            legacy_drift,
        )

    print("Saved version:", model_version)
    print("Saved versioned artifacts to:", str(vdir))
    print("make_active:", bool(make_active))
    print("qhat:", float(calib.qhat), "threshold prob >= ", 1.0 - float(calib.qhat))

    return model_version


if __name__ == "__main__":
    train_and_save()