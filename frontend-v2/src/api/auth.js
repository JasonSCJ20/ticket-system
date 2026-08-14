import { request, setToken, clearToken, downloadFile } from './client.js';

export async function login(username, password, mfaCode = '') {
  const normalizedUsername = String(username || '').trim();
  const data = await request('/token', {
    method: 'POST',
    skipAuthRedirect: true,
    body: { username: normalizedUsername, password, ...(mfaCode ? { mfaCode } : {}) },
  }).catch((err) => {
    // Only the "MFA code needed" 401 is a normal response to hand back to the
    // form — any other 401 (bad credentials, disabled account) is a real
    // error and must propagate so the caller shows it instead of silently
    // treating a failed login as success.
    if (err.status === 401 && err.body?.mfaRequired) return err.body;
    throw err;
  });

  if (data.mfaRequired) return { mfaRequired: true };
  if (data.access_token) setToken(data.access_token);
  return data;
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
}

export function fetchMfaSetup() {
  return request('/auth/mfa/setup');
}

export function enableMfa(code) {
  return request('/auth/mfa/enable', { method: 'POST', body: { code } });
}

export function disableMfa(code) {
  return request('/auth/mfa/disable', { method: 'POST', body: { code } });
}

export function forgotUsername(email) {
  return request('/auth/forgot-username', { method: 'POST', skipAuthRedirect: true, body: { email } });
}

export function requestPasswordReset(email) {
  return request('/auth/forgot-password/request', { method: 'POST', skipAuthRedirect: true, body: { email } });
}

export function resetPassword(email, resetCode, newPassword) {
  return request('/auth/forgot-password/reset', {
    method: 'POST',
    skipAuthRedirect: true,
    body: { email, resetCode, newPassword },
  });
}

export function fetchSsoConfig() {
  return request('/auth/sso/config');
}

export function fetchMe() {
  return request('/me');
}

export function sendHeartbeat() {
  return request('/heartbeat', { method: 'POST' });
}

export function updateProfile(payload) {
  return request('/me/profile', { method: 'PATCH', body: payload });
}

export const exportMyData = () => downloadFile('/me/export', 'commandcentre-my-data.json');

export function deleteMyAccount(currentPassword) {
  return request('/me', { method: 'DELETE', body: { currentPassword } });
}
