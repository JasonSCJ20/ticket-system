import { request } from './client.js';

export function fetchTickets(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/tickets${query ? `?${query}` : ''}`);
}

export function fetchExecutiveMetrics() {
  return request('/tickets/metrics/executive');
}

export function createTicket(payload) {
  return request('/tickets', { method: 'POST', body: payload });
}

export function updateTicket(id, payload) {
  return request(`/tickets/${id}`, { method: 'PATCH', body: payload });
}

export function transitionTicket(id, stage, note) {
  return request(`/tickets/${id}/transition`, { method: 'POST', body: { stage, note } });
}

export const LIFECYCLE_STAGES = ['identified', 'triaged', 'contained', 'eradicated', 'recovered', 'postmortem', 'closed'];
export const STAGE_TO_STATUS = {
  identified: 'open',
  triaged: 'in_progress',
  contained: 'in_progress',
  eradicated: 'in_progress',
  recovered: 'resolved',
  postmortem: 'resolved',
  closed: 'closed',
};

export function fetchComments(id) {
  return request(`/tickets/${id}/comments`);
}

export function addComment(id, payload) {
  return request(`/tickets/${id}/comments`, { method: 'POST', body: payload });
}

export function fetchActionItems(id) {
  return request(`/tickets/${id}/action-items`);
}

export function addActionItem(id, payload) {
  return request(`/tickets/${id}/action-items`, { method: 'POST', body: payload });
}

export function updateActionItem(id, actionId, payload) {
  return request(`/tickets/${id}/action-items/${actionId}`, { method: 'PATCH', body: payload });
}

export function fetchHistory(id) {
  return request(`/tickets/${id}/history`);
}

export function fetchResolutionReport(id) {
  return request(`/tickets/${id}/report`);
}

export function fetchAuditLogs() {
  return request('/tickets/audit/logs');
}
