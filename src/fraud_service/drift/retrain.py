from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from fraud_service.utils.io import save_json


@dataclass
class RetrainTrigger:
    """
    Simple gating:
    - if drift_score >= hard_thr for N consecutive updated windows -> trigger once
    - triggers retrain via RetrainEmitter (cooldown/max_pending enforced)
    """
    soft_thr: float
    hard_thr: float
    required_hard_windows: int = 3

    _hard_hits: int = 0

    def on_drift_update(self, drift_score: float, extra: Dict[str, Any]) -> Dict[str, Any]:
        triggered = False
        reason = None

        if drift_score >= self.hard_thr:
            self._hard_hits += 1
        else:
            self._hard_hits = 0

        if self._hard_hits >= self.required_hard_windows:
            triggered = True
            reason = f"HARD_DRIFT_{self._hard_hits}_WINDOWS"


            # reset so we don't spam
            self._hard_hits = 0

        return {"triggered": triggered, "reason": reason}