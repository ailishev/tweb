const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3001';

export class ApiClient {
  private get token() {
    return localStorage.getItem('session_token');
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    headers.set('Content-Type', 'application/json');
    if(this.token) headers.set('Authorization', `Bearer ${this.token}`);

    const response = await fetch(`${API_BASE}${path}`, {...init, headers});
    if(!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}

export const apiClient = new ApiClient();
