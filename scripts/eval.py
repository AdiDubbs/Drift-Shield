"""
eval.py — evaluate the active model on the test split and write a report.

Usage:
    PYTHONPATH=src python scripts/eval.py
"""

from pathlib import Path

import json

import numpy as np
import pandas as pd
import xgboost as xgb
import joblib

from fraud_service.utils.io import load_yaml, save_json
from fraud_service.uncertainty.conformal import load_calib, prediction_set


def _resolve_active_version(cfg: dict) -> str:
    active_ptr = Path(cfg["paths"]["active_ptr"])
    if not active_ptr.exists():
        raise FileNotFoundError(f"Active model pointer not found: {active_ptr}")
    data = json.loads(active_ptr.read_text())
    version = data.get("active_version")
    if not version:
        raise RuntimeError(f"active_version missing in {active_ptr}")
    return str(version)


def main() -> None:
    cfg = load_yaml("config.yaml")
    target_col = cfg["data"]["target_col"]
    alpha = float(cfg["conformal"]["alpha"])
    labels = list(cfg["conformal"]["labels"])
    fp_cost = float(cfg["eval"]["fp_cost"])
    fn_cost = float(cfg["eval"]["fn_cost"])
    abstain_cost = float(cfg["eval"].get("abstain_cost", 0.2))

    test_df = pd.read_csv("data/processed/test.csv")
    y = test_df[target_col].astype(int).values
    X = test_df.drop(columns=[target_col]).values.astype(np.float32)

    version = _resolve_active_version(cfg)
    vdir = Path(cfg["paths"]["versions_dir"]) / version
    print(f"Evaluating active model: {version}")

    model = xgb.XGBClassifier()
    model.load_model(str(vdir / "xgb_model.json"))
    calibrator = joblib.load(str(vdir / "proba_calibrator.joblib"))
    calib = load_calib(str(vdir / "qhat.npy"), str(vdir / "calib_meta.json"))

    probas = calibrator.predict_proba(model.predict_proba(X))
    pred_sets = [prediction_set(calib, probas[i]) for i in range(len(y))]
    set_sizes = np.array([len(s) for s in pred_sets])
    true_labels = np.array([labels[t] for t in y])

    covered = np.array([true_labels[i] in pred_sets[i] for i in range(len(y))])
    predicted_idx = np.where(set_sizes == 1)[0]
    pred_label = np.array([pred_sets[i][0] if set_sizes[i] == 1 else None for i in range(len(y))], dtype=object)

    total_cost = fp = fn = 0
    for i in range(len(y)):
        if set_sizes[i] != 1:
            total_cost += abstain_cost
            continue
        yhat = 1 if pred_sets[i][0] == "fraud" else 0
        if yhat == 1 and y[i] == 0:
            fp += 1
            total_cost += fp_cost
        elif yhat == 0 and y[i] == 1:
            fn += 1
            total_cost += fn_cost

    # Risk-coverage curve
    conf = np.max(probas, axis=1)
    order = np.argsort(-conf)
    rows = []
    for cf in np.linspace(0.1, 1.0, 19):
        k = max(1, int(len(y) * cf))
        idx = order[:k]
        yhat = np.argmax(probas[idx], axis=1)
        rows.append({"coverage_frac": float(cf), "risk_error_rate": float((yhat != y[idx]).mean())})

    reports_dir = Path(cfg["paths"]["reports_dir"])
    reports_dir.mkdir(parents=True, exist_ok=True)

    pd.DataFrame(rows).to_csv(reports_dir / "risk_coverage.csv", index=False)

    summary = {
        "rows": int(len(y)),
        "target_coverage": 1.0 - alpha,
        "empirical_coverage": float(covered.mean()),
        "abstain_rate": float((set_sizes != 1).mean()),
        "selective_accuracy": float(
            (pred_label[predicted_idx] == true_labels[predicted_idx]).mean()
        ) if len(predicted_idx) else 0.0,
        "set_size_counts": {
            "size0": int((set_sizes == 0).sum()),
            "size1": int((set_sizes == 1).sum()),
            "size2": int((set_sizes == 2).sum()),
        },
        "costs": {
            "fp_cost": fp_cost,
            "fn_cost": fn_cost,
            "abstain_cost": abstain_cost,
            "false_positives": int(fp),
            "false_negatives": int(fn),
            "avg_cost_per_txn": float(total_cost / len(y)),
        },
    }

    save_json(summary, str(reports_dir / "summary.json"))

    print("=== Eval report ===")
    print(f"rows:               {summary['rows']:,}")
    print(f"empirical coverage: {summary['empirical_coverage']:.4f}  (target {summary['target_coverage']:.2f})")
    print(f"abstain rate:       {summary['abstain_rate']:.4f}")
    print(f"selective accuracy: {summary['selective_accuracy']:.6f}")
    print(f"avg cost/txn:       {summary['costs']['avg_cost_per_txn']:.6f}")
    print(f"false positives:    {fp}  false negatives: {fn}")
    print(f"wrote: {reports_dir / 'summary.json'}")


if __name__ == "__main__":
    main()
