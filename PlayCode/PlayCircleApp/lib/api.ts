// Base URL for the FastAPI backend.
// Override by setting EXPO_PUBLIC_API_URL in a .env file at the project root,
// e.g. EXPO_PUBLIC_API_URL=http://192.168.1.5:8000 if testing from a phone on
// the same Wi-Fi (127.0.0.1 on a phone means the phone itself, not your laptop).
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
  }
}

// Set by AuthProvider on login/logout/app-start so every request can attach
// the current token without every call site having to pass it explicitly.
let currentToken: string | null = null;
export function setApiToken(token: string | null): void {
  currentToken = token;
}

// Set by AuthProvider so a 401 from any request (e.g. an expired token) can
// trigger a logout + redirect to the login screen, not just a silent failure.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
  }

  if (!response.ok) {
    let detail: unknown;
    try {
      const body = await response.json();
      detail = body.detail ?? body;
    } catch {
      detail = await response.text();
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
