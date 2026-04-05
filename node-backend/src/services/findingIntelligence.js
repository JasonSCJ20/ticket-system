const SEVERITY_BASE = {
  critical: 92,
  high: 74,
  medium: 48,
  low: 22,
};

export const DETECTION_STACK = [
  { name: 'Suricata', domain: 'network-ids', mode: 'passive', openSource: true, capability: 'Signature and anomaly detection for network threats' },
  { name: 'Zeek', domain: 'network-analytics', mode: 'passive', openSource: true, capability: 'Protocol metadata and behavioral anomaly detection' },
  { name: 'Wazuh', domain: 'host-siem', mode: 'passive', openSource: true, capability: 'Endpoint and host telemetry with compliance detections' },
  { name: 'Falco', domain: 'runtime-security', mode: 'passive', openSource: true, capability: 'Container and workload runtime intrusion detection' },
  { name: 'Prometheus', domain: 'availability', mode: 'passive', openSource: true, capability: 'Operational signals that indicate attack side-effects' },
  { name: 'Nuclei', domain: 'exposure-scanning', mode: 'active', openSource: true, capability: 'Fast template-based vulnerability and misconfiguration discovery' },
  { name: 'OWASP ZAP', domain: 'dast', mode: 'active', openSource: true, capability: 'Web application dynamic security testing' },
  { name: 'Semgrep', domain: 'sast', mode: 'active', openSource: true, capability: 'Static code analysis for insecure code patterns' },
  { name: 'Trivy', domain: 'container-iac', mode: 'active', openSource: true, capability: 'Container, SBOM, and IaC vulnerability scanning' },
  { name: 'Gitleaks', domain: 'secrets', mode: 'active', openSource: true, capability: 'Leaked secret and credential detection in repositories' },
  { name: 'Dependency-Track', domain: 'supply-chain', mode: 'active', openSource: true, capability: 'SBOM risk tracking and vulnerable component monitoring' },
  { name: 'OpenVAS', domain: 'infra-vuln-scan', mode: 'active', openSource: true, capability: 'Infrastructure vulnerability scanning for network assets' },
];

export function normalizeSeverity(raw) {
  const val = String(raw || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SEVERITY_BASE, val)) return val;

  const n = Number(raw);
  if (!Number.isNaN(n)) {
    if (n >= 13) return 'critical';
    if (n >= 10) return 'high';
    if (n >= 7) return 'medium';
    return 'low';
  }

  return 'medium';
}

export function scoreFinding({ severity, confidenceScore, likelihoodScore, impactScore, assetCriticality = 'high' }) {
  const normalizedSeverity = normalizeSeverity(severity);
  const base = SEVERITY_BASE[normalizedSeverity] || SEVERITY_BASE.medium;

  const confidence = Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : 70;
  const likelihood = Number.isFinite(Number(likelihoodScore)) ? Number(likelihoodScore) : 65;
  const impact = Number.isFinite(Number(impactScore)) ? Number(impactScore) : 70;

  const criticalityWeight = assetCriticality === 'critical'
    ? 1.2
    : assetCriticality === 'high'
      ? 1.05
      : assetCriticality === 'medium'
        ? 0.95
        : 0.85;

  const weighted = (
    (base * 0.40)
    + (confidence * 0.20)
    + (likelihood * 0.20)
    + (impact * 0.20)
  ) * criticalityWeight;

  const riskScore = Math.max(1, Math.min(100, Math.round(weighted)));

  const postureBand = riskScore >= 85
    ? 'critical'
    : riskScore >= 70
      ? 'high'
      : riskScore >= 45
        ? 'medium'
        : 'low';

  return {
    normalizedSeverity,
    confidenceScore: Math.max(1, Math.min(100, Math.round(confidence))),
    likelihoodScore: Math.max(1, Math.min(100, Math.round(likelihood))),
    impactScore: Math.max(1, Math.min(100, Math.round(impact))),
    riskScore,
    postureBand,
  };
}

export function buildExecutiveNarrative({ title, sourceTool, category, riskScore, postureBand, applicationName }) {
  const riskLabel = postureBand === 'critical'
    ? 'critical risk'
    : postureBand === 'high'
      ? 'high risk'
      : postureBand === 'medium'
        ? 'moderate risk'
        : 'low risk';

  const blastRadius = postureBand === 'critical'
    ? 'can materially disrupt core business operations if not contained quickly'
    : postureBand === 'high'
      ? 'could impact customer-facing services and data trust if left unresolved'
      : postureBand === 'medium'
        ? 'requires planned mitigation to avoid escalation'
        : 'should be monitored and addressed through routine hardening';

  return {
    headline: `${applicationName || 'Application'}: ${riskLabel} finding detected`,
    plainLanguage: `${title}. This was detected by ${sourceTool} in the ${category} domain and is currently scored at ${riskScore}/100.`,
    businessImpact: `If untreated, this issue ${blastRadius}.`,
    recommendedAction: postureBand === 'critical' || postureBand === 'high'
      ? 'Assign incident owner now, isolate affected assets where possible, and validate remediation within 24 hours.'
      : 'Track remediation in normal sprint cadence, validate control improvements, and re-scan to confirm closure.',
  };
}

export function enrichFindingRecord(finding) {
  const raw = typeof finding.toJSON === 'function' ? finding.toJSON() : finding;
  const appName = raw.application?.name || null;

  const narrative = buildExecutiveNarrative({
    title: raw.title,
    sourceTool: raw.sourceTool,
    category: raw.category,
    riskScore: raw.riskScore,
    postureBand: raw.riskBand,
    applicationName: appName,
  });

  return {
    ...raw,
    structured: {
      source: raw.sourceTool,
      detectedAt: raw.detectedAt || raw.createdAt,
      asset: {
        applicationId: raw.applicationAssetId,
        applicationName: appName,
        assetType: raw.affectedAssetType || 'application',
        assetRef: raw.affectedAssetRef || null,
      },
      taxonomy: {
        category: raw.category,
        severity: raw.severity,
        cveId: raw.cveId || null,
        cweId: raw.cweId || null,
        mitreTechnique: raw.mitreTechnique || null,
      },
      scoring: {
        confidenceScore: raw.confidenceScore,
        likelihoodScore: raw.likelihoodScore,
        impactScore: raw.impactScore,
        riskScore: raw.riskScore,
        riskBand: raw.riskBand,
      },
      communication: {
        executiveSummary: raw.executiveSummary || narrative.plainLanguage,
        businessImpact: raw.businessImpact || narrative.businessImpact,
        remediationRecommendation: raw.remediationRecommendation || narrative.recommendedAction,
      },
    },
    narrative,
  };
}
