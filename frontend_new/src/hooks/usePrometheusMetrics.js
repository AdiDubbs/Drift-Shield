import { useCallback, useEffect, useRef, useState } from 'react';
import { prometheusClient } from '../api/prometheusClient';

const DEFAULT_CARD_STATE = { loading: true, error: null, empty: false };
const DEFAULT_CHART_STATES = {
  requestRate: { ...DEFAULT_CARD_STATE },
  drift: { ...DEFAULT_CARD_STATE },
  latency: { ...DEFAULT_CARD_STATE },
  fraud: { ...DEFAULT_CARD_STATE },
};

export const usePrometheusMetrics = (options = {}) => {
  const {
    timeRange = '15m',
    maxDataPoints = 100,
    enabled = true,
  } = options;

  const [prometheusConnected, setPrometheusConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartStates, setChartStates] = useState(DEFAULT_CHART_STATES);

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
  const controllerRef = useRef(null);
  const clip = (data) => (data.length > maxDataPoints ? data.slice(-maxDataPoints) : data);
  const emptyResult = () => ({ result: [] });

  const querySafe = async (query, signal) => {
    try {
      const data = await prometheusClient.query(query, { signal });
      return { data, error: null };
    } catch (err) {
      return { data: emptyResult(), error: err };
    }
  };

  const queryRangeSafe = async (query, start, end, step = '5s', signal) => {
    try {
      const data = await prometheusClient.queryRange(query, start, end, step, { signal });
      return { data, error: null };
    } catch (err) {
      return { data: emptyResult(), error: err };
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

  const fetchMetrics = useCallback(async (options = {}) => {
    const signal = options.signal;
    try {
      if (options.showLoading) {
        setLoading(true);
        setChartStates({
          requestRate: { loading: true, error: null, empty: false },
          drift: { loading: true, error: null, empty: false },
          latency: { loading: true, error: null, empty: false },
          fraud: { loading: true, error: null, empty: false },
        });
      }

      const healthy = await prometheusClient.health({ signal });
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
        queryRangeSafe('sum(rate(requests_total[1m]))', start, end, '5s', signal),
        querySafe('avg(drift_score)', signal),
        queryRangeSafe('avg(drift_score)', start, end, '5s', signal),
        queryRangeSafe('histogram_quantile(0.50, sum by (le) (rate(request_latency_seconds_bucket[5m])))', start, end, '5s', signal),
        queryRangeSafe('histogram_quantile(0.90, sum by (le) (rate(request_latency_seconds_bucket[5m])))', start, end, '5s', signal),
        queryRangeSafe('histogram_quantile(0.99, sum by (le) (rate(request_latency_seconds_bucket[5m])))', start, end, '5s', signal),
        queryRangeSafe('histogram_quantile(0.50, sum by (le) (rate(p_fraud_bucket[5m])))', start, end, '5s', signal),
        queryRangeSafe('histogram_quantile(0.90, sum by (le) (rate(p_fraud_bucket[5m])))', start, end, '5s', signal),
        queryRangeSafe('histogram_quantile(0.99, sum by (le) (rate(p_fraud_bucket[5m])))', start, end, '5s', signal),
        querySafe('max(feature_soft_count)', signal),
        querySafe('max(feature_hard_count)', signal),
        querySafe('sum(retrain_triggers_total)', signal),
        querySafe('sum(rate(shadow_disagree_total[5m]))', signal),
      ]);

      if (signal?.aborted) return;

      const requestRate = prometheusClient.formatTimeSeries(requestRateRaw.data);
      const driftScore = prometheusClient.extractScalarValue(driftScoreRaw.data);
      const driftScoreTS = prometheusClient.formatTimeSeries(driftScoreTSRaw.data);
      const latencyP50 = prometheusClient.formatTimeSeries(latencyP50Raw.data);
      const latencyP90 = prometheusClient.formatTimeSeries(latencyP90Raw.data);
      const latencyP99 = prometheusClient.formatTimeSeries(latencyP99Raw.data);
      const fraudP50 = prometheusClient.formatTimeSeries(fraudP50Raw.data);
      const fraudP90 = prometheusClient.formatTimeSeries(fraudP90Raw.data);
      const fraudP99 = prometheusClient.formatTimeSeries(fraudP99Raw.data);
      const featureDriftSoft = prometheusClient.extractScalarValue(softDriftRaw.data);
      const featureDriftHard = prometheusClient.extractScalarValue(hardDriftRaw.data);
      const retrainTriggers = prometheusClient.extractScalarValue(retrainTriggersRaw.data);
      const shadowDisRate = prometheusClient.extractScalarValue(shadowDisRateRaw.data);

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

      setChartStates({
        requestRate: {
          loading: false,
          error: requestRateRaw.error ? 'Request-rate query failed' : null,
          empty: requestRate.length === 0,
        },
        drift: {
          loading: false,
          error: driftScoreRaw.error && driftScoreTSRaw.error ? 'Drift queries failed' : null,
          empty: driftScoreTS.length === 0,
        },
        latency: {
          loading: false,
          error: latencyP50Raw.error && latencyP90Raw.error && latencyP99Raw.error ? 'Latency queries failed' : null,
          empty: latencyP50.length === 0 && latencyP90.length === 0 && latencyP99.length === 0,
        },
        fraud: {
          loading: false,
          error: fraudP50Raw.error && fraudP90Raw.error && fraudP99Raw.error ? 'Fraud-probability queries failed' : null,
          empty: fraudP50.length === 0 && fraudP90.length === 0 && fraudP99.length === 0,
        },
      });

      setPrometheusConnected(true);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        return;
      }
      console.error('Failed to fetch Prometheus metrics:', err);
      setPrometheusConnected(false);
      setError(err.message);
      setChartStates({
        requestRate: { loading: false, error: err.message, empty: false },
        drift: { loading: false, error: err.message, empty: false },
        latency: {
          loading: false,
          error: err.message,
          empty: false,
        },
        fraud: {
          loading: false,
          error: err.message,
          empty: false,
        },
      });
      setLoading(false);
    }
  }, [timeRange, maxDataPoints]);

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

    const run = () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      fetchMetrics({ signal: controller.signal, showLoading: false });
    };

    const firstController = new AbortController();
    controllerRef.current = firstController;
    fetchMetrics({ signal: firstController.signal, showLoading: true });

    intervalRef.current = setInterval(run, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
    };
  }, [enabled, timeRange, maxDataPoints, fetchMetrics]);

  const refresh = () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    fetchMetrics({ signal: controller.signal, showLoading: true });
  };

  return {
    prometheusConnected,
    loading,
    error,

    requestRateData,
    driftScoreData,
    latencyData,
    fraudProbData,

    currentMetrics,
    chartStates,

    chartData: getMergedChartData(),
    latencyChartData: getMergedLatencyData(),
    fraudProbChartData: getMergedFraudProbData(),

    refresh,
  };
};
