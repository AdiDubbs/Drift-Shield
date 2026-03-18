from pathlib import Path

import pandas as pd

from fraud_service.utils.io import load_yaml
from fraud_service.modeling.train import train_and_save


def prepare_data(cfg: dict) -> None:
    seed = int(cfg["project"]["random_seed"])
    raw_path = cfg["data"]["raw_csv_path"]
    identity_path = cfg["data"].get("identity_csv_path")
    join_key = cfg["data"].get("join_key", "TransactionID")
    merge_how = cfg["data"].get("merge_how", "left")
    target_col = cfg["data"]["target_col"]
    source_target_col = cfg["data"].get("source_target_col", target_col)
    drop_cols = cfg["data"].get("drop_cols", [])
    identity_drop_cols = cfg["data"].get("identity_drop_cols", [])
    numeric_only = bool(cfg["data"].get("numeric_only", False))
    fillna_median = bool(cfg["data"].get("fillna_median", False))
    max_rows = cfg["data"].get("max_rows")

    train_out = Path(cfg["data"].get("train_csv_path", "data/processed/train.csv"))
    calib_out = Path(cfg["data"].get("calib_csv_path", "data/processed/calib.csv"))
    test_out = Path(cfg["data"].get("test_csv_path", "data/processed/test.csv"))
    train_out.parent.mkdir(parents=True, exist_ok=True)
    calib_out.parent.mkdir(parents=True, exist_ok=True)
    test_out.parent.mkdir(parents=True, exist_ok=True)

    read_nrows = int(max_rows) if max_rows is not None else None
    tx_df = pd.read_csv(raw_path, nrows=read_nrows)
    df = tx_df

    if identity_path:
        id_df = pd.read_csv(identity_path)
        for c in identity_drop_cols:
            if c in id_df.columns:
                id_df = id_df.drop(columns=[c])

        if join_key not in tx_df.columns:
            raise ValueError(f"Join key '{join_key}' missing in transaction file: {raw_path}")
        if join_key not in id_df.columns:
            raise ValueError(f"Join key '{join_key}' missing in identity file: {identity_path}")

        # Filter identity rows to the transaction slice we are training on.
        id_df = id_df[id_df[join_key].isin(tx_df[join_key])]
        df = tx_df.merge(id_df, on=join_key, how=merge_how)
        print(
            "Merged identity features:",
            f"{len(tx_df):,} transaction rows + {len(id_df):,} identity rows -> {len(df):,} merged rows",
        )

    for c in drop_cols:
        if c in df.columns:
            df = df.drop(columns=[c])

    if source_target_col != target_col:
        if source_target_col not in df.columns:
            raise ValueError(f"Source target col '{source_target_col}' missing in {raw_path}")
        df = df.rename(columns={source_target_col: target_col})

    if target_col not in df.columns:
        raise ValueError(f"Missing target col '{target_col}' in {raw_path}")

    if numeric_only:
        numeric_cols = list(df.select_dtypes(include=["number"]).columns)
        if target_col not in numeric_cols:
            numeric_cols.append(target_col)
        df = df[numeric_cols]

    if fillna_median:
        medians = df.median(numeric_only=True)
        df = df.fillna(medians)

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

    train_df.to_csv(train_out, index=False)
    calib_df.to_csv(calib_out, index=False)
    test_df.to_csv(test_out, index=False)

    print("Data splits saved:")
    print(f"  train -> {train_out}")
    print(f"  calib -> {calib_out}")
    print(f"  test  -> {test_out}")
    print(f"  train: {len(train_df):,}  fraud rate: {train_df[target_col].mean():.4%}")
    print(f"  calib: {len(calib_df):,}  fraud rate: {calib_df[target_col].mean():.4%}")
    print(f"  test:  {len(test_df):,}  fraud rate: {test_df[target_col].mean():.4%}")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Prepare splits and train model from config")
    ap.add_argument("--config", default="config.yaml", help="Path to config YAML")
    args = ap.parse_args()

    cfg = load_yaml(args.config)

    print("Preparing data...")
    prepare_data(cfg)

    print("Training model...")
    train_and_save(args.config)

    print("Done. Run ./dev.sh to start the API and frontend.")


if __name__ == "__main__":
    main()
