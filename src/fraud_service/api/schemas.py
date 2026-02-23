from __future__ import annotations

from typing import Dict, List, Optional, Any

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    # Minimal data contract version
    schema_version: int = Field(default=1, ge=1)
    # Feature payload
    transaction_features: Dict[str, Any]


class DriftInfo(BaseModel):
    drift_score: float
    soft_drift: bool
    hard_drift: bool
    top_drifted_features: List[str]
    psi_mean: Optional[float] = None
    ks_flag_frac: Optional[float] = None


class PredictResponse(BaseModel):
    prediction: Optional[str]
    prediction_set: List[str]
    p_fraud: Optional[float]
    coverage: float
    action_code: str
    reasons: List[str]

    fallback_risk: Optional[float] = None
    fallback_reason: Optional[str] = None

    retrain_triggered: bool = False
    retrain_reason: Optional[str] = None

    model_version: str
    drift: DriftInfo