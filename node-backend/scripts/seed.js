/**
 * Mock data seed script – run with:
 *   node scripts/seed.js
 *
 * Seeds: staff users, application assets, security findings,
 * tickets at every lifecycle stage, comments, action items,
 * resolution reports, and audit log entries.
 */

import bcrypt from 'bcrypt';
import { initModels } from '../src/models/index.js';

const STAFF = [
  {
    name: 'Zanele',
    surname: 'Dlamini',
    role: 'analyst',
    jobTitle: 'Security Analyst',
    department: 'Networks',
    scjId: '00361031-00101',
    email: 'z.dlamini@ccc.local',
    telegramNumber: '100000001',
    notifyEmail: true,
    notifyTelegram: false,
    password_hash: bcrypt.hashSync('Analyst@1', 10),
  },
  {
    name: 'Sipho',
    surname: 'Nkosi',
    role: 'analyst',
    jobTitle: 'Network Engineer',
    department: 'Networks',
    scjId: '00361031-00102',
    email: 's.nkosi@ccc.local',
    telegramNumber: '100000002',
    notifyEmail: true,
    notifyTelegram: false,
    password_hash: bcrypt.hashSync('Analyst@2', 10),
  },
  {
    name: 'Lerato',
    surname: 'Mokoena',
    role: 'analyst',
    jobTitle: 'Software Developer',
    department: 'Dev',
    scjId: '00361031-00103',
    email: 'l.mokoena@ccc.local',
    telegramNumber: '100000003',
    notifyEmail: true,
    notifyTelegram: false,
    password_hash: bcrypt.hashSync('Analyst@3', 10),
  },
  {
    name: 'Thabo',
    surname: 'Sithole',
    role: 'analyst',
    jobTitle: 'Systems Engineer',
    department: 'Hardware',
    scjId: '00361031-00104',
    email: 't.sithole@ccc.local',
    telegramNumber: '100000004',
    notifyEmail: true,
    notifyTelegram: false,
    password_hash: bcrypt.hashSync('Analyst@4', 10),
  },
];

const APPS = [
  {
    name: 'Customer Portal',
    baseUrl: 'https://portal.ccc.local',
    environment: 'production',
    ownerEmail: 'l.mokoena@ccc.local',
    healthStatus: 'degraded',
  },
  {
    name: 'Internal HR System',
    baseUrl: 'https://hr.ccc.local',
    environment: 'production',
    ownerEmail: 'z.dlamini@ccc.local',
    healthStatus: 'healthy',
  },
  {
    name: 'Threat Intel API',
    baseUrl: 'https://ti-api.ccc.local',
    environment: 'production',
    ownerEmail: 's.nkosi@ccc.local',
    healthStatus: 'critical',
  },
  {
    name: 'Dev Sandbox',
    baseUrl: 'http://sandbox.dev.ccc.local',
    environment: 'development',
    ownerEmail: 'l.mokoena@ccc.local',
    healthStatus: 'healthy',
  },
];

async function seed() {
  const {
    userModel,
    ticketModel,
    ticketHistoryModel,
    applicationAssetModel,
    securityFindingModel,
    networkDeviceModel,
    databaseAssetModel,
    auditLogModel,
    ticketCommentModel,
    ticketActionItemModel,
    ticketResolutionReportModel,
  } = await initModels();

  // ── 1. Staff users ──────────────────────────────────────────────────────────
  console.log('Seeding staff users...');
  const createdUsers = [];
  for (const u of STAFF) {
    const [user] = await userModel.findOrCreate({ where: { scjId: u.scjId }, defaults: u });
    createdUsers.push(user);
  }
  const [zanele, sipho, lerato, thabo] = createdUsers;

  // ── 2. Application assets ───────────────────────────────────────────────────
  console.log('Seeding application assets...');
  const createdApps = [];
  for (const a of APPS) {
    const [app] = await applicationAssetModel.findOrCreate({ where: { name: a.name }, defaults: a });
    createdApps.push(app);
  }
  const [portalApp, hrApp, tiApp, devApp] = createdApps;

  // ── 2b. Network devices and database assets ───────────────────────────────
  console.log('Seeding network devices and database assets...');

  const deviceDefs = [
    { name: 'Core-Router-01', deviceType: 'router', ipAddress: '10.0.0.1', location: 'Server Room Rack A', vendor: 'Cisco', model: 'ISR4331', firmwareVersion: '17.9', idsIpsEnabled: true, passiveScanEnabled: true, state: 'online', riskScore: 58 },
    { name: 'Core-Switch-01', deviceType: 'switch', ipAddress: '10.0.0.2', location: 'Server Room Rack A', vendor: 'Cisco', model: 'Catalyst 9300', firmwareVersion: '17.6', idsIpsEnabled: true, passiveScanEnabled: true, state: 'online', riskScore: 48 },
    { name: 'AP-Floor1-01', deviceType: 'access_point', ipAddress: '10.0.10.11', location: 'Floor 1', vendor: 'Ubiquiti', model: 'U6-Pro', firmwareVersion: '6.6.55', idsIpsEnabled: true, passiveScanEnabled: true, state: 'online', riskScore: 34 },
    { name: 'Endpoint-Finance-22', deviceType: 'endpoint', ipAddress: '10.0.30.22', location: 'Finance Office', vendor: 'Dell', model: 'OptiPlex 7010', firmwareVersion: 'BIOS 1.21', idsIpsEnabled: true, passiveScanEnabled: true, state: 'degraded', riskScore: 62 },
  ];
  for (const device of deviceDefs) {
    await networkDeviceModel.findOrCreate({ where: { name: device.name }, defaults: { ...device, lastSeenAt: new Date() } });
  }

  const dbDefs = [
    { name: 'OnPrem-Primary-Postgres', engine: 'postgresql', environment: 'on_prem', host: '10.0.50.10', port: 5432, ownerEmail: 'dba@ccc.local', criticality: 'critical', patchLevel: 'PostgreSQL 16.1', backupStatus: 'warning', encryptionAtRest: true, tlsInTransit: true, state: 'online', riskScore: 67 },
    { name: 'OnPrem-HR-MySQL', engine: 'mysql', environment: 'on_prem', host: '10.0.50.20', port: 3306, ownerEmail: 'hr-systems@ccc.local', criticality: 'high', patchLevel: 'MySQL 8.0.36', backupStatus: 'healthy', encryptionAtRest: true, tlsInTransit: true, state: 'online', riskScore: 44 },
    { name: 'Hybrid-Analytics-Replica', engine: 'postgresql', environment: 'hybrid', host: 'analytics-db.ccc.cloud', port: 5432, ownerEmail: 'analytics@ccc.local', criticality: 'high', patchLevel: 'unknown', backupStatus: 'critical', encryptionAtRest: false, tlsInTransit: true, state: 'degraded', riskScore: 78 },
  ];
  for (const db of dbDefs) {
    await databaseAssetModel.findOrCreate({ where: { name: db.name }, defaults: { ...db, lastSeenAt: new Date() } });
  }

  // ── 3. Security findings ────────────────────────────────────────────────────
  console.log('Seeding security findings...');
  const findingDefs = [
    {
      applicationAssetId: tiApp.id,
      sourceTool: 'Wazuh',
      detectionMode: 'passive',
      category: 'vulnerability',
      severity: 'critical',
      title: 'CVE-2024-1234: Remote code execution in Threat Intel API',
      description: 'Wazuh detected an unauthenticated endpoint exposed on port 8443 susceptible to RCE via malformed JSON payload.',
      evidence: 'Alert rule 31103 triggered at 2026-04-03T08:14:22Z from host ti-api.ccc.local.',
      status: 'investigating',
      fingerprint: 'wazuh-cve-2024-1234-tiapi',
      requiresManualConfirmation: false,
      manualConfirmed: true,
      autoTicketCreated: true,
    },
    {
      applicationAssetId: portalApp.id,
      sourceTool: 'Suricata',
      detectionMode: 'passive',
      category: 'intrusion',
      severity: 'high',
      title: 'Brute-force SSH login detected on Customer Portal host',
      description: '427 failed SSH login attempts within 90 seconds from external IP 203.0.113.55.',
      evidence: 'Suricata EVE log: alert ssh any any -> 10.0.1.20 22 (SID 2003068)',
      status: 'new',
      fingerprint: 'suricata-ssh-brute-portal-20260403',
      requiresManualConfirmation: true,
      manualConfirmed: false,
      autoTicketCreated: false,
    },
    {
      applicationAssetId: portalApp.id,
      sourceTool: 'Prometheus',
      detectionMode: 'passive',
      category: 'availability',
      severity: 'high',
      title: 'Customer Portal latency spike above 3s P95',
      description: 'Prometheus alert HighLatency fired – P95 response time 4.1s for last 15 min window.',
      evidence: 'prometheus_http_request_duration_seconds_bucket{le="3",job="portal"} firing',
      status: 'investigating',
      fingerprint: 'prometheus-latency-portal-20260403',
      requiresManualConfirmation: false,
      manualConfirmed: true,
      autoTicketCreated: true,
    },
    {
      applicationAssetId: hrApp.id,
      sourceTool: 'Wazuh',
      detectionMode: 'active',
      category: 'vulnerability',
      severity: 'medium',
      title: 'Outdated TLS 1.0 cipher in use on HR System',
      description: 'Active scan found HR System accepting TLS 1.0 connections which is deprecated.',
      evidence: 'nmap ssl-enum-ciphers output: TLSv1.0 supported on 443',
      status: 'new',
      fingerprint: 'wazuh-tls10-hrsystem-20260403',
      requiresManualConfirmation: true,
      manualConfirmed: false,
      autoTicketCreated: false,
    },
    {
      applicationAssetId: devApp.id,
      sourceTool: 'Wazuh',
      detectionMode: 'passive',
      category: 'vulnerability',
      severity: 'low',
      title: 'Dev Sandbox exposing /metrics endpoint without auth',
      description: 'Prometheus metrics endpoint accessible without authentication on Dev Sandbox.',
      evidence: 'HTTP 200 on GET http://sandbox.dev.ccc.local/metrics with no Authorization header.',
      status: 'dismissed',
      fingerprint: 'wazuh-metrics-noauth-sandbox-20260403',
      requiresManualConfirmation: false,
      manualConfirmed: false,
      autoTicketCreated: false,
    },
  ];

  const createdFindings = [];
  for (const f of findingDefs) {
    const [finding] = await securityFindingModel.findOrCreate({
      where: { fingerprint: f.fingerprint },
      defaults: f,
    });
    createdFindings.push(finding);
  }
  const [rceFinding, bruteFinding, latencyFinding] = createdFindings;

  // ── 4. Tickets ──────────────────────────────────────────────────────────────
  console.log('Seeding tickets...');

  const now = new Date();
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600000);
  const hoursAhead = (h) => new Date(now.getTime() + h * 3600000);

  const ticketDefs = [
    // T1 – CRITICAL, fully closed with resolution report
    {
      title: 'RCE vulnerability exploited on Threat Intel API – P1 response',
      description: 'Wazuh detected active exploitation of CVE-2024-1234 on ti-api.ccc.local. Outbound beaconing observed to 198.51.100.7:4444. Immediate containment required.',
      priority: 'critical',
      status: 'closed',
      lifecycleStage: 'closed',
      assigneeId: zanele.scjId,
      businessImpactScore: 95,
      impactedServices: 'Threat Intel API, downstream SIEM integrations',
      executiveSummary: 'A critical remote code execution flaw was actively exploited. The affected server was isolated, patched, and restored within SLA. Customer data was not exfiltrated.',
      governanceTags: ['ISO27001-A.12.6', 'POPIA-S19'],
      slaDueAt: hoursAgo(2),
      triagedAt: hoursAgo(10),
      containedAt: hoursAgo(8),
      eradicatedAt: hoursAgo(6),
      recoveredAt: hoursAgo(4),
      postmortemAt: hoursAgo(2),
      closedAt: hoursAgo(1),
      resolvedAt: hoursAgo(4),
      breachedSla: false,
    },
    // T2 – HIGH, currently at triaged
    {
      title: 'SSH brute-force campaign targeting Customer Portal',
      description: 'Suricata flagged 427 failed SSH logins in 90s from 203.0.113.55. Host at 10.0.1.20. Possible credential stuffing campaign.',
      priority: 'high',
      status: 'in_progress',
      lifecycleStage: 'triaged',
      assigneeId: sipho.scjId,
      businessImpactScore: 72,
      impactedServices: 'Customer Portal, authentication gateway',
      executiveSummary: 'An external actor attempted to gain unauthorised access via repeated login attempts. Investigation is in progress; customer-facing service remains operational.',
      governanceTags: ['ISO27001-A.9.4', 'POPIA-S22'],
      slaDueAt: hoursAhead(2),
      triagedAt: hoursAgo(3),
      breachedSla: false,
    },
    // T3 – HIGH, at contained stage
    {
      title: 'Customer Portal P95 latency degradation – DDoS suspected',
      description: 'Prometheus fired HighLatency alert. P95 response at 4.1s sustained for 15 minutes. Request rate 3x normal baseline. Possible volumetric attack or upstream BGP change.',
      priority: 'high',
      status: 'in_progress',
      lifecycleStage: 'contained',
      assigneeId: sipho.scjId,
      businessImpactScore: 80,
      impactedServices: 'Customer Portal, API gateway, CDN',
      executiveSummary: 'The customer-facing portal experienced slowdowns due to abnormal traffic volumes. Rate limiting has been applied and service is recovering.',
      governanceTags: ['ISO27001-A.17.1'],
      slaDueAt: hoursAgo(1),
      triagedAt: hoursAgo(5),
      containedAt: hoursAgo(2),
      breachedSla: true,
    },
    // T4 – MEDIUM, identified (just raised)
    {
      title: 'TLS 1.0 cipher downgrade risk on HR System',
      description: 'Active scan confirmed HR System accepts TLS 1.0 connections. Clients on legacy browsers may be subject to POODLE/BEAST attacks.',
      priority: 'medium',
      status: 'open',
      lifecycleStage: 'identified',
      assigneeId: lerato.scjId,
      businessImpactScore: 45,
      impactedServices: 'HR System, payroll integration',
      executiveSummary: 'A configuration weakness in the HR portal encryption settings was detected. No evidence of exploitation. Remediation scheduled.',
      governanceTags: ['ISO27001-A.10.1', 'PCI-DSS-4.1'],
      slaDueAt: hoursAhead(20),
      breachedSla: false,
    },
    // T5 – LOW, identified (backlog)
    {
      title: 'Dev Sandbox Prometheus /metrics endpoint unauthenticated',
      description: 'Non-production dev sandbox exposing internal metrics without any authentication. Low risk in current network zone but violates hardening baseline.',
      priority: 'low',
      status: 'open',
      lifecycleStage: 'identified',
      assigneeId: lerato.scjId,
      businessImpactScore: 15,
      impactedServices: 'Dev Sandbox',
      executiveSummary: 'A minor configuration gap was identified in the dev environment. No customer or production impact. Will be addressed in the next sprint.',
      governanceTags: ['ISO27001-A.12.1'],
      slaDueAt: hoursAhead(68),
      breachedSla: false,
    },
    // T6 – CRITICAL, at eradicated stage
    {
      title: 'Lateral movement detected: compromised analyst workstation',
      description: 'EDR telemetry shows analyst workstation CCC-WS-007 executed encoded PowerShell and attempted LDAP enumeration against domain controller. Possible phishing compromise.',
      priority: 'critical',
      status: 'in_progress',
      lifecycleStage: 'eradicated',
      assigneeId: thabo.scjId,
      businessImpactScore: 90,
      impactedServices: 'Active Directory, email gateway, file shares',
      executiveSummary: 'An internal workstation was compromised, likely via phishing. The machine was isolated before lateral movement reached domain controllers. No data was exfiltrated.',
      governanceTags: ['ISO27001-A.16.1', 'POPIA-S22', 'NIST-IR'],
      slaDueAt: hoursAgo(0.5),
      triagedAt: hoursAgo(7),
      containedAt: hoursAgo(5),
      eradicatedAt: hoursAgo(1),
      breachedSla: true,
    },
  ];

  const createdTickets = [];
  for (const def of ticketDefs) {
    const existing = await ticketModel.findOne({ where: { title: def.title } });
    if (existing) {
      createdTickets.push(existing);
      continue;
    }
    const t = await ticketModel.create(def);
    createdTickets.push(t);
  }
  const [t1, t2, t3, t4, t5, t6] = createdTickets;

  // Update finding ticketIds
  await rceFinding.update({ ticketId: t1.id, autoTicketCreated: true });
  await latencyFinding.update({ ticketId: t3.id, autoTicketCreated: true });

  // ── 5. Ticket history ───────────────────────────────────────────────────────
  console.log('Seeding ticket history...');

  const historyDefs = [
    // T1 full lifecycle
    { ticketId: t1.id, eventType: 'created', reason: 'Auto-created from Wazuh CVE-2024-1234 finding' },
    { ticketId: t1.id, eventType: 'lifecycle_transition', reason: 'Triaged by Zanele Dlamini – confirmed active exploitation' },
    { ticketId: t1.id, eventType: 'lifecycle_transition', reason: 'Contained: server isolated from network at 08:45' },
    { ticketId: t1.id, eventType: 'comment_added', reason: 'admin added executive comment' },
    { ticketId: t1.id, eventType: 'lifecycle_transition', reason: 'Eradicated: patch CVE-2024-1234 applied, malware artifacts removed' },
    { ticketId: t1.id, eventType: 'lifecycle_transition', reason: 'Recovered: service restored, monitoring confirmed clean' },
    { ticketId: t1.id, eventType: 'lifecycle_transition', reason: 'Postmortem conducted – findings documented in resolution report' },
    { ticketId: t1.id, eventType: 'lifecycle_transition', reason: 'Ticket closed by admin after postmortem sign-off' },
    // T2
    { ticketId: t2.id, eventType: 'created', reason: 'Created from Suricata brute-force alert' },
    { ticketId: t2.id, eventType: 'lifecycle_transition', reason: 'Triaged: external IP 203.0.113.55 blocked at perimeter firewall' },
    { ticketId: t2.id, eventType: 'comment_added', reason: 'sipho added internal note on firewall rule' },
    // T3
    { ticketId: t3.id, eventType: 'created', reason: 'Auto-created from Prometheus HighLatency alert' },
    { ticketId: t3.id, eventType: 'lifecycle_transition', reason: 'Triaged: traffic pattern analysis – volumetric DDoS suspected' },
    { ticketId: t3.id, eventType: 'lifecycle_transition', reason: 'Contained: upstream rate limiting applied via CDN provider' },
    { ticketId: t3.id, eventType: 'action_item_added', reason: 'sipho created action item: engage DDoS scrubbing provider' },
    // T4
    { ticketId: t4.id, eventType: 'created', reason: 'Created from active scan TLS 1.0 finding' },
    // T5
    { ticketId: t5.id, eventType: 'created', reason: 'Created from dev sandbox metrics finding' },
    // T6 full lifecycle up to eradicated
    { ticketId: t6.id, eventType: 'created', reason: 'EDR alert: encoded PowerShell on CCC-WS-007 detected by endpoint agent' },
    { ticketId: t6.id, eventType: 'lifecycle_transition', reason: 'Triaged by Thabo Sithole – confirmed lateral movement indicators' },
    { ticketId: t6.id, eventType: 'lifecycle_transition', reason: 'Contained: CCC-WS-007 isolated, user account suspended' },
    { ticketId: t6.id, eventType: 'comment_added', reason: 'thabo added internal forensic note' },
    { ticketId: t6.id, eventType: 'lifecycle_transition', reason: 'Eradicated: workstation re-imaged, credentials rotated' },
  ];

  for (const h of historyDefs) {
    await ticketHistoryModel.findOrCreate({
      where: { ticketId: h.ticketId, eventType: h.eventType, reason: h.reason },
      defaults: h,
    });
  }

  // ── 6. Collaboration comments ───────────────────────────────────────────────
  console.log('Seeding ticket comments...');

  const commentDefs = [
    {
      ticketId: t1.id,
      authorName: 'zanele',
      authorRole: 'analyst',
      visibility: 'internal',
      message: 'Confirmed outbound C2 beacon to 198.51.100.7:4444 – traffic blocked at firewall. Server disk image captured before remediation.',
    },
    {
      ticketId: t1.id,
      authorName: 'admin',
      authorRole: 'admin',
      visibility: 'executive',
      message: 'The affected server has been isolated and will be restored from a verified clean backup. No customer data was accessed. Full incident report will be available within 72 hours.',
    },
    {
      ticketId: t1.id,
      authorName: 'zanele',
      authorRole: 'analyst',
      visibility: 'internal',
      message: 'Vendor patch applied. Running post-patch verification scans now. ETA 30 min.',
    },
    {
      ticketId: t2.id,
      authorName: 'sipho',
      authorRole: 'analyst',
      visibility: 'internal',
      message: 'Firewall rule 1043 added to block 203.0.113.55/32 at ingress. Fail2ban also updated on the affected host.',
    },
    {
      ticketId: t2.id,
      authorName: 'sipho',
      authorRole: 'analyst',
      visibility: 'executive',
      message: 'External login attempt detected and blocked. No accounts were compromised. Monitoring is active.',
    },
    {
      ticketId: t3.id,
      authorName: 'sipho',
      authorRole: 'analyst',
      visibility: 'internal',
      message: 'CDN-level rate limiting set to 5000 req/s per origin IP. Latency coming down – P95 now at 1.8s. Still investigating root BGP change.',
    },
    {
      ticketId: t3.id,
      authorName: 'admin',
      authorRole: 'admin',
      visibility: 'executive',
      message: 'Customer portal performance has been restored to acceptable levels. Root cause investigation is ongoing. SLA was breached by 45 minutes – RCA to follow.',
    },
    {
      ticketId: t6.id,
      authorName: 'thabo',
      authorRole: 'analyst',
      visibility: 'internal',
      message: 'Memory forensics on CCC-WS-007: found Cobalt Strike beacon DLL injected into explorer.exe. LDAP queries targeted domain admins group. No successful privilege escalation found.',
    },
    {
      ticketId: t6.id,
      authorName: 'thabo',
      authorRole: 'analyst',
      visibility: 'internal',
      message: 'Workstation re-imaged from golden image v4.2. User Naledi Khumalo password and MFA token reset. Phishing email sourced – sent to email security team for block.',
    },
    {
      ticketId: t6.id,
      authorName: 'admin',
      authorRole: 'admin',
      visibility: 'executive',
      message: 'An internal device was compromised via a phishing email. The threat was contained before reaching critical systems. The affected user has been notified and their credentials reset.',
    },
  ];

  for (const c of commentDefs) {
    const exists = await ticketCommentModel.findOne({ where: { ticketId: c.ticketId, message: c.message.substring(0, 60) + '%' } });
    if (!exists) await ticketCommentModel.create(c);
  }

  // ── 7. Action items ─────────────────────────────────────────────────────────
  console.log('Seeding ticket action items...');

  const actionDefs = [
    // T1 – closed ticket, all done
    {
      ticketId: t1.id,
      title: 'Isolate ti-api.ccc.local from production network',
      ownerScjId: zanele.scjId,
      status: 'done',
      dueAt: hoursAgo(9),
      completedAt: hoursAgo(8),
    },
    {
      ticketId: t1.id,
      title: 'Apply vendor patch for CVE-2024-1234',
      ownerScjId: zanele.scjId,
      status: 'done',
      dueAt: hoursAgo(6),
      completedAt: hoursAgo(5),
    },
    {
      ticketId: t1.id,
      title: 'Conduct postmortem and update runbook',
      ownerScjId: zanele.scjId,
      status: 'done',
      dueAt: hoursAgo(1),
      completedAt: hoursAgo(1),
    },
    // T2 – active investigation
    {
      ticketId: t2.id,
      title: 'Block attacker IP 203.0.113.55 at perimeter firewall',
      ownerScjId: sipho.scjId,
      status: 'done',
      dueAt: hoursAgo(2),
      completedAt: hoursAgo(2),
    },
    {
      ticketId: t2.id,
      title: 'Review authentication logs for successful logins from same ASN',
      ownerScjId: zanele.scjId,
      status: 'open',
      dueAt: hoursAhead(4),
    },
    {
      ticketId: t2.id,
      title: 'Harden SSH config: disable password auth, enforce key-only',
      ownerScjId: sipho.scjId,
      status: 'open',
      dueAt: hoursAhead(24),
    },
    // T3 – contained
    {
      ticketId: t3.id,
      title: 'Engage CDN provider to enable DDoS scrubbing',
      ownerScjId: sipho.scjId,
      status: 'done',
      dueAt: hoursAgo(1),
      completedAt: hoursAgo(1),
    },
    {
      ticketId: t3.id,
      title: 'Investigate BGP route changes from upstream ISP',
      ownerScjId: sipho.scjId,
      status: 'open',
      dueAt: hoursAhead(6),
    },
    {
      ticketId: t3.id,
      title: 'Draft SLA breach RCA for executive distribution',
      ownerScjId: thabo.scjId,
      status: 'blocked',
      dueAt: hoursAhead(12),
    },
    // T4 – identified
    {
      ticketId: t4.id,
      title: 'Disable TLS 1.0 and 1.1 on HR System nginx config',
      ownerScjId: lerato.scjId,
      status: 'open',
      dueAt: hoursAhead(48),
    },
    // T6 – eradicated
    {
      ticketId: t6.id,
      title: 'Isolate workstation CCC-WS-007 immediately',
      ownerScjId: thabo.scjId,
      status: 'done',
      dueAt: hoursAgo(6),
      completedAt: hoursAgo(6),
    },
    {
      ticketId: t6.id,
      title: 'Run memory forensics on compromised workstation',
      ownerScjId: thabo.scjId,
      status: 'done',
      dueAt: hoursAgo(4),
      completedAt: hoursAgo(4),
    },
    {
      ticketId: t6.id,
      title: 'Re-image CCC-WS-007 from golden image and re-enroll',
      ownerScjId: thabo.scjId,
      status: 'done',
      dueAt: hoursAgo(1),
      completedAt: hoursAgo(1),
    },
    {
      ticketId: t6.id,
      title: 'Force password reset + new MFA token for affected user',
      ownerScjId: zanele.scjId,
      status: 'done',
      dueAt: hoursAgo(2),
      completedAt: hoursAgo(2),
    },
    {
      ticketId: t6.id,
      title: 'Block phishing domain at email security gateway',
      ownerScjId: lerato.scjId,
      status: 'open',
      dueAt: hoursAhead(4),
    },
    {
      ticketId: t6.id,
      title: 'Run phishing simulation campaign to measure staff awareness',
      ownerScjId: zanele.scjId,
      status: 'open',
      dueAt: hoursAhead(72),
    },
  ];

  for (const a of actionDefs) {
    const exists = await ticketActionItemModel.findOne({ where: { ticketId: a.ticketId, title: a.title } });
    if (!exists) await ticketActionItemModel.create(a);
  }

  // ── 8. Resolution report for T1 ────────────────────────────────────────────
  console.log('Seeding resolution report...');

  const existingReport = await ticketResolutionReportModel.findOne({ where: { ticketId: t1.id } });
  if (!existingReport) {
    await ticketResolutionReportModel.create({
      ticketId: t1.id,
      issueType: 'Remote Code Execution / Active Exploitation',
      issueSummary: 'CVE-2024-1234 was actively exploited on the Threat Intel API host. An unauthenticated endpoint accepted malformed JSON payloads leading to OS command execution and subsequent C2 beaconing.',
      possibleSolutions: 'Apply vendor patch\nIsolate affected host\nRotate all API keys and service credentials\nReview and tighten network egress rules',
      reportText: `=== INCIDENT RESOLUTION REPORT ===
Ticket:        #${t1.id} – RCE on Threat Intel API
Priority:      Critical
Resolved by:   zanele (Zanele Dlamini)
SLA status:    Within SLA

--- ISSUE SUMMARY ---
CVE-2024-1234 was actively exploited on ti-api.ccc.local. An unauthenticated
JSON endpoint parsed user input unsafely enabling OS command injection. The
attacker established a reverse shell beacon to 198.51.100.7:4444.

--- ROOT CAUSE ---
Vendor code introduced a deserialization vulnerability in v2.4.1. Internal
patch notification email was missed due to spam filter misconfiguration.

--- ACTIONS TAKEN ---
  1. Server isolated from production VLAN within 14 minutes of alert.
  2. Outbound firewall rule added to block C2 IP 198.51.100.7.
  3. Disk image captured for forensic preservation.
  4. Vendor patch v2.4.2 applied and integrity verified.
  5. All API credentials rotated; downstream services notified.
  6. Postmortem conducted with CCC technical team.

--- PREVENTIVE ACTIONS ---
  • Patch notification workflow reviewed – vendor advisories now route to
    security alias with mandatory acknowledgement SLA of 24 hours.
  • Network egress default-deny rule added for API tier.
  • Quarterly vulnerability scanning scope extended to cover all API hosts.
  • Incident runbook updated with RCE response playbook.

--- DELIVERY ---
Report distributed to assignee and CCC management.
`,
      resolvedBy: 'zanele',
      deliveredToAssignee: true,
      deliveredToManager: false,
      deliveryChannels: 'assignee_email',
    });
  }

  // ── 9. Audit log entries ────────────────────────────────────────────────────
  console.log('Seeding audit log entries...');

  const auditDefs = [
    { entityType: 'ticket', entityId: String(t1.id), actor: 'zanele', actorRole: 'analyst', action: 'ticket.lifecycle_transition', ipAddress: '10.0.0.5', details: JSON.stringify({ nextStage: 'triaged' }) },
    { entityType: 'ticket', entityId: String(t1.id), actor: 'zanele', actorRole: 'analyst', action: 'ticket.lifecycle_transition', ipAddress: '10.0.0.5', details: JSON.stringify({ nextStage: 'contained' }) },
    { entityType: 'ticket', entityId: String(t1.id), actor: 'admin', actorRole: 'admin', action: 'ticket.lifecycle_transition', ipAddress: '10.0.0.1', details: JSON.stringify({ nextStage: 'closed' }) },
    { entityType: 'ticket', entityId: String(t1.id), actor: 'zanele', actorRole: 'analyst', action: 'ticket.comment_added', ipAddress: '10.0.0.5', details: JSON.stringify({ visibility: 'internal' }) },
    { entityType: 'ticket', entityId: String(t1.id), actor: 'admin', actorRole: 'admin', action: 'ticket.comment_added', ipAddress: '10.0.0.1', details: JSON.stringify({ visibility: 'executive' }) },
    { entityType: 'ticket', entityId: String(t2.id), actor: 'sipho', actorRole: 'analyst', action: 'ticket.lifecycle_transition', ipAddress: '10.0.0.6', details: JSON.stringify({ nextStage: 'triaged' }) },
    { entityType: 'ticket', entityId: String(t3.id), actor: 'sipho', actorRole: 'analyst', action: 'ticket.lifecycle_transition', ipAddress: '10.0.0.6', details: JSON.stringify({ nextStage: 'contained' }) },
    { entityType: 'ticket', entityId: String(t6.id), actor: 'thabo', actorRole: 'analyst', action: 'ticket.lifecycle_transition', ipAddress: '10.0.0.8', details: JSON.stringify({ nextStage: 'eradicated' }) },
    { entityType: 'ticket', entityId: String(t6.id), actor: 'thabo', actorRole: 'analyst', action: 'ticket.action_item_added', ipAddress: '10.0.0.8', details: JSON.stringify({ actionItemId: 'seed' }) },
    { entityType: 'user', entityId: String(zanele.id), actor: 'admin', actorRole: 'admin', action: 'user.created', ipAddress: '10.0.0.1', details: JSON.stringify({ scjId: zanele.scjId }) },
    { entityType: 'user', entityId: String(sipho.id), actor: 'admin', actorRole: 'admin', action: 'user.created', ipAddress: '10.0.0.1', details: JSON.stringify({ scjId: sipho.scjId }) },
    { entityType: 'security_finding', entityId: String(rceFinding.id), actor: 'system', actorRole: null, action: 'finding.auto_ticket_created', ipAddress: null, details: JSON.stringify({ ticketId: t1.id }) },
    { entityType: 'security_finding', entityId: String(bruteFinding.id), actor: 'zanele', actorRole: 'analyst', action: 'finding.manual_confirmed', ipAddress: '10.0.0.5', details: null },
  ];

  for (const a of auditDefs) {
    await auditLogModel.create(a);
  }

  console.log('\nSeed complete!');
  console.log('  Staff created    :', STAFF.length);
  console.log('  Apps registered  :', APPS.length);
  console.log('  Findings seeded  :', findingDefs.length);
  console.log('  Tickets seeded   :', ticketDefs.length);
  console.log('  Audit events     :', auditDefs.length);
  console.log('\nLogin credentials:');
  console.log('  admin        / password123  (admin role)');
  console.log('  zanele       / Analyst@1    (analyst)');
  console.log('  sipho        / Analyst@2    (analyst)');
  console.log('  lerato       / Analyst@3    (analyst)');
  console.log('  thabo        / Analyst@4    (analyst)');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
