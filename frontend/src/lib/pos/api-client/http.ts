// HTTP dasar klien POS: fetch ke /api/pos, query string, bentuk respons standar.

const API_BASE = '/api/pos';

// Generic fetch wrapper
export async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

/** Query string tanpa nilai kosong (undefined/null/''). */
export function toQueryString(params?: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** Respons standar endpoint POS: `{ success, data?, error? }`. */
export interface ApiResult<T> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}
