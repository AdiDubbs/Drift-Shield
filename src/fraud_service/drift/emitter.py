from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class RetrainEmitter:
    request_dir: str
    cooldown_seconds: float = 600.0
    max_pending: int = 1
    marker_filename: str = ".last_emit"

    def __post_init__(self) -> None:
        self._dir = Path(self.request_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._marker = self._dir / self.marker_filename

    def emit(
        self,
        *,
        reason: str,
        drift_score: float,
        model_version: str,
        action_code: str,
        drift: Dict[str, Any],
        p_fraud: Optional[float] = None,
        request_id: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
        **_ignored: Any,
    ) -> bool:
        now = time.time()

        last = self._last_emit_time()
        if last is not None and (now - last) < float(self.cooldown_seconds):
            return False

        if len(self._pending_requests()) >= int(self.max_pending):
            return False

        ts = time.strftime("%Y%m%d_%H%M%S", time.localtime(now))
        path = self._dir / f"retrain_request_{ts}.json"

        payload: Dict[str, Any] = dict(
            created_at_unix=now,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now)),
            reason=str(reason),
            drift_score=float(drift_score),
            model_version=str(model_version),
            action_code=str(action_code),
            drift=drift,
        )
        if p_fraud is not None:
            payload["p_fraud"] = float(p_fraud)
        if request_id is not None:
            payload["request_id"] = str(request_id)
        if extra:
            payload["extra"] = extra

        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(path)

        self._touch_marker(now)
        return True

    def _pending_requests(self) -> list[Path]:
        return sorted(self._dir.glob("retrain_request_*.json"))

    def _last_emit_time(self) -> Optional[float]:
        try:
            if self._marker.exists():
                return float(self._marker.stat().st_mtime)
        except OSError:
            return None
        return None

    def _touch_marker(self, now: float) -> None:
        try:
            if not self._marker.exists():
                self._marker.write_text("last_emit\n", encoding="utf-8")
            Path(self._marker).touch()
            os.utime(self._marker, (now, now))
        except (OSError, IOError, PermissionError) as e:
            logger.warning(
                f"Failed to update marker file {self._marker}: {e}. "
                "Cooldown enforcement may be affected."
            )
