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

## Stack

| Layer | Tech |
|---|---|
| API | FastAPI + Uvicorn |
| Model | XGBoost + scikit-learn |
| Drift | PSI + KS test |
| Uncertainty | Conformal prediction |
| Frontend | React + Vite + Tailwind (`frontend_new/`) |
| Metrics | Prometheus (+ optional Grafana) |

## Requirements

- Python 3.12+
- Bun 1.3+ (for `frontend_new`)
- Prometheus binary on PATH (for `./dev.sh`) or Docker

## Quickstart (Local)

1. Place base training dataset

Put the credit card fraud training CSV at:

`data/raw/creditcard.csv`

Dataset: https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud

2. Add IEEE dataset for live visualization traffic (recommended)

Put IEEE-CIS files in:

`ieee-fraud-detection/`

Required at minimum:

- `ieee-fraud-detection/train_transaction.csv`

3. Install dependencies

```bash
pip install -r requirements.txt
cd frontend_new && bun install
cd ..
```

4. Start the stack

```bash
./dev.sh
```

`dev.sh` will:

- Use `data/raw/creditcard.csv` as the training dataset
- Bootstrap an initial model if missing (`scripts/setup.py`)
- Start API, Prometheus, and frontend
- If IEEE data exists, prepare `data/processed/ieee_adapted.csv` and start continuous traffic to `/predict`

5. (Optional) Run watcher for retrain processing

```bash
PYTHONPATH=src python scripts/watcher.py
```

## Service URLs

| Service | URL |
|---|---|
| API | http://localhost:8000 |
| OpenAPI Docs | http://localhost:8000/docs |
| Frontend | http://localhost:5173 |
| Prometheus | http://localhost:9090 |
| Metrics endpoint | http://localhost:8000/metrics |

## Core API Endpoints

- `GET /health`
- `POST /predict`
- `GET /dashboard/stats`
- `POST /retrain`
- `GET /models/info`
- `GET /prometheus/{path}`

## Docker

Start API + watcher + frontend + Prometheus + IEEE traffic:

```bash
docker compose up --build
```

The API container runs `scripts/bootstrap_demo.py` on startup and trains an initial model if needed, using:
- `data/raw/creditcard.csv`

The `ieee_traffic` service:

- prepares `data/processed/ieee_adapted.csv` from `ieee-fraud-detection/train_transaction.csv` (if not already cached)
- continuously sends traffic to `POST /predict` so charts stay populated

Start with full monitoring stack (adds Grafana):

```bash
docker compose --profile monitoring up --build
```

Grafana (when monitoring profile is enabled):
- URL: `http://localhost:3000/d/afe3285cd4xkwc/drift-shield?orgId=1&from=now-15m&to=now&timezone=browser&refresh=5s`
- Default user/password: `admin` / `admin`

## Dashboard Data Notes

- If values are empty, it usually means request traffic is not flowing.
- In Docker, check `driftshield_ieee_traffic` is running.
- Local `dev.sh` only streams IEEE traffic when `ieee-fraud-detection/train_transaction.csv` exists.

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
