// API base URL resolution:
// 1) Use explicit env override when provided.
// 2) In local/dev-style hosts, use relative /api (works with Vite proxy or same-origin reverse proxy).
// 3) In any non-local deployment, default to the remote Render API origin.
const FRONTEND_HOST = typeof window !== 'undefined' ? window.location.hostname : ''
const IS_LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/i.test(FRONTEND_HOST)
const DEFAULT_REMOTE_API_URL = 'https://scj-ticket-system.onrender.com/api'
const API_URL = import.meta.env.VITE_API_URL || (IS_LOCAL_HOST ? '/api' : DEFAULT_REMOTE_API_URL)

/**
 * Parses a failed fetch response and throws a normalized Error.
 * @param {Response} r
 * @param {string} fallbackMessage
 * @returns {Promise<never>}
 */
async function parseErrorResponse(r, fallbackMessage) {
  const rawText = await r.text().catch(() => '');
  let err = {};
  if (rawText) {
    try {
      err = JSON.parse(rawText);
    } catch {
      err = {};
    }
  }
  const firstValidationError = Array.isArray(err?.errors) ? err.errors[0]?.msg : null;
  const plainTextMessage = rawText && !rawText.trim().startsWith('<') ? rawText.trim() : null;
  const serverUnavailableMessage = r.status >= 500
    ? 'Backend service is unavailable or returned an internal server error. Ensure the Node API is running on port 8001.'
    : null;
  throw new Error(
    err.detail ||
    err.error ||
    firstValidationError ||
    plainTextMessage ||
    serverUnavailableMessage ||
    `${fallbackMessage} (HTTP ${r.status})`
  );
}

/**
 * Builds Authorization headers from the current access token.
 * @returns {Record<string, string>}
 */
function getAuthHeaders() {
  // Get token from localStorage
  const token = localStorage.getItem('access_token');
  // Return headers with Bearer token if available
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Authenticates a user and stores the returned access token.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object>}
 */
export async function login(username, password, mfaCode = '') {
  const normalizedUsername = String(username || '').trim();
  // Make POST request to token endpoint using API_URL
  let r;
  try {
    r = await fetch(`${API_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: normalizedUsername, password, ...(mfaCode ? { mfaCode } : {}) }),
    });
  } catch (_err) {
    throw new Error(`Unable to reach authentication API at ${API_URL}. Verify backend URL/CORS and deployment health.`)
  }
  if (r.status === 401) {
    const err = await r.json().catch(() => ({}));
    if (err?.mfaRequired) return { mfaRequired: true };
    throw new Error(err.error || 'Login failed');
  }
  // Throw error if request fails
  if (!r.ok) await parseErrorResponse(r, 'Login failed');
  // Parse response JSON
  const data = await r.json();
  // Store token in localStorage
  localStorage.setItem('access_token', data.access_token);
  // Return response data
  return data;
}

export async function logoutSession() {
  const r = await fetch(`${API_URL}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (r.status === 401) return { ok: true };
  if (!r.ok) await parseErrorResponse(r, 'Failed to log out');
  return r.json();
}

export async function fetchMfaSetup() {
  const r = await fetch(`${API_URL}/auth/mfa/setup`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to initialize MFA setup');
  return r.json();
}

export async function enableMfa(code) {
  const r = await fetch(`${API_URL}/auth/mfa/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ code }),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to enable MFA');
  return r.json();
}

export async function disableMfa(code) {
  const r = await fetch(`${API_URL}/auth/mfa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ code }),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to disable MFA');
  return r.json();
}

/**
 * Creates a new user account.
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createAccount(payload) {
  const r = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) await parseErrorResponse(r, 'Failed to create account');
  return r.json();
}

/**
 * Recovers username by account email.
 * @param {string} email
 * @returns {Promise<Object>}
 */
export async function forgotUsername(email) {
  const r = await fetch(`${API_URL}/auth/forgot-username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) await parseErrorResponse(r, 'Failed to recover username');
  return r.json();
}

/**
 * Requests a password reset code for a user email.
 * @param {string} email
 * @returns {Promise<Object>}
 */
export async function requestPasswordReset(email) {
  const r = await fetch(`${API_URL}/auth/forgot-password/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) await parseErrorResponse(r, 'Failed to request password reset');
  return r.json();
}

/**
 * Resets a password using reset code flow payload.
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function resetPassword(payload) {
  const r = await fetch(`${API_URL}/auth/forgot-password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) await parseErrorResponse(r, 'Failed to reset password');
  return r.json();
}

/**
 * Fetches the authenticated user profile.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchCurrentUser() {
  const r = await fetch(`${API_URL}/me`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to fetch current user');
  return r.json();
}

/**
 * Fetches incident tickets.
 * Returns null when unauthorized.
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchTickets() {
  // Make GET request to tickets endpoint with auth headers
  const r = await fetch(`${API_URL}/tickets`, { headers: getAuthHeaders() });
  // Return null if unauthorized so the caller can handle it
  if (r.status === 401) return null;
  // Throw error if request fails for other reasons
  if (!r.ok) await parseErrorResponse(r, 'Failed to fetch tickets');
  // Return parsed JSON
  return r.json();
}

/**
 * Creates a new incident ticket.
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createTicket(payload) {
  // Make POST request to tickets endpoint
  const r = await fetch(`${API_URL}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  // Throw error with detail if request fails
  if (!r.ok) await parseErrorResponse(r, 'Failed to create ticket');
  // Return parsed JSON
  return r.json();
}

/**
 * Updates ticket fields (status, assignee, metadata).
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function updateTicket(ticketId, payload) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to update ticket');
  return r.json();
}

/**
 * Fetches ticket lifecycle history.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchTicketHistory(ticketId) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/history`, {
    headers: getAuthHeaders(),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load ticket history');
  return r.json();
}

/**
 * Fetches executive ticket KPI metrics.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchExecutiveTicketMetrics() {
  const r = await fetch(`${API_URL}/tickets/metrics/executive`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load executive ticket metrics')
  return r.json()
}

/**
 * Transitions a ticket lifecycle stage.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function transitionTicketLifecycle(ticketId, payload) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to transition ticket lifecycle stage')
  return r.json()
}

/**
 * Fetches collaboration notes for a ticket.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchTicketComments(ticketId) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/comments`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load collaboration notes')
  return r.json()
}

/**
 * Adds a collaboration note to a ticket.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function addTicketComment(ticketId, payload) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to add collaboration note')
  return r.json()
}

/**
 * Fetches action items for a ticket.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchTicketActionItems(ticketId) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/action-items`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load action items')
  return r.json()
}

/**
 * Creates an action item for a ticket.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function createTicketActionItem(ticketId, payload) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/action-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to create action item')
  return r.json()
}

/**
 * Updates a ticket action item.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @param {number|string} actionItemId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function updateTicketActionItem(ticketId, actionItemId, payload) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/action-items/${actionItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to update action item')
  return r.json()
}

/**
 * Fetches generated ticket resolution report.
 * Returns { missing: true } when report does not exist yet.
 * Returns null when unauthorized.
 * @param {number|string} ticketId
 * @returns {Promise<Object|null>}
 */
export async function fetchTicketResolutionReport(ticketId) {
  const r = await fetch(`${API_URL}/tickets/${ticketId}/report`, {
    headers: getAuthHeaders(),
  });
  if (r.status === 401) return null;
  if (r.status === 404) return { missing: true };
  if (!r.ok) await parseErrorResponse(r, 'Failed to load resolution report');
  return r.json();
}

/**
 * Fetches registered users/staff.
 * Returns null when unauthorized.
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchUsers() {
  const r = await fetch(`${API_URL}/users`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load IT staff');
  return r.json();
}

/**
 * Creates a new staff user.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function createUser(payload) {
  const r = await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to create IT staff user');
  return r.json();
}

/**
 * Preloads sample or initial users.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function preloadUsers() {
  const r = await fetch(`${API_URL}/users/preload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to preload IT staff users');
  return r.json();
}

/**
 * Fetches global security health summary.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchSecurityHealthSummary() {
  const r = await fetch(`${API_URL}/security/health-summary`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load security health summary');
  return r.json();
}

/**
 * Fetches command-centre fortress posture telemetry.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchFortressPosture() {
  const r = await fetch(`${API_URL}/security/fortress/posture`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load fortress posture');
  return r.json();
}

/**
 * Runs a command-centre recovery drill.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function runFortressRecoveryDrill() {
  const r = await fetch(`${API_URL}/security/fortress/recovery-drill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to run fortress recovery drill');
  return r.json();
}

/**
 * Fetches executive-level security impact metrics.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchExecutiveImpact() {
  const r = await fetch(`${API_URL}/security/executive-impact`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load executive impact')
  return r.json()
}

/**
 * Fetches monitored security applications.
 * Returns null when unauthorized.
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchSecurityApplications() {
  const r = await fetch(`${API_URL}/security/applications`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load registered applications');
  return r.json();
}

/**
 * Fetches threat intelligence overview metrics.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchThreatIntelOverview() {
  const r = await fetch(`${API_URL}/security/threat-intel/overview`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load threat intel overview');
  return r.json();
}

/**
 * Fetches network visibility overview.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchNetworkVisibilityOverview() {
  const r = await fetch(`${API_URL}/security/network-visibility/overview`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load network visibility overview');
  return r.json();
}

/**
 * Fetches registered network devices.
 * Returns null when unauthorized.
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchNetworkDevices() {
  const r = await fetch(`${API_URL}/security/network/devices`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load network devices')
  return r.json()
}

/**
 * Registers a new network device.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function registerNetworkDevice(payload) {
  const r = await fetch(`${API_URL}/security/network/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to register network device')
  return r.json()
}

/**
 * Runs passive scan for a network device.
 * Returns null when unauthorized.
 * @param {number|string} deviceId
 * @returns {Promise<Object|null>}
 */
export async function runDevicePassiveScan(deviceId) {
  const r = await fetch(`${API_URL}/security/network/devices/${deviceId}/passive-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to run passive scan on device')
  return r.json()
}

/**
 * Runs IDS/IPS check for a network device.
 * Returns null when unauthorized.
 * @param {number|string} deviceId
 * @returns {Promise<Object|null>}
 */
export async function runDeviceIdsIpsCheck(deviceId) {
  const r = await fetch(`${API_URL}/security/network/devices/${deviceId}/ids-ips-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to run IDS/IPS check on device')
  return r.json()
}

/**
 * Fetches database monitoring overview and summary.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchDatabaseOverview() {
  const r = await fetch(`${API_URL}/security/database/overview`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load database monitoring overview')
  return r.json()
}

/**
 * Registers a database asset.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function registerDatabaseAsset(payload) {
  const r = await fetch(`${API_URL}/security/database/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to register database asset')
  return r.json()
}

/**
 * Runs database security scan.
 * Returns null when unauthorized.
 * @param {number|string} assetId
 * @returns {Promise<Object|null>}
 */
export async function runDatabaseSecurityScan(assetId) {
  const r = await fetch(`${API_URL}/security/database/assets/${assetId}/security-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to run database security scan')
  return r.json()
}

/**
 * Fetches patch tasks and grouping summary.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchPatchTasks() {
  const r = await fetch(`${API_URL}/security/patches`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load patch tasks')
  return r.json()
}

/**
 * Creates a patch task.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function createPatchTask(payload) {
  const r = await fetch(`${API_URL}/security/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to create patch task')
  return r.json()
}

/**
 * Updates patch task status.
 * Returns null when unauthorized.
 * @param {number|string} taskId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function updatePatchTaskStatus(taskId, payload) {
  const r = await fetch(`${API_URL}/security/patches/${taskId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to update patch task status')
  return r.json()
}

/**
 * Registers a security-monitored application.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function registerSecurityApplication(payload) {
  const r = await fetch(`${API_URL}/security/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to register application');
  return r.json();
}

/**
 * Runs passive security scan across applications.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function runPassiveSecurityScan() {
  const r = await fetch(`${API_URL}/security/scan/passive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to run passive scan');
  return r.json();
}

/**
 * Runs active security scan across applications.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function runActiveSecurityScan() {
  const r = await fetch(`${API_URL}/security/scan/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to run active scan');
  return r.json();
}

/**
 * Fetches security findings, optionally filtered by status.
 * Returns null when unauthorized.
 * @param {string} [status='']
 * @returns {Promise<Array|Object|null>}
 */
export async function fetchSecurityFindings(status = '') {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await fetch(`${API_URL}/security/findings${suffix}`, { headers: getAuthHeaders() });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to load security findings');
  return r.json();
}

/**
 * Updates finding status.
 * Returns null when unauthorized.
 * @param {number|string} findingId
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function updateFindingStatus(findingId, payload) {
  const r = await fetch(`${API_URL}/security/findings/${findingId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to update finding status')
  return r.json()
}

/**
 * Confirms a finding as validated incident evidence.
 * Returns null when unauthorized.
 * @param {number|string} findingId
 * @returns {Promise<Object|null>}
 */
export async function confirmSecurityFinding(findingId) {
  const r = await fetch(`${API_URL}/security/findings/${findingId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to confirm finding');
  return r.json();
}

/**
 * Creates a ticket directly from a finding.
 * Returns null when unauthorized.
 * @param {number|string} findingId
 * @param {Object} [payload={}]
 * @returns {Promise<Object|null>}
 */
export async function createTicketFromFinding(findingId, payload = {}) {
  const r = await fetch(`${API_URL}/security/findings/${findingId}/create-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (r.status === 401) return null;
  if (!r.ok) await parseErrorResponse(r, 'Failed to create ticket from finding');
  return r.json();
}

/**
 * Fetches executive report.
 * Returns { forbidden: true } when access is denied.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchExecutiveReport() {
  const r = await fetch(`${API_URL}/reports/executive`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (r.status === 403) return { forbidden: true }
  if (!r.ok) await parseErrorResponse(r, 'Failed to load executive report')
  return r.json()
}

/**
 * Fetches technical report.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchTechnicalReport() {
  const r = await fetch(`${API_URL}/reports/technical`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load technical report')
  return r.json()
}

/**
 * Fetches API performance governance metrics (admin only).
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchPerformanceGovernance() {
  const r = await fetch(`${API_URL}/governance/performance`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load performance governance metrics')
  return r.json()
}

/**
 * Fetches governance audit logs.
 * Returns { forbidden: true, rows: [] } when access is denied.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchAuditLogs() {
  const r = await fetch(`${API_URL}/governance/audit-logs`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (r.status === 403) return { forbidden: true, rows: [] }
  if (!r.ok) await parseErrorResponse(r, 'Failed to load governance audit logs')
  return r.json()
}

/**
 * Generates AI triage output for an incident context.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function generateAssistantTriage(payload) {
  const r = await fetch(`${API_URL}/assistant/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to generate assistant triage')
  return r.json()
}

/**
 * Fetches AI command-centre summary.
 * Returns null when unauthorized.
 * @returns {Promise<Object|null>}
 */
export async function fetchAssistantCommandCentre() {
  const r = await fetch(`${API_URL}/assistant/command-centre`, { headers: getAuthHeaders() })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to load AI command-centre snapshot')
  return r.json()
}

/**
 * Requests AI analysis for a specific ticket.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function analyzeAssistantTicket(payload) {
  const r = await fetch(`${API_URL}/assistant/analyze-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to analyze ticket with AI assistant')
  return r.json()
}

/**
 * Requests AI analysis for a specific alert/finding.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function analyzeAssistantAlert(payload) {
  const r = await fetch(`${API_URL}/assistant/analyze-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to analyze alert with AI assistant')
  return r.json()
}

/**
 * Runs assistant auto-tend workflow for a ticket.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function tendAssistantTicket(payload) {
  const r = await fetch(`${API_URL}/assistant/tend-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to auto-tend ticket with AI assistant')
  return r.json()
}

/**
 * Runs assistant auto-tend workflow for an alert.
 * Returns null when unauthorized.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
export async function tendAssistantAlert(payload) {
  const r = await fetch(`${API_URL}/assistant/tend-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(payload),
  })
  if (r.status === 401) return null
  if (!r.ok) await parseErrorResponse(r, 'Failed to auto-tend alert with AI assistant')
  return r.json()
}
