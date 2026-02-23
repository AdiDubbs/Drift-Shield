import { useState, useEffect, useRef } from 'react';
import { prometheusClient } from '../api/prometheusClient';

export const usePrometheusMetrics = (options = {}) => {
  const {
    timeRange = '15m',
    maxDataPoints = 100,
    enabled = true,
  } = options;

  const [prometheusConnected, setPrometheusConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Time-series data
  const [requestRateData, setRequestRateData] = useState([]);
  const [driftScoreData, setDriftScoreData] = useState([]);
  const [latencyData, setLatencyData] = useState({ p50: [], p90: [], p99: [] });
  const [fraudProbData, setFraudProbData] = useState({ p50: [], p90: [], p99: [] });

  // Current/instant metrics
  const [currentMetrics, setCurrentMetrics] = useState({
    driftScore: 0,
    featureDriftSoft: 0,
    featureDriftHard: 0,
    retrainTriggers: 0,
    shadowDisagreementRate: 0,
  });

  const intervalRef = useRef(null);
  const clip = (data) => (data.length > maxDataPoints ? data.slice(-maxDataPoints) : data);
  const emptyResult = () => ({ result: [] });

  const querySafe = async (query) => {
    try {
      return await prometheusClient.query(query);
    } catch {
      return emptyResult();
    }
  };

  const queryRangeSafe = async (query, start, end, step = '5s') => {
    try {
      return await prometheusClient.queryRange(query, start, end, step);
    } catch {
      return emptyResult();
    }
  };

  const mergeTimeSeries = (seriesDefs) => {
    const dataMap = new Map();

    seriesDefs.forEach(({ key, data, transform = (v) => v }) => {
      data.forEach((point) => {
        const existing = dataMap.get(point.timestamp) || {
          time: point.time,
          timestamp: point.timestamp,
        };
        existing[key] = transform(point.value);
        dataMap.set(point.timestamp, existing);
      });
    });

    return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  const fetchMetrics = async () => {
    try {
      const healthy = await prometheusClient.health();
      if (!healthy) {
        throw new Error('Prometheus is not reachable');
      }

      const end = Math.floor(Date.now() / 1000);
      const start = end - prometheusClient.parseTimeRange(timeRange);

      const [
        requestRateRaw,
        driftScoreRaw,
        driftScoreTSRaw,
        latencyP50Raw,
        latencyP90Raw,
        latencyP99Raw,
        fraudP50Raw,
        fraudP90Raw,
        fraudP99Raw,
        softDriftRaw,
        hardDriftRaw,
        retrainTriggersRaw,
        shadowDisRateRaw,
      ] = await Promise.all([
        queryRangeSafe('sum(rate(requests_total[1m]))', start, end),
        querySafe('avg(drift_score)'),
        queryRangeSafe('avg(drift_score)', start, end),
        queryRangeSafe('histogram_quantile(0.50, sum by (le) (rate(request_latency_seconds_bucket[5m])))', start, end),
        queryRangeSafe('histogram_quantile(0.90, sum by (le) (rate(request_latency_seconds_bucket[5m])))', start, end),
        queryRangeSafe('histogram_quantile(0.99, sum by (le) (rate(request_latency_seconds_bucket[5m])))', start, end),
        queryRangeSafe('histogram_quantile(0.50, sum by (le) (rate(p_fraud_bucket[5m])))', start, end),
        queryRangeSafe('histogram_quantile(0.90, sum by (le) (rate(p_fraud_bucket[5m])))', start, end),
        queryRangeSafe('histogram_quantile(0.99, sum by (le) (rate(p_fraud_bucket[5m])))', start, end),
        querySafe('max(feature_soft_count)'),
        querySafe('max(feature_hard_count)'),
        querySafe('sum(retrain_triggers_total)'),
        querySafe('sum(rate(shadow_disagree_total[5m]))'),
      ]);

      const requestRate = prometheusClient.formatTimeSeries(requestRateRaw);
      const driftScore = prometheusClient.extractScalarValue(driftScoreRaw);
      const driftScoreTS = prometheusClient.formatTimeSeries(driftScoreTSRaw);
      const latencyP50 = prometheusClient.formatTimeSeries(latencyP50Raw);
      const latencyP90 = prometheusClient.formatTimeSeries(latencyP90Raw);
      const latencyP99 = prometheusClient.formatTimeSeries(latencyP99Raw);
      const fraudP50 = prometheusClient.formatTimeSeries(fraudP50Raw);
      const fraudP90 = prometheusClient.formatTimeSeries(fraudP90Raw);
      const fraudP99 = prometheusClient.formatTimeSeries(fraudP99Raw);
      const featureDriftSoft = prometheusClient.extractScalarValue(softDriftRaw);
      const featureDriftHard = prometheusClient.extractScalarValue(hardDriftRaw);
      const retrainTriggers = prometheusClient.extractScalarValue(retrainTriggersRaw);
      const shadowDisRate = prometheusClient.extractScalarValue(shadowDisRateRaw);

      setRequestRateData(clip(requestRate));
      setDriftScoreData(clip(driftScoreTS));
      setLatencyData({
        p50: clip(latencyP50),
        p90: clip(latencyP90),
        p99: clip(latencyP99),
      });
      setFraudProbData({
        p50: clip(fraudP50),
        p90: clip(fraudP90),
        p99: clip(fraudP99),
      });

      setCurrentMetrics({
        driftScore,
        featureDriftSoft,
        featureDriftHard,
        retrainTriggers,
        shadowDisagreementRate: shadowDisRate,
      });

      setPrometheusConnected(true);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch Prometheus metrics:', err);
      setPrometheusConnected(false);
      setError(err.message);
      setLoading(false);
    }
  };

  const getMergedChartData = () => mergeTimeSeries([
    { key: 'rps', data: requestRateData },
    { key: 'drift', data: driftScoreData },
  ]);

  const getMergedLatencyData = () => mergeTimeSeries([
    { key: 'p50', data: latencyData.p50, transform: (value) => value * 1000 },
    { key: 'p90', data: latencyData.p90, transform: (value) => value * 1000 },
    { key: 'p99', data: latencyData.p99, transform: (value) => value * 1000 },
  ]);

  const getMergedFraudProbData = () => mergeTimeSeries([
    { key: 'p50', data: fraudProbData.p50 },
    { key: 'p90', data: fraudProbData.p90 },
    { key: 'p99', data: fraudProbData.p99 },
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    fetchMetrics();

    intervalRef.current = setInterval(fetchMetrics, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, timeRange, maxDataPoints]);

  return {
    prometheusConnected,
    loading,
    error,

    requestRateData,
    driftScoreData,
    latencyData,
    fraudProbData,

    currentMetrics,

    chartData: getMergedChartData(),
    latencyChartData: getMergedLatencyData(),
    fraudProbChartData: getMergedFraudProbData(),

    refresh: fetchMetrics,
  };
};
