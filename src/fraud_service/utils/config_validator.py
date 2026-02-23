from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class ConfigValidationError(Exception):
    pass


def validate_config(cfg: Dict[str, Any], config_path: str = "config.yaml") -> None:
    errors: List[str] = []

    for section in ("drift", "paths", "conformal"):
        if section not in cfg:
            errors.append(f"Missing required section: '{section}'")

    if "drift" in cfg:
        drift = cfg["drift"]
        for key in ("window_size", "stride", "soft_threshold", "hard_threshold", "required_hard_windows"):
            if key not in drift:
                errors.append(f"Missing drift config: '{key}'")

    if "conformal" in cfg and "alpha" in cfg["conformal"]:
        try:
            alpha = float(cfg["conformal"]["alpha"])
            if not (0.0 < alpha < 1.0):
                errors.append(f"conformal.alpha out of range: {alpha}")
        except (ValueError, TypeError):
            errors.append(f"conformal.alpha must be numeric")

    if errors:
        raise ConfigValidationError(
            f"Config validation failed ({config_path}):\n" +
            "\n".join(f"  - {e}" for e in errors)
        )


def validate_cors_origins(origins: List[str], environment: str = "production") -> None:
    if environment == "production" and "*" in origins:
        raise ConfigValidationError(
            "CORS wildcard '*' is not allowed in production environment. "
            "Please specify explicit origins or use CORS_ORIGINS environment variable."
        )
