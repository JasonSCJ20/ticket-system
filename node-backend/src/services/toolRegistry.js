import { DETECTION_STACK } from './findingIntelligence.js';

// ─── Fidelity / cadence metadata keyed by domain ─────────────────────────────
// fidelityLevel: 'native' = real integration, 'simulated' = heuristic, 'heartbeat-only' = no direct execution
const DOMAIN_META = {
  'network-ids':      { fidelityLevel: 'native',         cadenceMinutes: 12 },
  'network-analytics':{ fidelityLevel: 'native',         cadenceMinutes: 10 },
  'host-siem':        { fidelityLevel: 'simulated',      cadenceMinutes: 5  },
  'runtime-security': { fidelityLevel: 'simulated',      cadenceMinutes: 5  },
  'availability':     { fidelityLevel: 'heartbeat-only', cadenceMinutes: 5  },
  'exposure-scanning':{ fidelityLevel: 'simulated',      cadenceMinutes: 30 },
  'dast':             { fidelityLevel: 'simulated',      cadenceMinutes: 30 },
  'sast':             { fidelityLevel: 'simulated',      cadenceMinutes: 30 },
  'container-iac':    { fidelityLevel: 'native',         cadenceMinutes: 20 },
  'secrets':          { fidelityLevel: 'simulated',      cadenceMinutes: 30 },
  'supply-chain':     { fidelityLevel: 'simulated',      cadenceMinutes: 30 },
  'infra-vuln-scan':  { fidelityLevel: 'simulated',      cadenceMinutes: 30 },
};

const detectionAssetMap = {
  'network-ids': ['application', 'network_device'],
  'network-analytics': ['application', 'network_device'],
  'host-siem': ['application', 'database_asset'],
  'runtime-security': ['application', 'command_centre'],
  availability: ['application', 'database_asset', 'command_centre'],
  'exposure-scanning': ['application'],
  dast: ['application'],
  sast: ['application'],
  'container-iac': ['application', 'database_asset'],
  secrets: ['application'],
  'supply-chain': ['application'],
  'infra-vuln-scan': ['network_device', 'database_asset'],
};

// ─── Per-tool in-memory scheduler state ──────────────────────────────────────
const toolSchedulerState = new Map();

export function recordToolSchedulerRun(toolId, { success = true, runAt = null } = {}) {
  const now = runAt || new Date().toISOString();
  const prev = toolSchedulerState.get(String(toolId)) || { toolId, totalRuns: 0, successCount: 0, failureCount: 0, lastSuccessAt: null, lastFailureAt: null };
  const next = {
    ...prev,
    toolId: String(toolId),
    totalRuns: prev.totalRuns + 1,
    successCount: success ? prev.successCount + 1 : prev.successCount,
    failureCount: success ? prev.failureCount : prev.failureCount + 1,
    lastSuccessAt: success ? now : prev.lastSuccessAt,
    lastFailureAt: success ? prev.lastFailureAt : now,
  };
  toolSchedulerState.set(String(toolId), next);
}

export function getToolSchedulerState() {
  const out = {};
  for (const [id, state] of toolSchedulerState.entries()) {
    const reg = TOOL_REGISTRY ? TOOL_REGISTRY.find((t) => t.id === id) : null;
    out[id] = { ...state, cadenceMinutes: reg?.cadenceMinutes || null };
  }
  return out;
}

function toToolId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const OPERATIONAL_TOOL_STACK = [
  {
    id: 'patch-orchestrator',
    name: 'Ansible',
    engine: 'Ansible',
    tool: 'Patch Orchestrator',
    mode: 'active',
    domain: 'orchestration',
    capability: 'Patch orchestration and change execution across registered assets',
    openSource: true,
    fidelityLevel: 'heartbeat-only',
    cadenceMinutes: 60,
    supportedAssetTypes: ['application', 'network_device', 'database_asset', 'command_centre'],
    protectsCommandCentre: true,
  },
  {
    id: 'audit-telemetry',
    name: 'OpenSearch',
    engine: 'OpenSearch',
    tool: 'Audit Telemetry Pipeline',
    mode: 'passive',
    domain: 'telemetry',
    capability: 'Centralized event ingestion, search, and retention for audit-grade evidence',
    openSource: true,
    fidelityLevel: 'heartbeat-only',
    cadenceMinutes: 60,
    supportedAssetTypes: ['application', 'network_device', 'database_asset', 'command_centre'],
    protectsCommandCentre: true,
  },
  {
    id: 'runtime-guardian',
    name: 'Cilium Tetragon',
    engine: 'Cilium Tetragon',
    tool: 'Runtime Threat Hunting and Response',
    mode: 'passive',
    domain: 'runtime-detection',
    capability: 'Runtime process and kernel-level threat detection for workloads and the command centre',
    openSource: true,
    fidelityLevel: 'simulated',
    cadenceMinutes: 5,
    supportedAssetTypes: ['application', 'command_centre'],
    protectsCommandCentre: true,
  },
];

export const TOOL_REGISTRY = [
  ...DETECTION_STACK.map((tool) => {
    const meta = DOMAIN_META[tool.domain] || { fidelityLevel: 'simulated', cadenceMinutes: 30 };
    return {
      id: toToolId(tool.name),
      name: tool.name,
      engine: tool.name,
      tool: tool.name,
      mode: tool.mode,
      domain: tool.domain,
      capability: tool.capability,
      openSource: tool.openSource,
      fidelityLevel: meta.fidelityLevel,
      cadenceMinutes: meta.cadenceMinutes,
      supportedAssetTypes: detectionAssetMap[tool.domain] || ['application'],
      protectsCommandCentre: true,
    };
  }),
  ...OPERATIONAL_TOOL_STACK,
];

export function getToolRegistryEntryById(toolId) {
  return TOOL_REGISTRY.find((item) => item.id === String(toolId || '').trim()) || null;
}

export function getToolRegistryEntryByName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return TOOL_REGISTRY.find((item) => item.name.toLowerCase() === normalized || item.id === normalized) || null;
}

export function getRegistryToolsForAsset(assetType, options = {}) {
  const { mode } = options;
  return TOOL_REGISTRY.filter((tool) => {
    if (!tool.supportedAssetTypes.includes(assetType)) return false;
    if (mode && tool.mode !== mode) return false;
    return true;
  });
}
