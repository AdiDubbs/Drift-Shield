from pathlib import Path
from typing import Any, Dict

import numpy as np
import pandas as pd

from fraud_service.utils.io import save_json


def build_reference_from_train_csv(
    train_csv_path: str,
    target_col: str,
    out_json_path: str,
    out_ref_sample_path: str,
    n_ref_sample: int = 5000,
    psi_bins: int = 10,
    seed: int = 1337,
) -> None:
    df = pd.read_csv(train_csv_path)
    X_df = df.drop(columns=[target_col])

    feature_names = list(X_df.columns)
    X = X_df.values.astype(np.float32)

    rng = np.random.default_rng(seed)

    n = X.shape[0]
    take = min(n_ref_sample, n)
    idx = rng.choice(n, size=take, replace=False)
    X_ref = X[idx]

    Path(out_ref_sample_path).parent.mkdir(parents=True, exist_ok=True)
    np.save(out_ref_sample_path, X_ref.astype(np.float32))

    psi_info: Dict[str, Any] = {}
    for j, name in enumerate(feature_names):
        col = X[:, j]
        qs = np.linspace(0, 1, psi_bins + 1)
        edges = np.quantile(col, qs).astype(np.float32)

        # ensure strictly increasing
        for k in range(1, len(edges)):
            if edges[k] <= edges[k - 1]:
                edges[k] = edges[k - 1] + 1e-6

        expected_counts, _ = np.histogram(col, bins=edges)
        expected = (expected_counts / max(1, expected_counts.sum())).astype(np.float32)

        psi_info[name] = {"edges": edges.tolist(), "expected": expected.tolist()}

    ref = {
        "feature_names": feature_names,
        "psi_bins": psi_bins,
        "n_ref_sample": int(take),
        "ref_sample_path": out_ref_sample_path,
        "psi": psi_info,
    }

    Path(out_json_path).parent.mkdir(parents=True, exist_ok=True)
    save_json(ref, out_json_path)
    print("Saved drift reference JSON:", out_json_path)
    print("Saved KS ref sample:", out_ref_sample_path)