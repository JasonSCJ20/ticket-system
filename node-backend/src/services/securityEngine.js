import { Op } from 'sequelize';
import crypto from 'crypto';
import {
  normalizeSeverity,
  scoreFinding,
  buildExecutiveNarrative,
} from './findingIntelligence.js';
import { recordScanRun } from './scanRunLedger.js';
import { getRegistryToolsForAsset } from './toolRegistry.js';
import { createGitleaksScanner } from './scanners/gitleaks.js';
import { createTrivyScanner } from './scanners/trivy.js';
import { createSemgrepScanner } from './scanners/semgrep.js';
import { createNucleiScanner } from './scanners/nuclei.js';
import { pushFindingEvent } from './socLiveFeed.js';

// Real self-scan target: the platform's own source tree. Configurable
// because production runs from a vendored deploy path, not necessarily this
// repo's own checkout.
const SELF_SCAN_ROOT_PATH = process.env.SELF_SCAN_ROOT_PATH || process.cwd();
const COMMAND_CENTRE_PLATFORM_APP_NAME = 'CommandCentre Platform';

export const DEFAULT_SCANNERS = {
  gitleaks: createGitleaksScanner(),
  trivy: createTrivyScanner(),
  semgrep: createSemgrepScanner(),
  nuclei: createNucleiScanner(),
};

// Categories carried over unchanged from the old canned-pattern list so
// existing dashboard category filters/groupings don't shift under real data.
const TOOL_CATEGORY = {
  Gitleaks: 'secrets',
  Trivy: 'vulnerability',
  Semgrep: 'application',
  Nuclei: 'vulnerability',
};

// Tools this platform can genuinely run itself today. Everything else in
// the registry (OWASP ZAP, Dependency-Track, and every passive-domain tool:
// Suricata/Zeek/Wazuh/Falco/Prometheus) has no real execution path yet —
// runSecuritySweep records those as "skipped" with an honest reason rather
// than fabricating a finding for them. Real integrations (Wazuh/Suricata/
// Prometheus) still work fully via their own inbound connectors in
// securityConnectors.js; this list is only about what THIS sweep can run.
const SELF_SCAN_HANDLERS = {
  async Gitleaks(scanners, sourcePath) {
    const leaks = await scanners.gitleaks.scan(sourcePath);
    return leaks.map((leak) => ({
      externalEventId: leak.fingerprint,
      severity: 'critical',
      title: `Leaked credential detected: ${leak.ruleId} in ${leak.file}`,
      description: `Gitleaks matched rule "${leak.ruleId}" at ${leak.file}:${leak.line}. Rotate this credential immediately if it is real — the matched secret value itself is never included in this finding.`,
      evidence: JSON.stringify(leak),
    }));
  },
  async Trivy(scanners, sourcePath) {
    const vulns = await scanners.trivy.scan(sourcePath);
    return vulns.map((vuln) => ({
      externalEventId: `${vuln.package}@${vuln.installedVersion}:${vuln.cveId}`,
      severity: vuln.severity,
      title: `${vuln.cveId}: ${vuln.title}`,
      description: `${vuln.package}@${vuln.installedVersion} in ${vuln.target} is affected by ${vuln.cveId}.${vuln.fixedVersion ? ` Fixed in ${vuln.fixedVersion}.` : ' No fix currently available.'}`,
      evidence: JSON.stringify(vuln),
      cveId: vuln.cveId,
      // Carried through (not just embedded in description/evidence text) so
      // runSelfScans can turn a real fix-available CVE straight into a
      // PatchTask instead of that data dead-ending as descriptive text.
      package: vuln.package,
      installedVersion: vuln.installedVersion,
      fixedVersion: vuln.fixedVersion,
    }));
  },
  async Semgrep(scanners, sourcePath) {
    const hits = await scanners.semgrep.scan(sourcePath);
    return hits.map((hit) => ({
      externalEventId: `${hit.ruleId}:${hit.file}:${hit.line}`,
      severity: hit.severity,
      title: `${hit.ruleId} in ${hit.file}`,
      description: `${hit.message} (${hit.file}:${hit.line})`,
      evidence: JSON.stringify(hit),
      cweId: hit.cweId,
    }));
  },
};

// enabled: false is deliberate — this is a bookkeeping row for self-scan
// findings, not a monitored customer asset. It must stay excluded from the
// `enabled: true` application list runSecuritySweep iterates below, or it
// would also receive a pointless Nuclei scan against its placeholder URL.
async function resolveCommandCentrePlatformAsset(ApplicationAsset) {
  const [app] = await ApplicationAsset.findOrCreate({
    where: { name: COMMAND_CENTRE_PLATFORM_APP_NAME },
    defaults: {
      baseUrl: 'https://soc-api.scratchsolidsolutions.org/api/healthz',
      environment: 'production',
      enabled: false,
      healthStatus: 'unknown',
    },
  });
  return app;
}

function healthFromSeverities(findingSeverities) {
  if (findingSeverities.includes('critical')) return 'critical';
  if (findingSeverities.includes('high') || findingSeverities.includes('medium')) return 'degraded';
  return 'healthy';
}

// The health badge shown for an asset must reflect what's actually true
// right now, not just whatever the most recently ingested finding happened
// to be — the previous version set healthStatus to a single new finding's
// severity, which meant an asset could show "degraded" indefinitely from a
// finding that had since been remediated or dismissed, while a genuinely
// still-open critical issue from further back went unrepresented. This
// queries every currently-open finding for the asset and derives health
// from that real, complete picture, called after any create OR any status
// change (remediate/dismiss/reopen) — anywhere a finding's open/closed
// state changes, this needs to run again.
export async function recomputeAssetHealth(applicationAssetId, { ApplicationAsset, SecurityFinding }) {
  const openFindings = await SecurityFinding.findAll({
    where: { applicationAssetId, status: { [Op.in]: ['new', 'investigating'] } },
    attributes: ['severity'],
    raw: true,
  });
  const health = healthFromSeverities(openFindings.map((f) => f.severity));
  await ApplicationAsset.update({ healthStatus: health }, { where: { id: applicationAssetId } });
  return health;
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
  const { Ticket, TicketHistory, TicketAsset } = models;
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

  await TicketAsset.create({
    ticketId: ticket.id,
    assetType: 'application',
    assetId: app.id,
    assetName: app.name,
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
    lastPassiveScanAt: detectionMode === 'passive' ? new Date() : app.lastPassiveScanAt,
    lastActiveScanAt: detectionMode === 'active' ? new Date() : app.lastActiveScanAt,
  });
  await recomputeAssetHealth(app.id, { ApplicationAsset, SecurityFinding });

  if (!manualRequired) {
    await autoCreateTicketForFinding({ finding, app, models, notifyTicket });
  }

  // Real live-feed activity, not fabricated — see socLiveFeed.js.
  pushFindingEvent(finding);

  return { finding, created: true };
}

// Turns a genuinely-new Trivy finding with a real fix available into a
// PatchTask automatically, instead of that installedVersion/fixedVersion
// data dead-ending as descriptive text inside SecurityFinding.description.
// Guarded against duplicates on repeat scans (same asset + title), and a
// no-op if PatchTask wasn't threaded into this call's models (older
// callers/tests that don't care about patch tasks shouldn't break).
async function autoCreatePatchTaskFromTrivyFinding({ models, app, raw }) {
  const { PatchTask } = models;
  if (!PatchTask || !raw.fixedVersion) return null;

  const title = `Update to fix: ${raw.title || raw.package}`;

  const existingTask = await PatchTask.findOne({
    where: {
      assetType: 'application',
      assetId: app.id,
      title,
    },
  });
  if (existingTask) return existingTask;

  return PatchTask.create({
    assetType: 'application',
    assetId: app.id,
    assetName: app.name,
    title,
    description: `Trivy detected ${raw.package}@${raw.installedVersion} is affected by ${raw.cveId || 'a known vulnerability'}. Fix available in ${raw.fixedVersion}.`,
    severity: normalizeSeverity(raw.severity),
    currentVersion: raw.installedVersion || null,
    targetVersion: raw.fixedVersion,
    status: 'todo',
    autoDetected: true,
    createdBy: 'Trivy (automatic)',
  });
}

async function recordSkippedToolRun({ ScanRunRecord, AuditLog, tool, mode, actor, assetType, assetId, assetName, assetRef, reason }) {
  await recordScanRun({
    ScanRunRecord,
    AuditLog,
    toolId: tool.id,
    toolName: tool.name,
    engine: tool.engine,
    mode,
    status: 'skipped',
    triggerSource: actor === 'scheduler' ? 'scheduler' : 'manual',
    actor,
    actorRole: actor === 'scheduler' ? 'system' : null,
    assetType,
    assetId,
    assetName,
    assetRef,
    findings: [],
    newFindingsCount: 0,
    detail: reason,
    startedAt: new Date(),
    completedAt: new Date(),
    metadata: { capability: tool.capability, domain: tool.domain },
  });
}

// Runs the self-scan tools (Gitleaks/Trivy/Semgrep) ONCE per sweep, against
// the platform's own source tree — these aren't scoped to any one
// registered ApplicationAsset, so they don't belong in the per-app loop
// below. Findings land against a dedicated "CommandCentre Platform"
// pseudo-asset, consistent with the tool registry's existing
// `protectsCommandCentre` flag on every entry.
async function runSelfScans({ models, notifyTicket, actor, scanners, tools }) {
  const { ApplicationAsset, ScanRunRecord, AuditLog } = models;
  const platformApp = await resolveCommandCentrePlatformAsset(ApplicationAsset);
  const createdFindings = [];

  for (const tool of tools) {
    const handler = SELF_SCAN_HANDLERS[tool.name];
    const startedAt = new Date();
    if (!handler) {
      await recordSkippedToolRun({
        ScanRunRecord, AuditLog, tool, mode: 'active', actor,
        assetType: 'command_centre', assetId: platformApp.id, assetName: platformApp.name, assetRef: SELF_SCAN_ROOT_PATH,
        reason: `${tool.name} has no real execution path yet on this platform — no synthetic finding generated.`,
      });
      continue;
    }

    try {
      const rawFindings = await handler(scanners, SELF_SCAN_ROOT_PATH);
      const toolFindings = [];
      for (const raw of rawFindings) {
        const { finding, created } = await ingestFinding({
          models,
          notifyTicket,
          sourceTool: tool.name,
          detectionMode: 'active',
          category: TOOL_CATEGORY[tool.name] || 'application',
          severity: raw.severity,
          title: raw.title,
          description: raw.description,
          evidence: raw.evidence,
          externalEventId: raw.externalEventId,
          cveId: raw.cveId,
          cweId: raw.cweId,
          appName: platformApp.name,
          appUrl: platformApp.baseUrl,
          affectedAssetType: 'command_centre',
          affectedAssetRef: SELF_SCAN_ROOT_PATH,
        });
        if (created) {
          toolFindings.push(finding);
          createdFindings.push(finding);

          // Only for a genuinely new finding (not a repeat-scan dedup
          // update) and only for Trivy, since that's the scanner that
          // reports a real fixedVersion — Gitleaks/Semgrep hits don't map
          // to a version bump the way a dependency CVE does.
          if (tool.name === 'Trivy') {
            await autoCreatePatchTaskFromTrivyFinding({ models, app: platformApp, raw });
          }
        }
      }

      await recordScanRun({
        ScanRunRecord, AuditLog,
        toolId: tool.id, toolName: tool.name, engine: tool.engine, mode: 'active',
        status: 'completed',
        triggerSource: actor === 'scheduler' ? 'scheduler' : 'manual',
        actor, actorRole: actor === 'scheduler' ? 'system' : null,
        assetType: 'command_centre', assetId: platformApp.id, assetName: platformApp.name, assetRef: SELF_SCAN_ROOT_PATH,
        findings: toolFindings, newFindingsCount: toolFindings.length,
        detail: toolFindings.length
          ? `${tool.name} found ${toolFindings.length} real issue(s) scanning the platform's own source tree.`
          : `${tool.name} completed a real scan of the platform's own source tree with no findings.`,
        startedAt, completedAt: new Date(),
        metadata: { capability: tool.capability, domain: tool.domain },
      });
    } catch (err) {
      await recordScanRun({
        ScanRunRecord, AuditLog,
        toolId: tool.id, toolName: tool.name, engine: tool.engine, mode: 'active',
        status: 'failed',
        triggerSource: actor === 'scheduler' ? 'scheduler' : 'manual',
        actor, actorRole: actor === 'scheduler' ? 'system' : null,
        assetType: 'command_centre', assetId: platformApp.id, assetName: platformApp.name, assetRef: SELF_SCAN_ROOT_PATH,
        findings: [], newFindingsCount: 0,
        detail: `${tool.name} failed while scanning the platform's own source tree: ${String(err?.message || err || 'Unknown error')}`,
        startedAt, completedAt: new Date(),
        metadata: { capability: tool.capability, domain: tool.domain },
      });
    }
  }

  return createdFindings;
}

export async function runSecuritySweep({ mode, actor = 'system', models, notifyTicket, scanners = DEFAULT_SCANNERS }) {
  const { ApplicationAsset, ScanRunRecord, AuditLog } = models;
  const applications = await ApplicationAsset.findAll({ where: { enabled: true } });
  const applicationTools = getRegistryToolsForAsset('application', { mode });

  const createdFindings = [];

  // Passive-domain tools (Suricata/Zeek/Wazuh/Falco/Prometheus) have no
  // real execution path here at all — their real signal comes entirely
  // from their own inbound connectors in securityConnectors.js, which are
  // unaffected by this. This sweep no longer fabricates passive findings.
  if (mode === 'passive') {
    for (const app of applications) {
      for (const tool of applicationTools) {
        await recordSkippedToolRun({
          ScanRunRecord, AuditLog, tool, mode, actor,
          assetType: 'application', assetId: app.id, assetName: app.name, assetRef: app.baseUrl,
          reason: `${tool.name} is a passive-domain tool — real signal only arrives via its own inbound connector, never generated by this sweep.`,
        });
      }
    }
    return createdFindings;
  }

  // Active mode: self-scan tools run once (see runSelfScans), then each
  // application asset with a live URL gets a real Nuclei scan. Any other
  // active-domain tool without a real handler (OWASP ZAP, Dependency-Track)
  // is recorded as skipped rather than faked.
  const selfScanTools = applicationTools.filter((t) => t.name in SELF_SCAN_HANDLERS);
  createdFindings.push(...await runSelfScans({ models, notifyTicket, actor, scanners, tools: selfScanTools }));

  const nucleiTool = applicationTools.find((t) => t.name === 'Nuclei');
  const otherTools = applicationTools.filter((t) => !(t.name in SELF_SCAN_HANDLERS) && t.name !== 'Nuclei');

  for (const app of applications) {
    const scanStartedAt = new Date();

    if (nucleiTool) {
      const startedAt = new Date();
      if (!app.baseUrl) {
        await recordSkippedToolRun({
          ScanRunRecord, AuditLog, tool: nucleiTool, mode, actor,
          assetType: 'application', assetId: app.id, assetName: app.name, assetRef: app.baseUrl,
          reason: `${app.name} has no live URL to scan (IP-only asset) — Nuclei needs an HTTP(S) target.`,
        });
      } else {
        try {
          const hits = await scanners.nuclei.scan(app.baseUrl);
          const toolFindings = [];
          for (const hit of hits) {
            const { finding, created } = await ingestFinding({
              models,
              notifyTicket,
              sourceTool: 'Nuclei',
              detectionMode: 'active',
              category: TOOL_CATEGORY.Nuclei,
              severity: hit.severity,
              title: `${app.name}: ${hit.name || hit.templateId}`,
              description: hit.description || `Active scan template ${hit.templateId} matched at ${hit.matchedAt}.`,
              evidence: JSON.stringify(hit),
              externalEventId: `${app.id}:${hit.templateId}:${hit.matchedAt}`,
              appName: app.name,
              appUrl: app.baseUrl,
            });
            if (created) {
              toolFindings.push(finding);
              createdFindings.push(finding);
            }
          }

          await recordScanRun({
            ScanRunRecord, AuditLog,
            toolId: nucleiTool.id, toolName: 'Nuclei', engine: nucleiTool.engine, mode,
            status: 'completed',
            triggerSource: actor === 'scheduler' ? 'scheduler' : 'manual',
            actor, actorRole: actor === 'scheduler' ? 'system' : null,
            assetType: 'application', assetId: app.id, assetName: app.name, assetRef: app.baseUrl,
            findings: toolFindings, newFindingsCount: toolFindings.length,
            detail: toolFindings.length
              ? `Nuclei found ${toolFindings.length} real issue(s) on ${app.name}.`
              : `Nuclei completed a real active scan of ${app.name} with no findings.`,
            startedAt, completedAt: new Date(),
            metadata: { capability: nucleiTool.capability, domain: nucleiTool.domain, environment: app.environment },
          });
        } catch (err) {
          await recordScanRun({
            ScanRunRecord, AuditLog,
            toolId: nucleiTool.id, toolName: 'Nuclei', engine: nucleiTool.engine, mode,
            status: 'failed',
            triggerSource: actor === 'scheduler' ? 'scheduler' : 'manual',
            actor, actorRole: actor === 'scheduler' ? 'system' : null,
            assetType: 'application', assetId: app.id, assetName: app.name, assetRef: app.baseUrl,
            findings: [], newFindingsCount: 0,
            detail: `Nuclei failed while scanning ${app.name}: ${String(err?.message || err || 'Unknown error')}`,
            startedAt, completedAt: new Date(),
            metadata: { capability: nucleiTool.capability, domain: nucleiTool.domain, environment: app.environment },
          });
        }
      }
    }

    for (const tool of otherTools) {
      await recordSkippedToolRun({
        ScanRunRecord, AuditLog, tool, mode, actor,
        assetType: 'application', assetId: app.id, assetName: app.name, assetRef: app.baseUrl,
        reason: `${tool.name} has no real execution path yet on this platform — no synthetic finding generated.`,
      });
    }

    await app.update(mode === 'active'
      ? { lastActiveScanAt: scanStartedAt }
      : { lastPassiveScanAt: scanStartedAt });
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
