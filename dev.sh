#!/bin/bash

# Drift Shield Development Server
# Runs backend + frontend concurrently using the training dataset path.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

echo "Starting Drift Shield..."

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

RAW_DATA_PATH="data/raw/creditcard.csv"
ACTIVE_MODEL_PTR="artifacts/models/ACTIVE_MODEL.json"

PYTHON_CMD="python3"
if ! command -v "${PYTHON_CMD}" >/dev/null 2>&1; then
  PYTHON_CMD="python"
fi

ensure_training_dataset() {
  if [[ ! -f "${RAW_DATA_PATH}" ]]; then
    echo -e "${YELLOW}[Data]${NC} Missing training dataset at ${RAW_DATA_PATH}"
    echo "Provide the dataset at data/raw/creditcard.csv and rerun ./dev.sh"
    exit 1
  fi
}

ensure_bootstrap_model() {
  if [[ ! -f "${ACTIVE_MODEL_PTR}" ]]; then
    echo -e "${BLUE}[Bootstrap]${NC} No active model found. Running scripts/setup.py"
    PYTHONPATH=src "${PYTHON_CMD}" scripts/setup.py
  fi
}

require_tool() {
  local tool_name="$1"
  local hint="$2"
  if ! command -v "${tool_name}" >/dev/null 2>&1; then
    echo "Missing required tool: ${tool_name}"
    echo "${hint}"
    exit 1
  fi
}

require_tool bun "Install Bun from https://bun.sh"
require_tool prometheus "Install Prometheus binary or use Docker compose"
require_tool "${PYTHON_CMD}" "Install Python 3.12+"

ensure_training_dataset
ensure_bootstrap_model

# Trap to kill all background processes on exit
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# Start backend
echo -e "${BLUE}[Backend]${NC} Starting API on http://localhost:8000"
PYTHONPATH=src uvicorn fraud_service.api.main:app --host 0.0.0.0 --port 8000 &

# Wait for backend to be ready
echo "Waiting for backend to start..."
sleep 3

# Start Prometheus
echo -e "${BLUE}[Prometheus]${NC} Starting on http://localhost:9090"
prometheus --config.file=monitoring/prometheus/prometheus.yml &

# Start retrain watcher
echo -e "${BLUE}[Watcher]${NC} Starting retrain watcher"
PYTHONPATH=src "${PYTHON_CMD}" scripts/watcher.py &

# Start frontend
echo -e "${GREEN}[Frontend]${NC} Starting UI on http://localhost:5173"
(
  cd frontend_new
  bun run dev
) &

IEEE_TX_PATH="ieee-fraud-detection/train_transaction.csv"
IEEE_ADAPTED_PATH="data/processed/ieee_adapted.csv"
IEEE_SAMPLE="${IEEE_SAMPLE:-20000}"
IEEE_TRAFFIC_SLEEP="${IEEE_TRAFFIC_SLEEP:-0.2}"
USE_IEEE_TRAFFIC="${USE_IEEE_TRAFFIC:-1}"

if [[ "${USE_IEEE_TRAFFIC}" == "1" && -f "${IEEE_TX_PATH}" ]]; then
  if [[ ! -f "${IEEE_ADAPTED_PATH}" ]]; then
    echo -e "${BLUE}[IEEE]${NC} Preparing adapted IEEE traffic dataset (sample=${IEEE_SAMPLE})"
    PYTHONPATH=src "${PYTHON_CMD}" scripts/ieee_adapter.py prepare --sample "${IEEE_SAMPLE}" >/dev/null 2>&1 || true
  else
    echo -e "${BLUE}[IEEE]${NC} Using cached ${IEEE_ADAPTED_PATH}"
  fi
  echo -e "${BLUE}[IEEE]${NC} Starting continuous IEEE traffic loop"
  PYTHONPATH=src "${PYTHON_CMD}" scripts/traffic_loop.py \
    --url http://127.0.0.1:8000 \
    --csv "${IEEE_ADAPTED_PATH}" \
    --sleep "${IEEE_TRAFFIC_SLEEP}" >/dev/null 2>&1 &
else
  echo -e "${YELLOW}[IEEE]${NC} IEEE traffic disabled or dataset missing (${IEEE_TX_PATH})"
fi

echo ""
echo "Drift Shield is running"
echo "  Backend:    http://localhost:8000"
echo "  Frontend:   http://localhost:5173"
echo "  Prometheus: http://localhost:9090"
echo "  Watcher:    enabled (scripts/watcher.py)"
echo "  Health:     http://localhost:8000/health"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for any process to exit
wait
