from __future__ import annotations

import subprocess
from pathlib import Path

import pandas as pd
from fraud_service.utils.io import load_yaml


ROOT = Path(__file__).resolve().parent.parent
RAW_DATA = ROOT / "data" / "raw" / "creditcard.csv"
ACTIVE_MODEL = ROOT / "artifacts" / "models" / "ACTIVE_MODEL.json"


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, cwd=ROOT)


def ensure_training_data() -> None:
    if RAW_DATA.exists():
        print(f"[bootstrap] Using training dataset at {RAW_DATA}")
        return
    raise FileNotFoundError(f"Missing training dataset: {RAW_DATA}")


def ensure_processed_splits() -> None:
    cfg = load_yaml(str(ROOT / "config.yaml"))
    out_dir = ROOT / "data" / "processed"
    train_path = out_dir / "train.csv"
    calib_path = out_dir / "calib.csv"
    test_path = out_dir / "test.csv"

    if train_path.exists() and calib_path.exists() and test_path.exists():
        print("[bootstrap] Using existing processed split files")
        return

    raw_path = ROOT / cfg["data"]["raw_csv_path"]
    target_col = cfg["data"]["target_col"]
    drop_cols = cfg["data"].get("drop_cols", [])
    seed = int(cfg["project"]["random_seed"])

    print(f"[bootstrap] Building processed splits from {raw_path}")
    df = pd.read_csv(raw_path)

    for c in drop_cols:
        if c in df.columns:
            df = df.drop(columns=[c])

    if target_col not in df.columns:
        raise ValueError(f"Target column '{target_col}' not found in {raw_path}")

    train_frac = float(cfg["split"]["train_frac"])
    calib_frac = float(cfg["split"]["calib_frac"])
    test_frac = float(cfg["split"]["test_frac"])
    if abs((train_frac + calib_frac + test_frac) - 1.0) > 1e-6:
        raise ValueError("train/calib/test fractions must sum to 1.0")

    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    n = len(df)
    n_train = int(n * train_frac)
    n_calib = int(n * calib_frac)

    out_dir.mkdir(parents=True, exist_ok=True)
    df.iloc[:n_train].to_csv(train_path, index=False)
    df.iloc[n_train:n_train + n_calib].to_csv(calib_path, index=False)
    df.iloc[n_train + n_calib:].to_csv(test_path, index=False)
    print(f"[bootstrap] Wrote {train_path}, {calib_path}, {test_path}")


def ensure_initial_model() -> None:
    if ACTIVE_MODEL.exists():
        print(f"[bootstrap] Active model pointer found at {ACTIVE_MODEL}; skipping training")
        return

    if not RAW_DATA.exists():
        print(f"[bootstrap] Missing {RAW_DATA}; cannot train initial model")
        return

    print("[bootstrap] No active model found; running scripts/setup.py")
    _run(["python", "scripts/setup.py"])


def main() -> None:
    ensure_training_data()
    ensure_processed_splits()
    ensure_initial_model()


if __name__ == "__main__":
    main()
