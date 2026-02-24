from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from scipy.stats import ks_2samp

from fraud_service.utils.io import load_json
from fraud_service.drift.constants import PSI_WEIGHT, KS_WEIGHT, PSI_NORMALIZATION_FACTOR


def _psi(expected: np.ndarray, actual: np.ndarray) -> float:
    e = np.clip(expected, 1e-6, 1.0)
    a = np.clip(actual, 1e-6, 1.0)
    return np.sum((a - e) * np.log(a / e))


@dataclass
class DriftDetector:
    feature_names: List[str]
    psi_bins: int
    psi_edges: List[np.ndarray]          # per feature
    psi_expected: List[np.ndarray]       # per feature
    ks_ref: np.ndarray                   # [n_ref, d]
    window_size: int
    stride: int
    p_value_threshold: float

    # thresholds for "how many features are drifting"
    psi_soft_thr: float = 0.10
    psi_hard_thr: float = 0.25

    _buf: List[np.ndarray] = None
    _since_last: int = 0
    _last_score: float = 0.0
    _last_top: List[str] = None
    _last_soft_count: int = 0
    _last_hard_count: int = 0

    @classmethod
    def from_reference(cls, ref_json_path: str, cfg: dict) -> "DriftDetector":
        ref_path = Path(ref_json_path).resolve()
        ref = load_json(ref_json_path)

        feature_names = list(ref["feature_names"])
        psi_bins = int(ref["psi_bins"])
        ref_sample_path = Path(ref["ref_sample_path"])
        if not ref_sample_path.is_absolute():
            candidate = (ref_path.parent / ref_sample_path).resolve()
            if candidate.exists():
                ref_sample_path = candidate
            else:
                repo_root = Path(cfg.get("paths", {}).get("repo_root", "."))
                ref_sample_path = (repo_root / ref_sample_path).resolve()

        ks_ref = np.load(str(ref_sample_path)).astype(np.float32)

        psi_edges = []
        psi_expected = []
        psi_block = ref["psi"]

        for name in feature_names:
            edges = np.array(psi_block[name]["edges"], dtype=np.float32)
            exp = np.array(psi_block[name]["expected"], dtype=np.float32)
            psi_edges.append(edges)
            psi_expected.append(exp)

        drift_cfg = cfg.get("drift", {})
        return cls(
            feature_names=feature_names,
            psi_bins=psi_bins,
            psi_edges=psi_edges,
            psi_expected=psi_expected,
            ks_ref=ks_ref,
            window_size=int(drift_cfg.get("window_size", 1000)),
            stride=int(drift_cfg.get("stride", 200)),
            p_value_threshold=float(drift_cfg.get("p_value_threshold", 0.01)),
            psi_soft_thr=float(drift_cfg.get("psi_soft_threshold", 0.10)),
            psi_hard_thr=float(drift_cfg.get("psi_hard_threshold", 0.25)),
            _buf=[],
            _since_last=0,
            _last_top=[],
            _last_score=0.0,
            _last_soft_count=0,
            _last_hard_count=0,
        )

    def update_and_score(self, x_row: np.ndarray) -> Dict[str, Any]:
        if self._buf is None:
            self._buf = []
        if self._last_top is None:
            self._last_top = []

        self._buf.append(x_row.reshape(-1).astype(np.float32))
        self._since_last += 1

        if len(self._buf) > self.window_size:
            self._buf = self._buf[-self.window_size:]

        if len(self._buf) < max(100, self.stride):
            return {
                "drift_score": 0.0,
                "top_drifted_features": [],
                "psi_mean": 0.0,
                "ks_flag_frac": 0.0,
                "feature_soft_count": 0,
                "feature_hard_count": 0,
                "updated": False,
            }

        if self._since_last < self.stride:
            return {
                "drift_score": self._last_score,
                "top_drifted_features": self._last_top,
                "psi_mean": None,
                "ks_flag_frac": None,
                "feature_soft_count": self._last_soft_count,
                "feature_hard_count": self._last_hard_count,
                "updated": False,
            }

        self._since_last = 0
        X_live = np.vstack(self._buf)
        num_features = X_live.shape[1]

        psi_vals = np.zeros(num_features, dtype=np.float32)
        ks_pvals = np.ones(num_features, dtype=np.float32)

        for i, feature_name in enumerate(self.feature_names):
            live_col = X_live[:, i]
            edges = self.psi_edges[i]
            expected = self.psi_expected[i]

            actual_counts, _ = np.histogram(live_col, bins=edges)
            actual = (actual_counts / max(1, actual_counts.sum())).astype(np.float32)

            psi_vals[i] = _psi(expected, actual)

            ref_col = self.ks_ref[:, i]
            try:
                ks_pvals[i] = ks_2samp(ref_col, live_col, alternative="two-sided", mode="auto").pvalue
            except Exception:
                ks_pvals[i] = 1.0

        psi_score = np.clip(np.mean(np.minimum(psi_vals / PSI_NORMALIZATION_FACTOR, 1.0)), 0.0, 1.0)
        ks_flag_frac = np.clip(np.mean((ks_pvals < self.p_value_threshold).astype(np.float32)), 0.0, 1.0)
        drift_score = np.clip(PSI_WEIGHT * psi_score + KS_WEIGHT * ks_flag_frac, 0.0, 1.0)

        top_idx = np.argsort(psi_vals)[::-1][:5]
        top_feats = [self.feature_names[i] for i in top_idx]

        soft_count = (psi_vals > self.psi_soft_thr).sum()
        hard_count = (psi_vals > self.psi_hard_thr).sum()

        self._last_score = drift_score
        self._last_top = top_feats
        self._last_soft_count = soft_count
        self._last_hard_count = hard_count

        return {
            "drift_score": float(drift_score),
            "top_drifted_features": top_feats,
            "psi_mean": float(psi_vals.mean()),
            "ks_flag_frac": float(ks_flag_frac),
            "feature_soft_count": int(soft_count),
            "feature_hard_count": int(hard_count),
            "updated": True,
        }
