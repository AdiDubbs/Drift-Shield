from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fraud_service.utils.io import load_json, save_json


def utc_tag() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def ensure_parent(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def _read_pointer(path: str, key: str) -> Optional[str]:
    p = Path(path)
    if not p.exists():
        return None
    try:
        obj = load_json(str(p))
        v = obj.get(key)
        return str(v) if v else None
    except Exception:
        return None


def _write_pointer(path: str, key: str, version: str) -> None:
    ensure_parent(path)
    save_json({key: version}, path)

def read_active_model(active_path: str) -> Optional[str]:
    return _read_pointer(active_path, "active_version")


def read_shadow_model(shadow_path: str) -> Optional[str]:
    return _read_pointer(shadow_path, "shadow_version")


def read_rollback_model(rollback_path: str) -> Optional[str]:
    return _read_pointer(rollback_path, "rollback_version")


def write_active_model(path: str, version: str) -> None:
    _write_pointer(path, "active_version", version)


def write_shadow_model(path: str, version: str) -> None:
    _write_pointer(path, "shadow_version", version)


def write_rollback_model(path: str, version: str) -> None:
    _write_pointer(path, "rollback_version", version)

def load_manifest(manifest_path: str) -> Dict[str, Any]:
    p = Path(manifest_path)
    if not p.exists():
        return {"active": None, "versions": {}}
    return load_json(str(p))


def save_manifest(manifest_path: str, manifest: Dict[str, Any]) -> None:
    ensure_parent(manifest_path)
    save_json(manifest, manifest_path)


def register_version(
    manifest_path: str,
    model_version: str,
    version_artifacts: Dict[str, str],
    make_active: bool = False,
    active_path: Optional[str] = None,
) -> None:
    m = load_manifest(manifest_path)
    m.setdefault("versions", {})

    m["versions"][model_version] = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        **version_artifacts,
    }

    if make_active:
        m["active"] = model_version
        if active_path is not None:
            write_active_model(active_path, model_version)

    save_manifest(manifest_path, m)


def resolve_version_paths(cfg: dict, model_version: Optional[str]) -> Dict[str, str]:
    paths = cfg.get("paths", {})

    models_dir = paths.get("versions_dir", "artifacts/models/versions")
    active_path = paths.get("active_ptr", "artifacts/models/ACTIVE_MODEL.json")
    manifest_path = paths.get("manifest_path", "artifacts/models/manifest.json")

    if model_version is None:
        model_version = read_active_model(active_path)

    if model_version is None:
        try:
            m = load_manifest(manifest_path)
            model_version = m.get("active")
        except Exception:
            model_version = None

    if model_version is None:
        return {
            "model_path": paths["model_path"],
            "calibrator_path": paths.get("calibrator_path", "artifacts/models/proba_calibrator.joblib"),
            "qhat_path": paths["qhat_path"],
            "calib_meta_path": paths["calib_meta_path"],
            "drift_ref_path": paths["drift_ref_path"],
            "model_version": "legacy_single",
        }

    vdir = Path(models_dir) / model_version
    return {
        "model_path": str(vdir / "xgb_model.json"),
        "calibrator_path": str(vdir / "proba_calibrator.joblib"),
        "qhat_path": str(vdir / "qhat.npy"),
        "calib_meta_path": str(vdir / "calib_meta.json"),
        "drift_ref_path": str(vdir / "drift_reference.json"),
        "model_version": model_version,
    }
