# Drift Shield

Fraud detection API with real-time drift monitoring, uncertainty-aware predictions, and retrain orchestration.

## Features

- Scores transactions with an XGBoost model
- Detects drift using PSI + KS signals
- Uses conformal prediction sets for uncertainty-aware decisions
- Emits retrain requests when drift thresholds are breached
- Serves a React dashboard and Prometheus metrics

## Screenshots

<div align="center">
  <img src="frontend_new/src/assets/1_drift.jpeg" width="800" alt="Dashboard Overview" />
  <img src="frontend_new/src/assets/2_drift.jpeg" width="800" alt="Monitoring Charts" />
  <img src="frontend_new/src/assets/3_drift.jpeg" width="800" alt="Activity Log" />
</div>

## Quickstart (Docker)

The fastest way to run the full stack (API + Dashboard + Monitoring):

```bash
docker compose up --build
```

**Services:**
- **Frontend:** http://localhost:5173
- **API Docs:** http://localhost:8000/docs
- **Grafana:** http://localhost:3000/d/afe3285cd4xkwc/drift-shield (user/pass: `admin`/`admin`)
- **Prometheus:** http://localhost:9090

> **Note:** The API container will bootstrap an initial model on startup. If you want to use your own data, place `creditcard.csv` in `data/raw/` before starting.

## Local Development

If you prefer to run services manually:

1. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   cd frontend_new && bun install
   ```

2. **Start the Stack**
   ```bash
   ./dev.sh
   ```

## Stack

| Layer | Tech |
|---|---|
| API | FastAPI + Uvicorn |
| Model | XGBoost + scikit-learn |
| Drift | PSI + KS test |
| Uncertainty | Conformal prediction |
| Frontend | React + Vite + Tailwind (`frontend_new/`) |
| Metrics | Prometheus (+ optional Grafana) |

## Core API Endpoints

- `GET /health` — liveness check
- `GET /ready` — readiness check (confirms model is loaded)
- `POST /predict` — score a transaction
- `GET /dashboard/stats` — summary stats for the frontend
- `GET /models/info` — active/shadow model metadata
- `GET /system/status` — full system state (drift, retraining, promotion policy)
- `POST /retrain` — manually trigger a retrain request
- `GET /prometheus/{path}` — proxied Prometheus metrics endpoint

## Docker Details

The compose stack includes: API, watcher (Credit Card domain), watcher_ieee (IEEE domain), Credit Card + IEEE traffic loops, frontend, Prometheus, and Grafana.

```bash
docker compose up --build
```

The traffic services:
- `ieee_traffic` / `ieee_native_traffic`: continuously send transactions to `POST /predict` so charts stay populated
- `ieee_traffic` uses the adapted CSV format; `ieee_native_traffic` uses the raw IEEE feature set
- Both require `ieee-fraud-detection/train_transaction.csv` to be present for the full demo

## Dashboard Data Notes

- If values are empty, ensure request traffic is flowing.
- In Docker, check `driftshield_ieee_traffic` container status.

## Project Structure

```text
src/fraud_service/     Backend package
scripts/               Training, retrain, and utility scripts
frontend_new/          Active React dashboard
ieee-fraud-detection/  IEEE-CIS source files for demo traffic
monitoring/            Prometheus and Grafana configs
config.yaml            Runtime settings
compose.yml            Docker Compose stack
```
