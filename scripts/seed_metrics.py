from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
import requests

from fraud_service.utils.io import load_yaml


def wait_for_api(url: str, timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    last_err = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{url}/health", timeout=2.0)
            if r.ok:
                return
        except Exception as e:  # pragma: no cover
            last_err = e
        time.sleep(1.0)
    raise RuntimeError(f"API not ready at {url}: {last_err}")


def seed_requests(url: str, n: int, csv_path: Path, target_col: str) -> None:
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing seed CSV: {csv_path}")

    df = pd.read_csv(csv_path)
    X = df.drop(columns=[target_col])
    total = min(n, len(X))
    if total <= 0:
        return

    print(f"[seed] Sending {total} requests to {url}/predict from {csv_path}")
    ok = 0
    for i in range(total):
        row = X.iloc[i].to_dict()
        try:
            r = requests.post(
                f"{url}/predict",
                json={"schema_version": 1, "transaction_features": row},
                timeout=5.0,
            )
            r.raise_for_status()
            ok += 1
        except Exception:
            continue
    print(f"[seed] Completed: {ok}/{total} successful")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed API traffic so dashboard metrics are non-empty")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--n", type=int, default=200)
    parser.add_argument("--csv", default="data/processed/test.csv")
    args = parser.parse_args()

    cfg = load_yaml("config.yaml")
    target_col = cfg["data"]["target_col"]

    wait_for_api(args.url)
    seed_requests(args.url, args.n, Path(args.csv), target_col)


if __name__ == "__main__":
    main()
