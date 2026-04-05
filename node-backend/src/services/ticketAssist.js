function detectIssueType(ticket) {
  const text = `${ticket.title || ''} ${ticket.description || ''}`.toLowerCase();
  if (/phish|credential|login|account/.test(text)) return 'phishing';
  if (/malware|virus|trojan|ransom/.test(text)) return 'malware';
  if (/network|latency|switch|dns|outage|firewall/.test(text)) return 'network';
  if (/database|sql|data|backup/.test(text)) return 'data';
  if (/api|service|server|endpoint|500|timeout/.test(text)) return 'service';
  return 'general';
}

const SOLUTION_MAP = {
  phishing: [
    'Reset compromised credentials and force sign-out on all active sessions.',
    'Block the sender/domain and quarantine suspicious messages in mail security tools.',
    'Review recent authentication logs and enable MFA enforcement for affected accounts.',
  ],
  malware: [
    'Isolate impacted endpoint or workload from the network immediately.',
    'Run endpoint protection full scan and remove/quarantine malicious artifacts.',
    'Patch exploited software and verify persistence mechanisms are removed.',
  ],
  network: [
    'Validate connectivity path (DNS, gateway, firewall ACLs, and routing).',
    'Check recent configuration changes and roll back risky updates if needed.',
    'Monitor packet loss/latency and confirm service recovery with synthetic checks.',
  ],
  data: [
    'Verify data integrity and compare against trusted backup checkpoints.',
    'Restrict write access while investigation is in progress.',
    'Patch database/service vulnerabilities and rotate exposed secrets.',
  ],
  service: [
    'Check service logs and metrics for errors, saturation, and dependency failures.',
    'Scale or restart unhealthy service instances safely.',
    'Apply relevant patches and validate endpoint behavior through smoke tests.',
  ],
  general: [
    'Confirm scope and affected users/systems before remediation starts.',
    'Apply immediate containment controls to reduce risk exposure.',
    'Execute remediation, validate outcome, and document prevention actions.',
  ],
};

export function buildAssignmentGuidance(ticket) {
  const issueType = detectIssueType(ticket);
  const solutions = SOLUTION_MAP[issueType] || SOLUTION_MAP.general;

  return {
    issueType,
    issueSummary: ticket.description || ticket.title || 'No summary provided.',
    possibleSolutions: solutions,
  };
}

export function detectAssignmentDomain(ticket) {
  const text = `${ticket.title || ''} ${ticket.description || ''}`.toLowerCase();
  if (/network|switch|router|dns|latency|firewall|vpn|ids|ips/.test(text)) return 'network';
  if (/database|sql|postgres|mysql|oracle|mongodb|backup|schema|query/.test(text)) return 'database';
  if (/server|endpoint|workstation|device|hardware|firmware|disk|cpu|memory/.test(text)) return 'hardware';
  if (/api|application|frontend|backend|service|code|deploy|build|dev/.test(text)) return 'application';
  return 'general';
}

export function buildAssignment5W1H(ticket, guidance, context = {}) {
  const nowIso = new Date().toISOString();
  const domain = detectAssignmentDomain(ticket);
  const impacted = ticket.impactedServices || context.impactedServices || 'Primary business service (exact service not specified)';
  const why = guidance.issueSummary || ticket.description || 'Investigation required; the issue summary is currently limited.';
  const how = guidance.possibleSolutions?.[0] || 'Start with triage, containment, and validation actions.';

  return {
    what: ticket.title || 'Security incident ticket assigned',
    where: impacted,
    when: {
      assignedAt: nowIso,
      detectedAt: ticket.createdAt || nowIso,
      slaDueAt: ticket.slaDueAt || null,
    },
    who: {
      assigneeName: context.assigneeName || 'Assigned IT/Security analyst',
      assigneeScjId: context.assigneeScjId || ticket.assigneeId || null,
      coordinator: context.coordinator || 'Cybersecurity Command Centre',
      role: context.assigneeRole || null,
    },
    why,
    how,
    domain,
    nextActions: guidance.possibleSolutions || [],
  };
}

export function buildAssignmentMessage(ticket, guidance, context = {}) {
  const briefing = buildAssignment5W1H(ticket, guidance, context);
  const lines = briefing.nextActions.map((item, i) => `${i + 1}. ${item}`).join('\n');
  return [
    `Ticket Assignment - #${ticket.id}`,
    `Title: ${ticket.title}`,
    `Priority: ${ticket.priority}`,
    `Status: ${ticket.status}`,
    `Domain: ${briefing.domain}`,
    '',
    '5W1H Incident Briefing:',
    `What: ${briefing.what}`,
    `Where: ${briefing.where}`,
    `When: assigned ${briefing.when.assignedAt}${briefing.when.slaDueAt ? ` | SLA due ${briefing.when.slaDueAt}` : ''}`,
    `Who: ${briefing.who.assigneeName}${briefing.who.assigneeScjId ? ` (${briefing.who.assigneeScjId})` : ''}`,
    `Why: ${briefing.why}`,
    `How: ${briefing.how}`,
    '',
    'Recommended Resolution Path:',
    lines,
  ].join('\n');
}

export function buildResolutionReport({
  ticket,
  guidance,
  resolvedBy,
  resolutionNotes,
  rootCause,
  actionsTaken,
  preventiveActions,
}) {
  const clearRootCause = rootCause || 'Root cause was not explicitly provided during closure. Investigation indicates a service/process-level failure.';
  const clearResolution = resolutionNotes || 'Issue has been remediated and validation checks completed successfully.';
  const clearActions = actionsTaken || guidance.possibleSolutions.join(' ');
  const clearPrevention = preventiveActions || 'Additional monitoring and control checks have been scheduled to reduce recurrence risk.';

  const reportText = [
    `Cybersecurity Resolution Report - Ticket #${ticket.id}`,
    '',
    `Title: ${ticket.title}`,
    `Priority: ${ticket.priority}`,
    `Final Status: ${ticket.status}`,
    `Resolved By: ${resolvedBy || 'Assigned IT Staff'}`,
    `Resolved At: ${new Date().toISOString()}`,
    '',
    '1) Issue Summary (Plain Language)',
    guidance.issueSummary,
    '',
    '2) What Likely Caused the Issue',
    clearRootCause,
    '',
    '3) What Was Done to Resolve It',
    clearActions,
    '',
    '4) Validation Outcome',
    clearResolution,
    '',
    '5) Preventive Actions Going Forward',
    clearPrevention,
    '',
    '6) Business Impact (Non-Technical Summary)',
    'The incident has been addressed and service/security posture has been restored. Follow-up controls are in place to minimize similar future disruptions.',
  ].join('\n');

  return {
    issueType: guidance.issueType,
    issueSummary: guidance.issueSummary,
    possibleSolutions: guidance.possibleSolutions,
    reportText,
  };
}
