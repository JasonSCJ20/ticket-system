import { request } from './client.js';

export const fetchKillSwitchStatus = () => request('/security/fortress/kill-switch/status');

export const revokeAllSessions = (reason) =>
  request('/security/fortress/kill-switch/revoke-sessions', { method: 'POST', body: { reason } });

export const blockIp = (ip, reason) =>
  request('/security/fortress/kill-switch/block-ip', { method: 'POST', body: { ip, reason } });

export const unblockIp = (ip) =>
  request('/security/fortress/kill-switch/unblock-ip', { method: 'POST', body: { ip } });

export const setLockdown = (active, reason) =>
  request('/security/fortress/kill-switch/lockdown', { method: 'POST', body: { active, reason } });
