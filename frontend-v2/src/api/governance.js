import { request } from './client.js';

export const fetchAuditLogs = () => request('/governance/audit-logs');
export const fetchWorkforceTelemetry = () => request('/governance/workforce-telemetry');
export const fetchPerformance = () => request('/governance/performance');
export const fetchNotificationLedger = () => request('/governance/notification-ledger');
export const fetchAutomationStatus = () => request('/automation/status');
