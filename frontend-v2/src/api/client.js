// API base URL resolution:
// 1) Explicit build-time override via VITE_API_URL.
// 2) Local/dev hosts use relative /api (Vite proxy or same-origin reverse proxy).
// 3) Everything else defaults to the production backend.
const FRONTEND_HOST = typeof window !== 'undefined' ? window.location.hostname : '';
const IS_LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/i.test(
  FRONTEND_HOST,
);
const DEFAULT_REMOTE_API_URL = 'https://soc-api.scratchsolidsolutions.org/api';
export const API_URL = import.meta.env.VITE_API_URL || (IS_LOCAL_HOST ? '/api' : DEFAULT_REMOTE_API_URL);

const TOKEN_KEY = 'access_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseErrorResponse(response, fallbackMessage) {
  const rawText = await response.text().catch(() => '');
  let body = {};
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = {};
    }
  }
  const firstValidationError = Array.isArray(body?.errors) ? body.errors[0]?.msg : null;
  const plainTextMessage = rawText && !rawText.trim().startsWith('<') ? rawText.trim() : null;
  const serverUnavailableMessage =
    response.status >= 500 ? 'The backend is unavailable right now.' : null;
  const message =
    body.detail ||
    body.error ||
    firstValidationError ||
    plainTextMessage ||
    serverUnavailableMessage ||
    `${fallbackMessage} (HTTP ${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.body = body;
  throw error;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

// Core request helper used by every domain api module.
export async function request(path, { method = 'GET', body, skipAuthRedirect = false } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Unable to reach the API at ${API_URL}. Check the backend URL and CORS configuration.`);
  }

  if (response.status === 401 && !skipAuthRedirect) {
    clearToken();
    if (onUnauthorized) onUnauthorized();
    throw new Error('Your session expired. Please sign in again.');
  }

  if (!response.ok) await parseErrorResponse(response, `Request to ${path} failed`);
  if (response.status === 204) return null;
  return response.json();
}
