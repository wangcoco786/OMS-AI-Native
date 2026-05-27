const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message || `Request failed with status ${response.status}`,
      body,
    );
  }
  return response.json() as Promise<T>;
}

export const apiClient = {
  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }
    return fetch(url.toString(), {
      headers: { 'Content-Type': 'application/json' },
    }).then(handleResponse<T>);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handleResponse<T>);
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handleResponse<T>);
  },

  delete<T>(path: string): Promise<T> {
    return fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }).then(handleResponse<T>);
  },
};
