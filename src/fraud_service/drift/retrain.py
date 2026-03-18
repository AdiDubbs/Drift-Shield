import threading
from dataclasses import dataclass, field
from typing import Any, Dict


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
    _lock: threading.Lock = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def on_drift_update(self, drift_score: float, extra: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            # Only count windows when the detector has produced a fresh stride update.
            if not bool(extra.get("updated", False)):
                return {"triggered": False, "reason": None}

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
