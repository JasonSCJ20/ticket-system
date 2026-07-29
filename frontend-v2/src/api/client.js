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

// Human-friendly fallback per HTTP status, used only when the backend didn't
// send a specific message — a status code alone tells a user nothing useful.
const STATUS_FALLBACK_MESSAGES = {
  400: 'That request was not valid.',
  401: 'You need to sign in to do that.',
  403: "You don't have permission to do that.",
  404: "That wasn't found — it may have been removed or moved.",
  408: 'The request took too long. Please try again.',
  409: "That conflicts with the current state — someone may have changed it already.",
  422: 'Some of the details provided are not valid.',
  429: 'Too many attempts — please wait a moment and try again.',
};

function statusFallbackMessage(status) {
  if (status >= 500) return 'The backend is unavailable right now. Please try again shortly.';
  return STATUS_FALLBACK_MESSAGES[status] || null;
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
  // express-validator can report multiple invalid fields at once — surface
  // all of them rather than just the first, so a user can fix everything in
  // one pass instead of resubmitting repeatedly.
  const validationErrors = Array.isArray(body?.errors)
    ? body.errors.map((e) => e.msg).filter(Boolean)
    : [];
  const validationMessage = validationErrors.length > 0 ? validationErrors.join(' ') : null;
  const plainTextMessage = rawText && !rawText.trim().startsWith('<') ? rawText.trim() : null;
  const message =
    body.detail ||
    body.error ||
    validationMessage ||
    plainTextMessage ||
    statusFallbackMessage(response.status) ||
    `${fallbackMessage} (HTTP ${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.body = body;
  error.validationErrors = validationErrors;
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
