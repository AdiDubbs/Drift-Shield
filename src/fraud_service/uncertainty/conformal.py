import json
from dataclasses import dataclass
from pathlib import Path
from typing import List

import numpy as np


@dataclass
class ConformalCalib:
    alpha: float
    qhat: float
    labels: List[str]  # ["non_fraud", "fraud"]


def _conformal_quantile(scores: np.ndarray, alpha: float) -> float:
    """
    Split conformal quantile with the (n+1) correction.
    It's a small detail but it's the standard way to keep coverage honest.
    """
    n = int(scores.shape[0])
    q = np.ceil((n + 1) * (1 - alpha)) / n
    q = min(q, 1.0)
    return float(np.quantile(scores, q, method="higher"))


def fit_split_conformal(
    probas_calib: np.ndarray,
    y_calib: np.ndarray,
    alpha: float,
    labels: List[str],
) -> ConformalCalib:
    """
    probas_calib: [n, 2], columns aligned to labels.
    y_calib: 0/1 labels.
    score = 1 - P(true_label)
    """
    idx = np.arange(len(y_calib))
    true_probs = probas_calib[idx, y_calib]
    scores = 1.0 - true_probs

    qhat = _conformal_quantile(scores, alpha)
    return ConformalCalib(alpha=alpha, qhat=qhat, labels=labels)


def prediction_set(calib: ConformalCalib, probas_one: np.ndarray) -> List[str]:
    """
    Include label c if 1 - p(c) <= qhat  <=> p(c) >= 1 - qhat.
    """
    thresh = 1.0 - float(calib.qhat)
    keep: List[str] = []
    for i, name in enumerate(calib.labels):
        if float(probas_one[i]) >= thresh:
            keep.append(name)
    return keep


def save_calib(calib: ConformalCalib, qhat_path: str, meta_path: str) -> None:
    Path(qhat_path).parent.mkdir(parents=True, exist_ok=True)
    Path(meta_path).parent.mkdir(parents=True, exist_ok=True)

    np.save(qhat_path, np.array([calib.qhat], dtype=np.float32))
    meta = {"alpha": calib.alpha, "labels": calib.labels}
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)


def load_calib(qhat_path: str, meta_path: str) -> ConformalCalib:
    qhat = float(np.load(qhat_path)[0])
    with open(meta_path, "r") as f:
        meta = json.load(f)
    return ConformalCalib(alpha=float(meta["alpha"]), qhat=qhat, labels=list(meta["labels"]))