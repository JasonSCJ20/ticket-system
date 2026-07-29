import { request } from './client.js';

const base = (id) => `/security/applications/${id}`;

export const issueAgentKey = (id) => request(`${base(id)}/agent-key`, { method: 'POST' });
export const setEdgeCredential = (id, token, meta) =>
  request(`${base(id)}/edge-credential`, { method: 'POST', body: { token, meta } });
export const startVerification = (id) => request(`${base(id)}/verify`, { method: 'POST' });
export const pollVerification = (id, nonce) => request(`${base(id)}/verify/${nonce}`);
export const setEnforcementMode = (id, mode) => request(`${base(id)}/mode`, { method: 'PATCH', body: { mode } });
export const fetchEnforcementStatus = (id) => request(`${base(id)}/enforcement-status`);
export const queueAgentCommand = (id, action, target, reason) =>
  request(`${base(id)}/commands`, { method: 'POST', body: { action, target, reason } });
export const issueSentinelKey = (id) => request(`${base(id)}/sentinel-key`, { method: 'POST' });
export const setSentinelMode = (id, mode) => request(`${base(id)}/sentinel-mode`, { method: 'PATCH', body: { mode } });
