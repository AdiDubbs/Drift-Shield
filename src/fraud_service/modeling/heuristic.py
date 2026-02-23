from typing import Any, Dict, Tuple


def fallback_risk_score(features: Dict[str, Any]) -> Tuple[float, str]:
    """Simple, explainable fallback when hard drift happens."""
    amt = float(features.get("Amount", 0.0))

    if amt >= 2000:
        return 0.90, "HIGH_AMOUNT"
    if amt >= 1000:
        return 0.70, "MED_AMOUNT"
    if amt >= 500:
        return 0.45, "LOW_MED_AMOUNT"

    return 0.10, "LOW_AMOUNT"
