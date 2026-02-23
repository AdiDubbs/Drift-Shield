from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
import requests

from fraud_service.utils.io import load_yaml


def wait_for_api(url: str, timeout_s: float = 60.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            r = requests.get(f"{url}/health", timeout=2.0)
            if r.ok:
                return
        except Exception:
            pass
        time.sleep(1.0)
    raise RuntimeError(f"API did not become ready at {url}")


def main() -> None:
    p = argparse.ArgumentParser(description="Continuously send low-rate traffic for dashboard visualization")
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--csv", default="data/processed/test.csv")
    p.add_argument("--sleep", type=float, default=0.2, help="Seconds between requests")
    p.add_argument("--max", type=int, default=0, help="Max requests (0 = infinite)")
    args = p.parse_args()

    cfg = load_yaml("config.yaml")
    target_col = cfg["data"]["target_col"]
    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing traffic CSV: {csv_path}")

    wait_for_api(args.url)
    df = pd.read_csv(csv_path)
    X = df.drop(columns=[target_col])
    total_rows = len(X)
    if total_rows == 0:
        raise RuntimeError("Traffic CSV has no rows")

    sent = 0
    idx = 0
    while True:
        row = X.iloc[idx].to_dict()
        try:
            requests.post(
                f"{args.url}/predict",
                json={"schema_version": 1, "transaction_features": row},
                timeout=5.0,
            )
        except Exception:
            pass

        sent += 1
        idx = (idx + 1) % total_rows

        if args.max > 0 and sent >= args.max:
            break

        time.sleep(max(0.01, args.sleep))


if __name__ == "__main__":
    main()
