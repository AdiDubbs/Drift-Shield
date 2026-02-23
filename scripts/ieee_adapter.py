# ieee_adapter.py — project IEEE-CIS transaction data into V1–V28 + Amount schema
# then replay it against the running API as a drifted traffic stream.
#
# Usage:
#   PYTHONPATH=src python scripts/ieee_adapter.py prepare
#   PYTHONPATH=src python scripts/ieee_adapter.py replay [--n 2000] [--url http://localhost:8000]

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


IEEE_DIR = Path("ieee-fraud-detection")
OUT_PATH = Path("data/processed/ieee_adapted.csv")

# Numeric columns from train_transaction.csv we use as PCA input.
# Excludes: TransactionID, isFraud (label), TransactionDT (time index),
# ProductCD / card4 / card6 / P_emaildomain / R_emaildomain / M1-M9 (categorical).
NUMERIC_COLS = (
    ["TransactionAmt", "card1", "card2", "card3", "card5",
     "addr1", "addr2", "dist1", "dist2"]
    + [f"C{i}" for i in range(1, 15)]
    + [f"D{i}" for i in range(1, 16)]
    + [f"V{i}" for i in range(1, 340)]
)


def prepare(sample: int | None = None) -> None:
    tx_path = IEEE_DIR / "train_transaction.csv"
    if not tx_path.exists():
        raise FileNotFoundError(f"Expected {tx_path}. Put the IEEE-CIS files in ieee-fraud-detection/")

    print(f"Loading {tx_path} ...")
    df = pd.read_csv(tx_path)

    label = df["isFraud"].astype(int)

    # Keep only numeric columns that actually exist in this file
    cols = [c for c in NUMERIC_COLS if c in df.columns]
    X = df[cols].copy()

    print(f"  {len(X):,} rows, {len(cols)} numeric input features")
    print(f"  Fraud rate: {label.mean():.3%}")

    # Impute nulls with column median (fast, good enough for drift replay)
    print("Imputing nulls ...")
    X = X.fillna(X.median(numeric_only=True))

    if sample:
        idx = np.random.default_rng(42).choice(len(X), size=min(sample, len(X)), replace=False)
        X = X.iloc[idx].reset_index(drop=True)
        label = label.iloc[idx].reset_index(drop=True)
        print(f"  Sampled down to {len(X):,} rows")

    # Standardise then PCA → 28 components
    print("Fitting StandardScaler + PCA(28) ...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    pca = PCA(n_components=28, random_state=42)
    X_pca = pca.fit_transform(X_scaled)
    explained = pca.explained_variance_ratio_.sum()
    print(f"  Explained variance: {explained:.1%}")

    # Build output dataframe with V1–V28 + Amount + Class
    out = pd.DataFrame(X_pca, columns=[f"V{i}" for i in range(1, 29)])

    # Use TransactionAmt (log-scaled) as the Amount analogue
    amt = df["TransactionAmt"].iloc[X.index if sample else slice(None)].reset_index(drop=True)
    out["Amount"] = np.log1p(amt.values)

    out["Class"] = label.values

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_PATH, index=False)
    print(f"\nWrote {len(out):,} rows → {OUT_PATH}")
    print(f"  Columns: {list(out.columns)}")


def replay(n: int, url: str) -> None:
    if not OUT_PATH.exists():
        raise FileNotFoundError(f"{OUT_PATH} not found — run 'prepare' first")

    df = pd.read_csv(OUT_PATH)
    X = df.drop(columns=["Class"])
    n = min(n, len(X))

    print(f"Replaying {n:,} IEEE-CIS transactions → {url}/predict")
    codes: dict[str, int] = {}

    for i in range(n):
        row = X.iloc[i].to_dict()
        try:
            r = requests.post(
                f"{url}/predict",
                json={"schema_version": 1, "transaction_features": row},
                timeout=5,
            )
            r.raise_for_status()
            out = r.json()
            code = out["action_code"]
            codes[code] = codes.get(code, 0) + 1

            if (i + 1) % 200 == 0:
                drift = out["drift"]["drift_score"]
                print(f"  [{i+1:,}] codes={codes}  drift={drift:.4f}")

        except Exception as e:
            print(f"  [{i+1}] ERROR: {e}")

    print(f"\nDone — {codes}")


def main() -> None:
    ap = argparse.ArgumentParser(description="IEEE-CIS → V1–V28 PCA adapter")
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("prepare", help="Project IEEE-CIS data into V1–V28 schema")
    p.add_argument("--sample", type=int, default=None,
                   help="Randomly sample N rows (default: use all ~590k)")

    r = sub.add_parser("replay", help="Send prepared data to the API")
    r.add_argument("--n", type=int, default=2000, help="Number of rows to send")

    args = ap.parse_args()

    if args.cmd == "prepare":
        prepare(sample=args.sample)
    elif args.cmd == "replay":
        replay(n=args.n, url=args.url)


if __name__ == "__main__":
    main()
