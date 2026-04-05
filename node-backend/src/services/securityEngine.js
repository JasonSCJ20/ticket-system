import { Op } from 'sequelize';
import crypto from 'crypto';
import {
  normalizeSeverity,
  scoreFinding,
  buildExecutiveNarrative,
} from './findingIntelligence.js';

const PASSIVE_PATTERNS = [
  {
    sourceTool: 'Suricata',
    category: 'intrusion',
    severity: 'high',
    title: 'Suspicious inbound signature detected',
    description: 'IDS signature matched suspicious payload from untrusted source.',
  },
  {
    sourceTool: 'Prometheus',
    category: 'availability',
    severity: 'medium',
    title: 'Health endpoint latency spike',
    description: 'Application health-check latency exceeded baseline threshold.',
  },
  {
    sourceTool: 'Wazuh',
    category: 'vulnerability',
    severity: 'critical',
    title: 'Known exploitable package detected',
    description: 'Vulnerability scan detected package with known remote code execution risk.',
  },
  {
    sourceTool: 'Falco',
    category: 'runtime',
    severity: 'high',
    title: 'Unexpected privileged container execution',
    description: 'Runtime detection observed abnormal privileged process behavior.',
  },
  {
    sourceTool: 'Zeek',
    category: 'network',
    severity: 'medium',
    title: 'Anomalous protocol behavior detected',
    description: 'Behavioral network analytics flagged uncommon protocol sequencing.',
  },
];

const ACTIVE_PATTERNS = [
  {
    sourceTool: 'Nuclei',
    category: 'vulnerability',
    severity: 'high',
    title: 'Potential exposed admin endpoint',
    description: 'Active scan found publicly reachable management endpoint.',
  },
  {
    sourceTool: 'OWASP ZAP',
    category: 'application',
    severity: 'medium',
    title: 'Reflected input without strict sanitization',
    description: 'Active probe indicates a potential reflected injection vector.',
  },
  {
    sourceTool: 'Zeek',
    category: 'network',
    severity: 'low',
    title: 'Unusual outbound DNS activity',
    description: 'Network telemetry detected atypical DNS query pattern.',
  },
  {
    sourceTool: 'Semgrep',
    category: 'application',
    severity: 'medium',
    title: 'Insecure code pattern identified',
    description: 'Static analysis discovered a code path vulnerable to injection abuse.',
  },
  {
    sourceTool: 'Trivy',
    category: 'vulnerability',
    severity: 'high',
    title: 'Critical dependency CVE exposure detected',
    description: 'Dependency and container scan found exploitable CVE in shipped artifact.',
  },
  {
    sourceTool: 'Gitleaks',
    category: 'secrets',
    severity: 'critical',
    title: 'Exposed credential material found',
    description: 'Secret scanning detected a leaked token or credential in code history.',
  },
  {
    sourceTool: 'OpenVAS',
    category: 'vulnerability',
    severity: 'high',
    title: 'Externally reachable service vulnerability',
    description: 'Infrastructure scanner reported remotely exploitable network service weakness.',
  },
];

function randomPattern(mode) {
  const pool = mode === 'active' ? ACTIVE_PATTERNS : PASSIVE_PATTERNS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shouldGenerateFinding(mode) {
  const chance = mode === 'active' ? 0.75 : 0.55;
  return Math.random() < chance;
}

function healthFromFindings(findingSeverities) {
  if (findingSeverities.includes('critical')) return 'critical';
  if (findingSeverities.includes('high') || findingSeverities.includes('medium')) return 'degraded';
  return 'healthy';
}

function computeFingerprint(payload) {
  const basis = [
    payload.sourceTool,
    payload.externalEventId || '',
    payload.applicationAssetId,
    payload.category,
    payload.severity,
    payload.title,
  ].join('|');
  return crypto.createHash('sha256').update(basis).digest('hex');
}

async function resolveApplication({ ApplicationAsset, appName, appUrl, environment = 'production' }) {
  if (appName) {
    const byName = await ApplicationAsset.findOne({ where: { name: appName } });
    if (byName) return byName;
  }

  if (appUrl) {
    const byUrl = await ApplicationAsset.findOne({ where: { baseUrl: appUrl } });
    if (byUrl) return byUrl;
  }

  const normalizedName = appName || `App-${Date.now()}`;
  const normalizedUrl = appUrl || `https://unmapped.local/${normalizedName.toLowerCase()}`;
  return ApplicationAsset.create({
    name: normalizedName,
    baseUrl: normalizedUrl,
    environment,
    enabled: true,
    healthStatus: 'unknown',
  });
}

async function autoCreateTicketForFinding({ finding, app, models, notifyTicket }) {
  const { Ticket, TicketHistory } = models;
  const priority = finding.severity === 'critical'
    ? 'critical'
    : finding.severity === 'high'
      ? 'high'
      : 'medium';

  const ticket = await Ticket.create({
    title: `[SECURITY][${finding.severity.toUpperCase()}] ${app.name}`,
    description: `${finding.title}\n${finding.description}\nSource: ${finding.sourceTool}\nMode: ${finding.detectionMode}\nFinding ID: ${finding.id}`,
    priority,
    status: 'open',
    assigneeId: null,
  });

  await TicketHistory.create({
    ticketId: ticket.id,
    eventType: 'created',
    reason: `Auto-created from finding ${finding.id}`,
  });

  await finding.update({ ticketId: ticket.id, autoTicketCreated: true, status: 'investigating' });
  await notifyTicket(ticket, 'created');
}

export async function ingestFinding({
  models,
  notifyTicket,
  sourceTool,
  detectionMode,
  category,
  severity,
  title,
  description,
  evidence,
  appName,
  appUrl,
  environment,
  externalEventId,
  rawPayload,
  requiresManualConfirmation,
  cveId,
  cweId,
  mitreTechnique,
  confidenceScore,
  likelihoodScore,
  impactScore,
  affectedAssetType,
  affectedAssetRef,
  detectedAt,
}) {
  const { ApplicationAsset, SecurityFinding } = models;
  const app = await resolveApplication({ ApplicationAsset, appName, appUrl, environment });
  const normalizedSeverity = normalizeSeverity(severity);
  const scored = scoreFinding({
    severity: normalizedSeverity,
    confidenceScore,
    likelihoodScore,
    impactScore,
    assetCriticality: app.environment === 'production' ? 'critical' : 'high',
  });

  const narrative = buildExecutiveNarrative({
    title,
    sourceTool,
    category,
    riskScore: scored.riskScore,
    postureBand: scored.postureBand,
    applicationName: app.name,
  });

  const manualRequired = typeof requiresManualConfirmation === 'boolean'
    ? requiresManualConfirmation
    : !['critical', 'high'].includes(normalizedSeverity);

  const fingerprint = computeFingerprint({
    sourceTool,
    externalEventId,
    applicationAssetId: app.id,
    category,
    severity: normalizedSeverity,
    title,
  });

  const existing = await SecurityFinding.findOne({ where: { fingerprint } });
  if (existing) {
    await existing.update({
      lastSeenAt: new Date(),
      evidence: evidence || existing.evidence,
      rawPayload: rawPayload ? JSON.stringify(rawPayload).slice(0, 10000) : existing.rawPayload,
    });
    return { finding: existing, created: false };
  }

  const finding = await SecurityFinding.create({
    applicationAssetId: app.id,
    sourceTool,
    externalEventId: externalEventId || null,
    fingerprint,
    detectionMode,
    category,
    severity: normalizedSeverity,
    confidenceScore: scored.confidenceScore,
    likelihoodScore: scored.likelihoodScore,
    impactScore: scored.impactScore,
    riskScore: scored.riskScore,
    riskBand: scored.postureBand,
    cveId: cveId || null,
    cweId: cweId || null,
    mitreTechnique: mitreTechnique || null,
    affectedAssetType: affectedAssetType || 'application',
    affectedAssetRef: affectedAssetRef || app.baseUrl,
    detectedAt: detectedAt || new Date(),
    title,
    description,
    executiveSummary: narrative.plainLanguage,
    businessImpact: narrative.businessImpact,
    remediationRecommendation: narrative.recommendedAction,
    evidence: evidence || null,
    rawPayload: rawPayload ? JSON.stringify(rawPayload).slice(0, 10000) : null,
    requiresManualConfirmation: manualRequired,
    autoTicketCreated: false,
  });

  await app.update({
    healthStatus: healthFromFindings([normalizedSeverity]),
    lastPassiveScanAt: detectionMode === 'passive' ? new Date() : app.lastPassiveScanAt,
    lastActiveScanAt: detectionMode === 'active' ? new Date() : app.lastActiveScanAt,
  });

  if (!manualRequired) {
    await autoCreateTicketForFinding({ finding, app, models, notifyTicket });
  }

  return { finding, created: true };
}

export async function runSecuritySweep({ mode, actor = 'system', models, notifyTicket }) {
  const { ApplicationAsset } = models;
  const applications = await ApplicationAsset.findAll({ where: { enabled: true } });

  const createdFindings = [];

  for (const app of applications) {
    if (shouldGenerateFinding(mode)) {
      const pattern = randomPattern(mode);
      const { finding, created } = await ingestFinding({
        models,
        notifyTicket,
        sourceTool: pattern.sourceTool,
        detectionMode: mode,
        category: pattern.category,
        severity: pattern.severity,
        title: `${app.name}: ${pattern.title}`,
        description: `${pattern.description} (Target: ${app.baseUrl})`,
        evidence: `tool=${pattern.sourceTool}; mode=${mode}; app=${app.name}`,
        appName: app.name,
        appUrl: app.baseUrl,
      });
      if (created) createdFindings.push(finding);
    }
  }

  return createdFindings;
}

export async function healthSummary(models) {
  const { ApplicationAsset, SecurityFinding } = models;

  const applications = await ApplicationAsset.findAll();
  const findings = await SecurityFinding.findAll({ where: { status: { [Op.in]: ['new', 'investigating'] } } });

  const bySeverity = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
  };

  const overall = bySeverity.critical > 0 ? 'critical'
    : bySeverity.high > 0 ? 'degraded'
      : 'healthy';

  return {
    overall,
    applications: applications.length,
    activeFindings: findings.length,
    bySeverity,
    lastUpdatedAt: new Date().toISOString(),
  };
}
