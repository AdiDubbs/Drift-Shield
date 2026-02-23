from pathlib import Path

import pandas as pd

from fraud_service.utils.io import load_yaml
from fraud_service.modeling.train import train_and_save


def prepare_data(cfg: dict) -> None:
    seed = int(cfg["project"]["random_seed"])
    raw_path = cfg["data"]["raw_csv_path"]
    target_col = cfg["data"]["target_col"]
    drop_cols = cfg["data"].get("drop_cols", [])

    out_dir = Path("data/processed")
    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(raw_path)

    for c in drop_cols:
        if c in df.columns:
            df = df.drop(columns=[c])

    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)

    n = len(df)
    train_frac = float(cfg["split"]["train_frac"])
    calib_frac = float(cfg["split"]["calib_frac"])
    test_frac = float(cfg["split"]["test_frac"])

    if abs((train_frac + calib_frac + test_frac) - 1.0) > 1e-6:
        raise ValueError("train/calib/test fractions must sum to 1.0")

    n_train = int(n * train_frac)
    n_calib = int(n * calib_frac)

    train_df = df.iloc[:n_train].copy()
    calib_df = df.iloc[n_train:n_train + n_calib].copy()
    test_df = df.iloc[n_train + n_calib:].copy()

    train_df.to_csv(out_dir / "train.csv", index=False)
    calib_df.to_csv(out_dir / "calib.csv", index=False)
    test_df.to_csv(out_dir / "test.csv", index=False)

    print("Data splits saved to data/processed/")
    print(f"  train: {len(train_df):,}  fraud rate: {train_df[target_col].mean():.4%}")
    print(f"  calib: {len(calib_df):,}  fraud rate: {calib_df[target_col].mean():.4%}")
    print(f"  test:  {len(test_df):,}  fraud rate: {test_df[target_col].mean():.4%}")


def main() -> None:
    cfg = load_yaml("config.yaml")

    print("Preparing data...")
    prepare_data(cfg)

    print("Training model...")
    train_and_save("config.yaml")

    print("Done. Run ./dev.sh to start the API and frontend.")


if __name__ == "__main__":
    main()
