FROM python:3.12-slim AS python-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY src /app/src
COPY scripts /app/scripts
COPY config.yaml /app/config.yaml

RUN mkdir -p /app/artifacts /app/data /app/ieee-fraud-detection

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src

FROM oven/bun:1.3.9 AS frontend-builder
WORKDIR /app/frontend_new

COPY frontend_new/package.json frontend_new/bun.lock ./
RUN bun install --frozen-lockfile

COPY frontend_new ./
RUN bun run build

FROM nginx:1.27-alpine AS frontend
COPY --from=frontend-builder /app/frontend_new/dist /usr/share/nginx/html
EXPOSE 80

FROM python-base AS api
EXPOSE 8000
CMD ["uvicorn", "fraud_service.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
