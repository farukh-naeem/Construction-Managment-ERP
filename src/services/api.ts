/**
 * Base API client for backend connection.
 * Handles base URL, auth token, and generic fetch wrapper.
 */

// Frontend can switch between environments by setting VITE_API_URL in .env files.
// Fallback to local dev server if not provided.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const TOKEN_KEY = "builderp_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiOptions extends RequestInit {
  /** Override token (e.g. null for login to skip auth) */
  token?: string | null;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token: tokenOverride, ...init } = options;
  const token = tokenOverride !== undefined ? tokenOverride : getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error ?? `Request failed: ${res.status}`) as Error & { status?: number; data?: unknown };
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data as T;
}
