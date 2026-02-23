from typing import List, Tuple

from fraud_service.api.constants import (
    ACTION_PREDICT,
    ACTION_MONITOR,
    ACTION_FALLBACK,
    ACTION_ABSTAIN,
    REASON_CONFORMAL_UNCERTAIN,
    REASON_HARD_DRIFT,
    REASON_SOFT_DRIFT,
)


def decide_action(pred_set: List[str], drift_score: float, soft_thr: float, hard_thr: float) -> Tuple[str, List[str]]:
    reasons: List[str] = []

    # Conformal uncertainty
    if len(pred_set) != 1:
        reasons.append(REASON_CONFORMAL_UNCERTAIN)
        return ACTION_ABSTAIN, reasons

    # Drift-based policy
    if drift_score >= hard_thr:
        reasons.append(REASON_HARD_DRIFT)
        return ACTION_FALLBACK, reasons

    if drift_score >= soft_thr:
        reasons.append(REASON_SOFT_DRIFT)
        return ACTION_MONITOR, reasons

    return ACTION_PREDICT, reasons