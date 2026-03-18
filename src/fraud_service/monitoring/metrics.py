from prometheus_client import Counter, Gauge, Histogram

SCHEMA_LABEL = ["schema_version"]
SCHEMA_ACTION_LABELS = ["schema_version", "code"]

REQS = Counter("requests_total", "Total inference requests", SCHEMA_LABEL)
ACTIONS = Counter("action_code_total", "Action code counts", SCHEMA_ACTION_LABELS)
DRIFT_SCORE = Gauge("drift_score", "Current drift score (latest window)", SCHEMA_LABEL)
DRIFT_READY = Gauge(
    "drift_ready",
    "Whether drift detector has produced at least one scored window (1/0)",
    SCHEMA_LABEL,
)
SHADOW_DRIFT_SCORE = Gauge("shadow_drift_score", "Current shadow drift score (latest window)", SCHEMA_LABEL)
SHADOW_DRIFT_READY = Gauge(
    "shadow_drift_ready",
    "Whether shadow drift detector has produced at least one scored window (1/0)",
    SCHEMA_LABEL,
)

P_FRAUD = Histogram(
    "p_fraud",
    "Model fraud probability",
    SCHEMA_LABEL,
    buckets=(1e-5, 5e-5, 1e-4, 5e-4, 1e-3, 5e-3, 1e-2, 5e-2, 0.2, 0.5, 0.9, 0.99, 0.999),
)
SHADOW_P_FRAUD = Histogram(
    "shadow_p_fraud",
    "Shadow model fraud probability",
    SCHEMA_LABEL,
    buckets=(1e-5, 5e-5, 1e-4, 5e-4, 1e-3, 5e-3, 1e-2, 5e-2, 0.2, 0.5, 0.9, 0.99, 0.999),
)

FEATURE_SOFT_COUNT = Gauge(
    "feature_soft_count",
    "How many features are soft-drifted (latest window)",
    SCHEMA_LABEL,
)
FEATURE_HARD_COUNT = Gauge(
    "feature_hard_count",
    "How many features are hard-drifted (latest window)",
    SCHEMA_LABEL,
)

RETRAIN_TRIGGERS = Counter("retrain_triggers_total", "Total retrain triggers emitted", SCHEMA_LABEL)

SHADOW_RUNS = Counter("shadow_predictions_total", "Total shadow predictions computed", SCHEMA_LABEL)
SHADOW_DISAGREE = Counter(
    "shadow_disagree_total",
    "Shadow disagreed with primary (prediction_set or action)",
    SCHEMA_LABEL,
)
ACTIVE_EVAL_LABELED_TOTAL = Counter(
    "active_eval_labeled_total",
    "Total labeled requests evaluated for active model online accuracy",
    SCHEMA_LABEL,
)
ACTIVE_EVAL_LABELED_CORRECT = Counter(
    "active_eval_labeled_correct_total",
    "Total labeled requests correctly predicted by active model",
    SCHEMA_LABEL,
)
SHADOW_EVAL_LABELED_TOTAL = Counter(
    "shadow_eval_labeled_total",
    "Total labeled requests evaluated for shadow model online accuracy",
    SCHEMA_LABEL,
)
SHADOW_EVAL_LABELED_CORRECT = Counter(
    "shadow_eval_labeled_correct_total",
    "Total labeled requests correctly predicted by shadow model",
    SCHEMA_LABEL,
)

REQUEST_LATENCY = Histogram(
    "request_latency_seconds",
    "Latency of /predict handler in seconds",
    SCHEMA_LABEL,
    buckets=(0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0),
)
