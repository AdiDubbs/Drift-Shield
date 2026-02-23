const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ApiClient {
  async get(endpoint) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText || 'Network error'}`);
    }
    return response.json();
  }

  async post(endpoint, data) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText || 'Network error'}`);
    }
    return response.json();
  }

  // Health check
  async health() {
    return this.get('/health');
  }

  // Get dashboard stats
  async getDashboardStats() {
    return this.get('/dashboard/stats');
  }

  // Get model info (drift thresholds, versions, etc.)
  async getModelInfo() {
    return this.get('/models/info');
  }

  // Make prediction
  async predict(transactionFeatures, schemaVersion = 1) {
    return this.post('/predict', {
      schema_version: schemaVersion,
      transaction_features: transactionFeatures,
    });
  }

  // Trigger a manual retrain
  async triggerRetrain() {
    return this.post('/retrain', {});
  }

  // Get Prometheus metrics (raw)
  async getMetrics() {
    const response = await fetch(`${API_BASE_URL}/metrics`);
    return response.text();
  }
}

export const apiClient = new ApiClient();
export default apiClient;
