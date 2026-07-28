import { request } from './client.js';

// Health & executive summaries
export const fetchHealthSummary = () => request('/security/health-summary');
export const fetchExecutiveImpact = () => request('/security/executive-impact');
export const fetchDetectionStack = () => request('/security/detection/stack');
export const fetchThreatIntelOverview = () => request('/security/threat-intel/overview');
export const fetchNetworkVisibilityOverview = () => request('/security/network-visibility/overview');

// Applications
export const fetchApplications = () => request('/security/applications');
export const createApplication = (payload) => request('/security/applications', { method: 'POST', body: payload });

// Network devices
export const fetchNetworkDevices = () => request('/security/network/devices');
export const createNetworkDevice = (payload) => request('/security/network/devices', { method: 'POST', body: payload });
export const runPassiveScan = (id) => request(`/security/network/devices/${id}/passive-scan`, { method: 'POST' });
export const runIdsIpsCheck = (id) => request(`/security/network/devices/${id}/ids-ips-check`, { method: 'POST' });

// Database assets
export const fetchDatabaseAssets = () => request('/security/database/assets');
export const createDatabaseAsset = (payload) => request('/security/database/assets', { method: 'POST', body: payload });
export const runDatabaseSecurityScan = (id) => request(`/security/database/assets/${id}/security-scan`, { method: 'POST' });
export const fetchDatabaseOverview = () => request('/security/database/overview');

// Patch tasks
export const fetchPatches = () => request('/security/patches');
export const createPatch = (payload) => request('/security/patches', { method: 'POST', body: payload });
export const updatePatchStatus = (id, status, notes) => request(`/security/patches/${id}/status`, { method: 'PATCH', body: { status, notes } });

// Scans
export const runScanPassive = () => request('/security/scan/passive', { method: 'POST' });
export const runScanActive = () => request('/security/scan/active', { method: 'POST' });
export const fetchScanJob = (jobId) => request(`/security/scan/jobs/${jobId}`);
export const fetchScanJobs = (mode) => request(`/security/scan/jobs${mode ? `?mode=${mode}` : ''}`);
export const fetchScanRuns = () => request('/security/scan/runs');
export const runScanTool = (tool) => request(`/security/scan/tool/${tool}`, { method: 'POST' });

// Findings
export const fetchFindings = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/security/findings${query ? `?${query}` : ''}`);
};
export const fetchFindingBrief = (id) => request(`/security/findings/${id}/brief`);
export const confirmFinding = (id) => request(`/security/findings/${id}/confirm`, { method: 'POST' });
export const updateFindingStatus = (id, status, reason) => request(`/security/findings/${id}/status`, { method: 'PATCH', body: { status, reason } });
export const createTicketFromFinding = (id) => request(`/security/findings/${id}/create-ticket`, { method: 'POST' });

// SOC live feed
export const fetchLiveFeed = () => request('/security/soc/live-feed');
export const fetchThreatOrigins = () => request('/security/soc/threat-origins');
export const fetchReconDetections = () => request('/security/soc/recon-detections');
export const fetchSchedulerState = () => request('/security/soc/scheduler-state');

// Fortress
export const fetchFortressPosture = () => request('/security/fortress/posture');
export const sendToolingHeartbeat = (payload) => request('/security/fortress/tooling/heartbeat', { method: 'POST', body: payload });
export const runRecoveryDrill = () => request('/security/fortress/recovery-drill', { method: 'POST' });

// Dead letters (failed connector ingestions)
export const fetchDeadLetters = () => request('/security/dead-letters');
export const retryDeadLetter = (id) => request(`/security/dead-letters/${id}/retry`, { method: 'POST' });
export const discardDeadLetter = (id) => request(`/security/dead-letters/${id}/discard`, { method: 'POST' });
