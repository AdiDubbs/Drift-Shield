const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL || 'http://localhost:8000/prometheus';

class PrometheusClient {
  constructor(baseUrl = PROMETHEUS_URL) {
    this.baseUrl = baseUrl;
  }

  async query(query) {
    try {
      const url = `${this.baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Prometheus query failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status !== 'success') {
        throw new Error(`Prometheus query error: ${data.error || 'Unknown error'}`);
      }

      return data.data;
    } catch (error) {
      console.error('Prometheus query error:', error);
      throw error;
    }
  }

  async queryRange(query, start, end, step = '5s') {
    try {
      const url = `${this.baseUrl}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Prometheus range query failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status !== 'success') {
        throw new Error(`Prometheus range query error: ${data.error || 'Unknown error'}`);
      }

      return data.data;
    } catch (error) {
      console.error('Prometheus range query error:', error);
      throw error;
    }
  }

  parseTimeRange(timeRange) {
    const match = timeRange.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(`Invalid time range format: ${timeRange}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return value * multipliers[unit];
  }

  formatTimeSeries(data) {
    if (!data.result || data.result.length === 0) {
      return [];
    }

    const series = data.result[0];
    if (!series || !series.values) {
      return [];
    }

    return series.values.map(([timestamp, value]) => ({
      time: new Date(timestamp * 1000).toLocaleTimeString('en-US', { hour12: false }),
      timestamp: timestamp,
      value: parseFloat(value),
    }));
  }

  extractScalarValue(data) {
    if (!data.result || data.result.length === 0) {
      return 0;
    }

    const series = data.result[0];
    if (!series || !series.value) {
      return 0;
    }

    return parseFloat(series.value[1]);
  }

  async health() {
    try {
      const response = await fetch(`${this.baseUrl}/-/healthy`, { method: 'GET' });
      return response.ok;
    } catch (error) {
      console.error('Prometheus health check failed:', error);
      return false;
    }
  }


}

export const prometheusClient = new PrometheusClient();
