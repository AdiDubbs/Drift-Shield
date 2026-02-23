from prometheus_client import Counter, Gauge, Histogram

REQS = Counter("requests_total", "Total inference requests")
ACTIONS = Counter("action_code_total", "Action code counts", ["code"])
DRIFT_SCORE = Gauge("drift_score", "Current drift score (latest window)")

P_FRAUD = Histogram(
    "p_fraud",
    "Model fraud probability",
    buckets=(1e-5, 5e-5, 1e-4, 5e-4, 1e-3, 5e-3, 1e-2, 5e-2, 0.2, 0.5, 0.9, 0.99, 0.999),
)

FEATURE_SOFT_COUNT = Gauge("feature_soft_count", "How many features are soft-drifted (latest window)")
FEATURE_HARD_COUNT = Gauge("feature_hard_count", "How many features are hard-drifted (latest window)")

RETRAIN_TRIGGERS = Counter("retrain_triggers_total", "Total retrain triggers emitted")

SHADOW_RUNS = Counter("shadow_predictions_total", "Total shadow predictions computed")
SHADOW_DISAGREE = Counter("shadow_disagree_total", "Shadow disagreed with primary (prediction_set or action)")

REQUEST_LATENCY = Histogram(
    "request_latency_seconds",
    "Latency of /predict handler in seconds",
    buckets=(0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0),
)
