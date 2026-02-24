const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ApiClient {
  async get(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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

  // Get dashboard stats
  async getDashboardStats(options = {}) {
    return this.get('/dashboard/stats', options);
  }

  // Get model info (drift thresholds, versions, etc.)
  async getModelInfo(options = {}) {
    return this.get('/models/info', options);
  }

  // Make prediction
  async predict(transactionFeatures, schemaVersion = 1, options = {}) {
    return this.post('/predict', {
      schema_version: schemaVersion,
      transaction_features: transactionFeatures,
    }, options);
  }

  // Trigger a manual retrain
  async triggerRetrain(options = {}) {
    return this.post('/retrain', {}, options);
  }

  // Get Prometheus metrics (raw)
  async getMetrics(options = {}) {
    const response = await fetch(`${API_BASE_URL}/metrics`, { signal: options.signal });
    return response.text();
  }
}

export const apiClient = new ApiClient();
export default apiClient;
