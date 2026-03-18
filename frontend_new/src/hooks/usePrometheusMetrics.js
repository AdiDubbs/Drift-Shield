import { useCallback, useEffect, useRef, useState } from 'react';
import { prometheusClient } from '../api/prometheusClient';

const DEFAULT_CARD_STATE = { loading: true, error: null, empty: false };
const DEFAULT_CHART_STATES = {
  requestRate: { ...DEFAULT_CARD_STATE },
  drift: { ...DEFAULT_CARD_STATE },
  driftCompare: { ...DEFAULT_CARD_STATE },
  disagreementVsDrift: { ...DEFAULT_CARD_STATE },
  latency: { ...DEFAULT_CARD_STATE },
  fraud: { ...DEFAULT_CARD_STATE },
  fraudCompare: { ...DEFAULT_CARD_STATE },
  accuracyCompare: { ...DEFAULT_CARD_STATE },
};

export const usePrometheusMetrics = (options = {}) => {
  const {
    timeRange = '15m',
    maxDataPoints = 100,
    enabled = true,
    schemaVersion = 1,
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
  const [driftCompareData, setDriftCompareData] = useState([]);
  const [disagreementVsDriftData, setDisagreementVsDriftData] = useState([]);
  const [fraudCompareData, setFraudCompareData] = useState([]);
  const [accuracyCompareData, setAccuracyCompareData] = useState([]);

  // Current/instant metrics
  const [currentMetrics, setCurrentMetrics] = useState({
    driftScore: null,
    driftReady: false,
    featureDriftSoft: 0,
    featureDriftHard: 0,
    retrainTriggers: 0,
    shadowDisagreementRate: 0,
    labeledActivePerMin5m: 0,
    labeledShadowPerMin5m: 0,
    labeledActiveInRange: 0,
    labeledShadowInRange: 0,
    labeledActiveTotal: 0,
    labeledShadowTotal: 0,
  });

  const intervalRef = useRef(null);
  const controllerRef = useRef(null);
  const normalizedSchemaVersion = Number.isFinite(Number(schemaVersion)) && Number(schemaVersion) >= 1
    ? Math.trunc(Number(schemaVersion))
    : 1;
  const schemaFilter = `{schema_version="${normalizedSchemaVersion}"}`;
  const withSchemaFilter = (metric) => `${metric}${schemaFilter}`;
  const withSchemaRange = (metric, range) => `${metric}${schemaFilter}[${range}]`;
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
          driftCompare: { loading: true, error: null, empty: false },
          disagreementVsDrift: { loading: true, error: null, empty: false },
          latency: { loading: true, error: null, empty: false },
          fraud: { loading: true, error: null, empty: false },
          fraudCompare: { loading: true, error: null, empty: false },
          accuracyCompare: { loading: true, error: null, empty: false },
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
        driftReadyRaw,
        driftScoreRaw,
        driftScoreTSRaw,
        shadowDriftReadyRaw,
        shadowDriftScoreTSRaw,
        shadowDisRateTSRaw,
        latencyP50Raw,
        latencyP90Raw,
        latencyP99Raw,
        fraudP50Raw,
        shadowFraudP50Raw,
        activeAccuracyRaw,
        shadowAccuracyRaw,
        activeLabeledRateRaw,
        shadowLabeledRateRaw,
        activeLabeledRangeRaw,
        shadowLabeledRangeRaw,
        activeLabeledTotalRaw,
        shadowLabeledTotalRaw,
        fraudP90Raw,
        fraudP99Raw,
        softDriftRaw,
        hardDriftRaw,
        retrainTriggersRaw,
        shadowDisRateRaw,
      ] = await Promise.all([
        queryRangeSafe(`sum(rate(${withSchemaRange('requests_total', '1m')}))`, start, end, '5s', signal),
        querySafe(`max(${withSchemaFilter('drift_ready')})`, signal),
        querySafe(`avg((${withSchemaFilter('drift_score')}) and on() (${withSchemaFilter('drift_ready')} == 1))`, signal),
        queryRangeSafe(`avg((${withSchemaFilter('drift_score')}) and on() (${withSchemaFilter('drift_ready')} == 1))`, start, end, '5s', signal),
        querySafe(`max(${withSchemaFilter('shadow_drift_ready')})`, signal),
        queryRangeSafe(`avg((${withSchemaFilter('shadow_drift_score')}) and on() (${withSchemaFilter('shadow_drift_ready')} == 1))`, start, end, '5s', signal),
        queryRangeSafe(
          `(sum(rate(${withSchemaRange('shadow_disagree_total', '5m')})) / clamp_min(sum(rate(${withSchemaRange('shadow_predictions_total', '5m')})), 1e-9)) and on() (sum(rate(${withSchemaRange('shadow_predictions_total', '5m')})) > 0)`,
          start,
          end,
          '5s',
          signal
        ),
        queryRangeSafe(`histogram_quantile(0.50, sum by (le) (rate(${withSchemaRange('request_latency_seconds_bucket', '5m')})))`, start, end, '5s', signal),
        queryRangeSafe(`histogram_quantile(0.90, sum by (le) (rate(${withSchemaRange('request_latency_seconds_bucket', '5m')})))`, start, end, '5s', signal),
        queryRangeSafe(`histogram_quantile(0.99, sum by (le) (rate(${withSchemaRange('request_latency_seconds_bucket', '5m')})))`, start, end, '5s', signal),
        queryRangeSafe(`histogram_quantile(0.50, sum by (le) (rate(${withSchemaRange('p_fraud_bucket', '5m')})))`, start, end, '5s', signal),
        queryRangeSafe(`histogram_quantile(0.50, sum by (le) (rate(${withSchemaRange('shadow_p_fraud_bucket', '5m')})))`, start, end, '5s', signal),
        queryRangeSafe(
          `(sum(rate(${withSchemaRange('active_eval_labeled_correct_total', '5m')})) / clamp_min(sum(rate(${withSchemaRange('active_eval_labeled_total', '5m')})), 1e-9)) and on() (sum(rate(${withSchemaRange('active_eval_labeled_total', '5m')})) > 0)`,
          start,
          end,
          '5s',
          signal
        ),
        queryRangeSafe(
          `(sum(rate(${withSchemaRange('shadow_eval_labeled_correct_total', '5m')})) / clamp_min(sum(rate(${withSchemaRange('shadow_eval_labeled_total', '5m')})), 1e-9)) and on() (sum(rate(${withSchemaRange('shadow_eval_labeled_total', '5m')})) > 0)`,
          start,
          end,
          '5s',
          signal
        ),
        querySafe(`sum(rate(${withSchemaRange('active_eval_labeled_total', '5m')}))`, signal),
        querySafe(`sum(rate(${withSchemaRange('shadow_eval_labeled_total', '5m')}))`, signal),
        querySafe(`sum(increase(${withSchemaRange('active_eval_labeled_total', timeRange)}))`, signal),
        querySafe(`sum(increase(${withSchemaRange('shadow_eval_labeled_total', timeRange)}))`, signal),
        querySafe(`sum(${withSchemaFilter('active_eval_labeled_total')})`, signal),
        querySafe(`sum(${withSchemaFilter('shadow_eval_labeled_total')})`, signal),
        queryRangeSafe(`histogram_quantile(0.90, sum by (le) (rate(${withSchemaRange('p_fraud_bucket', '5m')})))`, start, end, '5s', signal),
        queryRangeSafe(`histogram_quantile(0.99, sum by (le) (rate(${withSchemaRange('p_fraud_bucket', '5m')})))`, start, end, '5s', signal),
        querySafe(`max(${withSchemaFilter('feature_soft_count')})`, signal),
        querySafe(`max(${withSchemaFilter('feature_hard_count')})`, signal),
        querySafe(`sum(${withSchemaFilter('retrain_triggers_total')})`, signal),
        querySafe(
          `(sum(rate(${withSchemaRange('shadow_disagree_total', '5m')})) / clamp_min(sum(rate(${withSchemaRange('shadow_predictions_total', '5m')})), 1e-9)) and on() (sum(rate(${withSchemaRange('shadow_predictions_total', '5m')})) > 0)`,
          signal
        ),
      ]);

      if (signal?.aborted) return;

      const requestRate = prometheusClient.formatTimeSeries(requestRateRaw.data);
      const driftReady = prometheusClient.extractScalarValue(driftReadyRaw.data) >= 0.5;
      const shadowDriftReady = prometheusClient.extractScalarValue(shadowDriftReadyRaw.data) >= 0.5;
      const driftScore = driftReady ? prometheusClient.extractScalarValue(driftScoreRaw.data) : null;
      const driftScoreTS = prometheusClient.formatTimeSeries(driftScoreTSRaw.data);
      const shadowDriftScoreTS = prometheusClient.formatTimeSeries(shadowDriftScoreTSRaw.data);
      const shadowDisRateTS = prometheusClient.formatTimeSeries(shadowDisRateTSRaw.data);
      const latencyP50 = prometheusClient.formatTimeSeries(latencyP50Raw.data);
      const latencyP90 = prometheusClient.formatTimeSeries(latencyP90Raw.data);
      const latencyP99 = prometheusClient.formatTimeSeries(latencyP99Raw.data);
      const fraudP50 = prometheusClient.formatTimeSeries(fraudP50Raw.data);
      const shadowFraudP50 = prometheusClient.formatTimeSeries(shadowFraudP50Raw.data);
      const activeAccuracy = prometheusClient.formatTimeSeries(activeAccuracyRaw.data);
      const shadowAccuracy = prometheusClient.formatTimeSeries(shadowAccuracyRaw.data);
      const fraudP90 = prometheusClient.formatTimeSeries(fraudP90Raw.data);
      const fraudP99 = prometheusClient.formatTimeSeries(fraudP99Raw.data);
      const featureDriftSoft = prometheusClient.extractScalarValue(softDriftRaw.data);
      const featureDriftHard = prometheusClient.extractScalarValue(hardDriftRaw.data);
      const retrainTriggers = prometheusClient.extractScalarValue(retrainTriggersRaw.data);
      const shadowDisRate = prometheusClient.extractScalarValue(shadowDisRateRaw.data);
      const labeledActivePerMin5m = prometheusClient.extractScalarValue(activeLabeledRateRaw.data) * 60;
      const labeledShadowPerMin5m = prometheusClient.extractScalarValue(shadowLabeledRateRaw.data) * 60;
      const labeledActiveInRange = prometheusClient.extractScalarValue(activeLabeledRangeRaw.data);
      const labeledShadowInRange = prometheusClient.extractScalarValue(shadowLabeledRangeRaw.data);
      const labeledActiveTotal = prometheusClient.extractScalarValue(activeLabeledTotalRaw.data);
      const labeledShadowTotal = prometheusClient.extractScalarValue(shadowLabeledTotalRaw.data);

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
      setDriftCompareData(clip(mergeTimeSeries([
        { key: 'active', data: driftScoreTS },
        { key: 'shadow', data: shadowDriftScoreTS },
      ])));
      setDisagreementVsDriftData(clip(mergeTimeSeries([
        { key: 'disagreement', data: shadowDisRateTS },
        { key: 'activeDrift', data: driftScoreTS },
        { key: 'shadowDrift', data: shadowDriftScoreTS },
      ])));
      setFraudCompareData(clip(mergeTimeSeries([
        { key: 'active', data: fraudP50 },
        { key: 'shadow', data: shadowFraudP50 },
      ])));
      setAccuracyCompareData(clip(mergeTimeSeries([
        { key: 'active', data: activeAccuracy },
        { key: 'shadow', data: shadowAccuracy },
      ])));

      setCurrentMetrics({
        driftScore,
        driftReady,
        featureDriftSoft,
        featureDriftHard,
        retrainTriggers,
        shadowDisagreementRate: shadowDisRate,
        labeledActivePerMin5m,
        labeledShadowPerMin5m,
        labeledActiveInRange,
        labeledShadowInRange,
        labeledActiveTotal,
        labeledShadowTotal,
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
          warmup: !driftReady && driftScoreTS.length === 0,
        },
        driftCompare: {
          loading: false,
          error: driftScoreTSRaw.error && shadowDriftScoreTSRaw.error ? 'Active/shadow drift compare failed' : null,
          empty: driftScoreTS.length === 0 && shadowDriftScoreTS.length === 0,
          warmup: !driftReady && !shadowDriftReady && driftScoreTS.length === 0 && shadowDriftScoreTS.length === 0,
        },
        disagreementVsDrift: {
          loading: false,
          error:
            shadowDisRateTSRaw.error && driftScoreTSRaw.error && shadowDriftScoreTSRaw.error
              ? 'Shadow disagreement vs drift compare failed'
              : null,
          empty: shadowDisRateTS.length === 0 && driftScoreTS.length === 0 && shadowDriftScoreTS.length === 0,
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
        fraudCompare: {
          loading: false,
          error: fraudP50Raw.error && shadowFraudP50Raw.error ? 'Active/shadow fraud compare failed' : null,
          empty: fraudP50.length === 0 && shadowFraudP50.length === 0,
        },
        accuracyCompare: {
          loading: false,
          error: activeAccuracyRaw.error && shadowAccuracyRaw.error ? 'Active/shadow labeled accuracy compare failed' : null,
          empty: activeAccuracy.length === 0 && shadowAccuracy.length === 0,
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
        driftCompare: { loading: false, error: err.message, empty: false },
        disagreementVsDrift: { loading: false, error: err.message, empty: false },
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
        fraudCompare: {
          loading: false,
          error: err.message,
          empty: false,
        },
        accuracyCompare: {
          loading: false,
          error: err.message,
          empty: false,
        },
      });
      setLoading(false);
    }
  }, [timeRange, maxDataPoints, normalizedSchemaVersion]);

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
    setRequestRateData([]);
    setDriftScoreData([]);
    setLatencyData({ p50: [], p90: [], p99: [] });
    setFraudProbData({ p50: [], p90: [], p99: [] });
    setDriftCompareData([]);
    setDisagreementVsDriftData([]);
    setFraudCompareData([]);
    setAccuracyCompareData([]);
    setCurrentMetrics({
      driftScore: null,
      driftReady: false,
      featureDriftSoft: 0,
      featureDriftHard: 0,
      retrainTriggers: 0,
      shadowDisagreementRate: 0,
      labeledActivePerMin5m: 0,
      labeledShadowPerMin5m: 0,
      labeledActiveInRange: 0,
      labeledShadowInRange: 0,
      labeledActiveTotal: 0,
      labeledShadowTotal: 0,
    });
    setChartStates(DEFAULT_CHART_STATES);
  }, [normalizedSchemaVersion]);

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
  }, [enabled, timeRange, maxDataPoints, normalizedSchemaVersion, fetchMetrics]);

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
    driftCompareData,
    disagreementVsDriftData,
    fraudCompareData,
    accuracyCompareData,

    currentMetrics,
    chartStates,

    chartData: getMergedChartData(),
    latencyChartData: getMergedLatencyData(),
    fraudProbChartData: getMergedFraudProbData(),

    refresh,
  };
};
