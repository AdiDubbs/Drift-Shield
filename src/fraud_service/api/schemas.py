from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field

from fraud_service.api.constants import (
    ACTION_ABSTAIN,
    ACTION_FALLBACK,
    ACTION_MANUAL,
    ACTION_MONITOR,
    ACTION_PREDICT,
    REASON_CONFORMAL_UNCERTAIN,
    REASON_DATA_CONTRACT,
    REASON_HARD_DRIFT,
    REASON_PREDICTION_ERROR,
    REASON_SOFT_DRIFT,
)


class ActionCode(str, Enum):
    ACTION_PREDICT = ACTION_PREDICT
    ACTION_MONITOR = ACTION_MONITOR
    ACTION_FALLBACK = ACTION_FALLBACK
    ACTION_ABSTAIN = ACTION_ABSTAIN
    ACTION_MANUAL = ACTION_MANUAL


class ReasonCode(str, Enum):
    DATA_CONTRACT = REASON_DATA_CONTRACT
    CONFORMAL_UNCERTAIN = REASON_CONFORMAL_UNCERTAIN
    HARD_DRIFT = REASON_HARD_DRIFT
    SOFT_DRIFT = REASON_SOFT_DRIFT
    PREDICTION_ERROR = REASON_PREDICTION_ERROR


class PredictRequest(BaseModel):
    # Minimal data contract version
    schema_version: int = Field(default=1, ge=1)
    # Feature payload
    transaction_features: Dict[str, Any]

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "schema_version": 1,
                    "transaction_features": {"V1": 0.03, "V2": -0.11, "Amount": 120.5},
                }
            ]
        }
    }


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
    action_code: ActionCode
    reasons: List[Union[ReasonCode, str]]

    fallback_risk: Optional[float] = None
    fallback_reason: Optional[str] = None

    retrain_triggered: bool = False
    retrain_reason: Optional[str] = None

    model_version: str
    drift: DriftInfo

    model_config = {
        "protected_namespaces": (),
        "json_schema_extra": {
            "examples": [
                {
                    "prediction": "fraud",
                    "prediction_set": ["fraud"],
                    "p_fraud": 0.91,
                    "coverage": 0.95,
                    "action_code": ACTION_PREDICT,
                    "reasons": [REASON_SOFT_DRIFT],
                    "fallback_risk": None,
                    "fallback_reason": None,
                    "retrain_triggered": False,
                    "retrain_reason": None,
                    "model_version": "v_20260117_160420",
                    "drift": {
                        "drift_score": 0.24,
                        "soft_drift": True,
                        "hard_drift": False,
                        "top_drifted_features": ["V4", "V10", "Amount"],
                        "psi_mean": 0.11,
                        "ks_flag_frac": 0.27,
                    },
                }
            ]
        },
    }


class ApiReadiness(BaseModel):
    ready: bool
    detail: str
    active_model_version: Optional[str] = None
    shadow_model_version: Optional[str] = None


class PredictContract(BaseModel):
    contract_version: str
    schema_version: int
    action_codes: List[ActionCode]
    reason_codes: List[ReasonCode]
    notes: List[str]
