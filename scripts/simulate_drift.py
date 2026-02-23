# dev tool — send normal/drifted traffic to the running API, or run a load test
# usage: PYTHONPATH=src python scripts/simulate_drift.py replay|inject|load-test

from __future__ import annotations

import argparse
import json
import platform
import statistics
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from fraud_service.utils.io import load_yaml, save_json


def _ensure_processed_splits(cfg: dict) -> None:
    out_dir = Path("data/processed")
    test_path = out_dir / "test.csv"
    train_path = out_dir / "train.csv"
    calib_path = out_dir / "calib.csv"

    if test_path.exists() and train_path.exists() and calib_path.exists():
        return

    raw_path = Path(cfg["data"]["raw_csv_path"])
    target_col = cfg["data"]["target_col"]
    drop_cols = cfg["data"].get("drop_cols", [])
    seed = int(cfg["project"]["random_seed"])

    if not raw_path.exists():
        raise FileNotFoundError(f"Missing raw dataset: {raw_path}")

    print(f"[prepare] Processed split files missing; building from {raw_path}")
    df = pd.read_csv(raw_path)

    for c in drop_cols:
        if c in df.columns:
            df = df.drop(columns=[c])

    if target_col not in df.columns:
        raise ValueError(f"Target column '{target_col}' not found in {raw_path}")

    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)

    train_frac = float(cfg["split"]["train_frac"])
    calib_frac = float(cfg["split"]["calib_frac"])
    test_frac = float(cfg["split"]["test_frac"])
    if abs((train_frac + calib_frac + test_frac) - 1.0) > 1e-6:
        raise ValueError("train/calib/test fractions must sum to 1.0")

    n = len(df)
    n_train = int(n * train_frac)
    n_calib = int(n * calib_frac)

    out_dir.mkdir(parents=True, exist_ok=True)
    df.iloc[:n_train].to_csv(train_path, index=False)
    df.iloc[n_train:n_train + n_calib].to_csv(calib_path, index=False)
    df.iloc[n_train + n_calib:].to_csv(test_path, index=False)

    print(f"[prepare] Wrote {train_path}, {calib_path}, {test_path}")


def _replay(csv_path: str, n: int, api_url: str, target_col: str) -> None:
    df = pd.read_csv(csv_path)
    X = df.drop(columns=[target_col])
    codes: dict = {}

    for i in range(min(n, len(X))):
        row = X.iloc[i].to_dict()
        r = requests.post(f"{api_url}/predict", json={"transaction_features": row}, timeout=5)
        r.raise_for_status()
        out = r.json()
        code = out["action_code"]
        codes[code] = codes.get(code, 0) + 1

        if (i + 1) % 200 == 0:
            print(f"  [{i+1}] codes: {codes}  drift_score: {out['drift']['drift_score']:.4f}")

    print(f"  done — {codes}")


def cmd_replay(args: argparse.Namespace) -> None:
    cfg = load_yaml("config.yaml")
    _ensure_processed_splits(cfg)
    target_col = cfg["data"]["target_col"]
    url = args.url
    print(f"Phase 1: normal traffic ({args.n} requests) -> {url}")
    _replay("data/processed/test.csv", args.n, url, target_col)

    print(f"\nPhase 2: drifted traffic ({args.n} requests) -> {url}")
    drifted = "data/processed/test_drifted.csv"
    if not Path(drifted).exists():
        print(f"  {drifted} not found — run 'inject' first")
        return
    _replay(drifted, args.n, url, target_col)

def cmd_inject(args: argparse.Namespace) -> None:
    cfg = load_yaml("config.yaml")
    _ensure_processed_splits(cfg)
    seed = int(cfg["project"]["random_seed"])
    target_col = cfg["data"]["target_col"]
    rng = np.random.default_rng(seed + 99)

    df = pd.read_csv("data/processed/test.csv")
    y = df[target_col]
    X = df.drop(columns=[target_col]).copy()

    cols = list(X.columns)
    main_col = "Amount" if "Amount" in cols else cols[0]

    others = [c for c in cols if c != main_col]
    rng.shuffle(others)
    var_cols = others[:5]
    noise_cols = others[5:10]

    # mean shift
    X[main_col] = X[main_col].astype(float) + 2.5

    # variance inflation
    for c in var_cols:
        m = float(X[c].mean())
        X[c] = (X[c].astype(float) - m) * 1.8 + m

    # gaussian noise
    for c in noise_cols:
        X[c] = X[c].astype(float) + rng.normal(0.0, 0.3, size=len(X))

    out = X.copy()
    out[target_col] = y
    out_path = "data/processed/test_drifted.csv"
    out.to_csv(out_path, index=False)

    Path("artifacts/drift").mkdir(parents=True, exist_ok=True)
    save_json({"main_shift_col": main_col, "var_cols": var_cols, "noise_cols": noise_cols},
              "artifacts/drift/drift_manifest.json")

    print(f"Wrote drifted data to {out_path}")
    print(f"  shift col: {main_col}  var cols: {var_cols}  noise cols: {noise_cols}")

def _one_request(url: str, payload: dict, timeout: float) -> tuple[bool, float]:
    t0 = time.perf_counter()
    try:
        r = requests.post(url, json=payload, timeout=timeout)
        ok = 200 <= r.status_code < 300
        _ = r.text
    except Exception:
        ok = False
    return ok, time.perf_counter() - t0


def _pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (q / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return float(s[f] * (1 - (k - f)) + s[c] * (k - f))


def cmd_load_test(args: argparse.Namespace) -> None:
    url = f"{args.url}/predict"
    payload = {"schema_version": 1, "transaction_features": {}, "request_id": str(uuid.uuid4())}

    print(f"Warming up ({args.warmup} requests)...")
    for _ in range(args.warmup):
        _one_request(url, payload, args.timeout)

    print(f"Load test: {args.requests} requests @ concurrency {args.concurrency}")
    lat_s: list[float] = []
    ok_count = fail_count = 0
    t_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = [ex.submit(_one_request, url, payload, args.timeout) for _ in range(args.requests)]
        for f in as_completed(futs):
            ok, dt = f.result()
            lat_s.append(dt)
            if ok:
                ok_count += 1
            else:
                fail_count += 1

    elapsed = time.perf_counter() - t_start
    lat_ms = [x * 1000 for x in lat_s]
    rps = args.requests / elapsed if elapsed > 0 else 0

    report = {
        "total_requests": args.requests,
        "concurrency": args.concurrency,
        "elapsed_s": elapsed,
        "rps": rps,
        "ok": ok_count,
        "failed": fail_count,
        "error_rate": fail_count / args.requests,
        "latency_ms": {
            "p50": _pct(lat_ms, 50),
            "p95": _pct(lat_ms, 95),
            "p99": _pct(lat_ms, 99),
            "mean": statistics.fmean(lat_ms) if lat_ms else 0.0,
        },
        "machine": platform.platform(),
    }

    out_dir = Path("artifacts/reports")
    out_dir.mkdir(parents=True, exist_ok=True)
    save_json(report, str(out_dir / "load_test_latest.json"))

    print(f"\nRPS:        {rps:.1f}")
    print(f"P50:        {report['latency_ms']['p50']:.1f} ms")
    print(f"P95:        {report['latency_ms']['p95']:.1f} ms")
    print(f"P99:        {report['latency_ms']['p99']:.1f} ms")
    print(f"Error rate: {report['error_rate']:.2%}")
    print(f"Wrote: {out_dir / 'load_test_latest.json'}")

def main() -> None:
    ap = argparse.ArgumentParser(description="Simulate drift and test the API")
    ap.add_argument("--url", default="http://127.0.0.1:8000", help="API base URL")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_replay = sub.add_parser("replay", help="Send normal then drifted traffic to the API")
    p_replay.add_argument("--n", type=int, default=1200, help="Requests per phase")

    sub.add_parser("inject", help="Create a drifted copy of test.csv")

    p_load = sub.add_parser("load-test", help="Benchmark API throughput")
    p_load.add_argument("--requests", type=int, default=2000)
    p_load.add_argument("--concurrency", type=int, default=50)
    p_load.add_argument("--warmup", type=int, default=50)
    p_load.add_argument("--timeout", type=float, default=5.0)

    args = ap.parse_args()

    if args.cmd == "replay":
        cmd_replay(args)
    elif args.cmd == "inject":
        cmd_inject(args)
    elif args.cmd == "load-test":
        cmd_load_test(args)


if __name__ == "__main__":
    main()
