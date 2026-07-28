import { request } from './client.js';

export function fetchCommandCentre() {
  return request('/assistant/command-centre');
}

export function triage(payload) {
  return request('/assistant/triage', { method: 'POST', body: payload });
}

export function analyzeTicket(id) {
  return request(`/assistant/analyze-ticket`, { method: 'POST', body: { ticketId: id } });
}

export function tendTicket(id) {
  return request('/assistant/tend-ticket', { method: 'POST', body: { ticketId: id } });
}

export function analyzeAlert(id) {
  return request('/assistant/analyze-alert', { method: 'POST', body: { findingId: id } });
}

export function tendAlert(id) {
  return request('/assistant/tend-alert', { method: 'POST', body: { findingId: id } });
}
