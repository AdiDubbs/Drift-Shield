from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)


class RecentPredictFeatureStore:
    def __init__(
        self,
        path: str,
        max_entries: int = 5000,
        compact_every: int = 100,
    ) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._max_entries = max(1, int(max_entries))
        self._compact_every = max(1, int(compact_every))
        self._lock = threading.Lock()
        self._writes_since_compact = 0

    @property
    def path(self) -> Path:
        return self._path

    @property
    def max_entries(self) -> int:
        return self._max_entries

    def append(
        self,
        *,
        features: Dict[str, Any],
        feature_names: Iterable[str],
        model_version: str,
        p_fraud: Optional[float] = None,
        actual_label: Optional[int] = None,
        action_code: Optional[str] = None,
        drift_score: Optional[float] = None,
        drift_ready: Optional[bool] = None,
    ) -> None:
        record_features: Dict[str, float] = {}
        for name in feature_names:
            try:
                record_features[str(name)] = float(features.get(name, 0.0))
            except (TypeError, ValueError):
                record_features[str(name)] = 0.0

        payload: Dict[str, Any] = {
            "ts": float(time.time()),
            "model_version": str(model_version),
            "features": record_features,
        }
        if p_fraud is not None:
            payload["p_fraud"] = float(p_fraud)
        if actual_label is not None:
            payload["actual_label"] = int(actual_label)
        if action_code is not None:
            payload["action_code"] = str(action_code)
        if drift_score is not None:
            payload["drift_score"] = float(drift_score)
        if drift_ready is not None:
            payload["drift_ready"] = bool(drift_ready)

        line = json.dumps(payload, separators=(",", ":"))

        with self._lock:
            with self._path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
            self._writes_since_compact += 1
            if self._writes_since_compact >= self._compact_every:
                self._compact_locked()
                self._writes_since_compact = 0

    def read_recent(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._read_all_locked()
        if limit is None or limit <= 0:
            return rows
        return rows[-int(limit):]

    def stats(self) -> Dict[str, Any]:
        rows = self.read_recent()
        if not rows:
            return {
                "path": str(self._path),
                "entries": 0,
                "max_entries": int(self._max_entries),
                "oldest_ts": None,
                "newest_ts": None,
                "oldest_age_seconds": None,
                "newest_age_seconds": None,
            }

        now = float(time.time())
        oldest_ts = float(rows[0].get("ts", 0.0) or 0.0) or None
        newest_ts = float(rows[-1].get("ts", 0.0) or 0.0) or None

        return {
            "path": str(self._path),
            "entries": len(rows),
            "max_entries": int(self._max_entries),
            "oldest_ts": oldest_ts,
            "newest_ts": newest_ts,
            "oldest_age_seconds": (now - oldest_ts) if oldest_ts else None,
            "newest_age_seconds": (now - newest_ts) if newest_ts else None,
        }

    def _compact_locked(self) -> None:
        rows = self._read_all_locked()
        if len(rows) <= self._max_entries:
            return
        keep = rows[-self._max_entries :]
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for row in keep:
                f.write(json.dumps(row, separators=(",", ":")) + "\n")
        tmp.replace(self._path)

    def _read_all_locked(self) -> List[Dict[str, Any]]:
        if not self._path.exists():
            return []
        rows: List[Dict[str, Any]] = []
        with self._path.open("r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Skipping malformed JSONL entry in %s", self._path)
                    continue
                if isinstance(parsed, dict):
                    rows.append(parsed)
        return rows
