const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const appendQuery = (endpoint, query) => {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `${endpoint}?${qs}` : endpoint;
};

const normalizeSchemaArgs = (schemaVersionOrOptions, maybeOptions = {}) => {
  if (typeof schemaVersionOrOptions === 'object' && schemaVersionOrOptions !== null) {
    return { schemaVersion: 1, options: schemaVersionOrOptions };
  }
  const schemaVersion = Number(schemaVersionOrOptions);
  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion >= 1 ? Math.trunc(schemaVersion) : 1,
    options: maybeOptions || {},
  };
};

class ApiClient {
  async get(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${appendQuery(endpoint, options.query)}`, {
      method: 'GET',
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText || 'Network error'}`);
    }
    return response.json();
  }

  async post(endpoint, data, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText || 'Network error'}`);
    }
    return response.json();
  }

  // Health check
  async health(options = {}) {
    return this.get('/health', options);
  }

  async getPredictContract(options = {}) {
    return this.get('/contracts/predict', options);
  }

  // Get dashboard stats
  async getDashboardStats(schemaVersionOrOptions = 1, maybeOptions = {}) {
    const { schemaVersion, options } = normalizeSchemaArgs(schemaVersionOrOptions, maybeOptions);
    return this.get('/dashboard/stats', {
      ...options,
      query: { ...(options.query || {}), schema_version: schemaVersion },
    });
  }

  // Get model info (drift thresholds, versions, etc.)
  async getModelInfo(schemaVersionOrOptions = 1, maybeOptions = {}) {
    const { schemaVersion, options } = normalizeSchemaArgs(schemaVersionOrOptions, maybeOptions);
    return this.get('/models/info', {
      ...options,
      query: { ...(options.query || {}), schema_version: schemaVersion },
    });
  }

  // Make prediction
  async predict(transactionFeatures, schemaVersion = 1, options = {}) {
    return this.post('/predict', {
      schema_version: schemaVersion,
      transaction_features: transactionFeatures,
    }, options);
  }

  // Trigger a manual retrain
  async triggerRetrain(schemaVersionOrOptions = 1, maybeOptions = {}) {
    const { schemaVersion, options } = normalizeSchemaArgs(schemaVersionOrOptions, maybeOptions);
    return this.post(`/retrain?schema_version=${schemaVersion}`, {}, options);
  }

  // Get detailed system and model status
  async getSystemStatus(schemaVersionOrOptions = 1, maybeOptions = {}) {
    const { schemaVersion, options } = normalizeSchemaArgs(schemaVersionOrOptions, maybeOptions);
    return this.get('/system/status', {
      ...options,
      query: { ...(options.query || {}), schema_version: schemaVersion },
    });
  }

  // Get Prometheus metrics (raw)
  async getMetrics(options = {}) {
    const response = await fetch(`${API_BASE_URL}/metrics`, { signal: options.signal });
    return response.text();
  }
}

export const apiClient = new ApiClient();
export default apiClient;
