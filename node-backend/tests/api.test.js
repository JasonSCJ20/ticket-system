import request from 'supertest';
import bcrypt from 'bcryptjs';
import http from 'http';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

let token;
let defaultOrgId;
let testAssetId;

beforeAll(async () => {
  // Wait for DB init and route mounting
  await ready;

  // Direct model access outside of an HTTP request has no tenant context
  // established automatically (see services/tenantContext.js) — every
  // tenant-scoped model query here needs an explicit platform-admin
  // bypass, same as any real background job would.
  const hash = await bcrypt.hash('password123', 10);
  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    defaultOrgId = org.id;
    await sequelize.models.User.destroy({ where: {} });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'admin_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27123456789',
      telegramChatId: '100000900',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });

  // A ticket must always name a real registered asset — shared fixture
  // referenced by every "create a ticket" test below.
  const testAsset = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.create({
    name: `Test asset for tickets ${Date.now()}`,
    baseUrl: 'https://example.test',
    environment: 'production',
  }));
  testAssetId = testAsset.id;

  // Login to get a real token
  const res = await request(app)
    .post('/api/token')
    .send({ username: 'admin_test', password: 'password123' });
  expect(res.status).toBe(200);
  token = extractAuthCookie(res);
});

afterAll(async () => {
  await sequelize.close();
});

describe('Auth', () => {
  it('returns 401 for unauthenticated /api/tickets', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  it('accepts heartbeat for authenticated users', async () => {
    const res = await request(app)
      .post('/api/heartbeat')
      .set('Cookie', token)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });
});

describe('Registration Policy', () => {
  it('creates an account only when required identity fields and scratchsolidsolutions.org email are provided', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Jane',
        surname: 'Doe',
        scjId: '00361031-00803',
        email: 'jane.doe@scratchsolidsolutions.org',
        telegramNumber: '+27110000001',
        telegramChatId: '100001001',
        audienceCode: 'TJN',
        operationalTeams: ['Network'],
        password: 'StrongPassword1!',
      });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('Jane Doe');
    expect(res.body.name).toBe('Jane');
    expect(res.body.surname).toBe('Doe');
    expect(res.body.scjId).toBe('00361031-00803');

    // Registration previously left zero audit trail — confirm the new
    // entry actually lands, not just that the endpoint still works.
    const registrationAudit = await runAsPlatformAdmin(() => sequelize.models.AuditLog.findOne({
      where: { entityId: String(res.body.id), action: 'auth.account_registered' },
    }));
    expect(registrationAudit).toBeTruthy();
    expect(registrationAudit.actor).toBe('public');

    const loginRes = await request(app)
      .post('/api/token')
      .send({ username: 'Jane Doe', password: 'StrongPassword1!' });

    expect(loginRes.status).toBe(200);
    expect(() => extractAuthCookie(loginRes)).not.toThrow();

    const normalizedLoginRes = await request(app)
      .post('/api/token')
      .send({ username: '  jane doe  ', password: 'StrongPassword1!' });

    expect(normalizedLoginRes.status).toBe(200);
    expect(() => extractAuthCookie(normalizedLoginRes)).not.toThrow();
  });

  it('rejects account creation for non-scratchsolidsolutions.org email domains', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'John',
        surname: 'Smith',
        scjId: '00361031-00804',
        email: 'john.smith@example.com',
        telegramNumber: '+27110000002',
        telegramChatId: '100001002',
        audienceCode: 'GJN',
        operationalTeams: ['Developer'],
        password: 'StrongPassword1!',
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Email address must use the @scratchsolidsolutions.org domain');
  });

  it('rejects weak passwords during account creation', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Jill',
        surname: 'Taylor',
        scjId: '00361031-00805',
        email: 'jill.taylor@scratchsolidsolutions.org',
        telegramNumber: '+27110000003',
        telegramChatId: '100001003',
        audienceCode: 'BJN',
        operationalTeams: ['Hardware'],
        password: 'WeakPassword123',
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Password must contain special characters');
  });
});

describe('Users', () => {
  it('creates a user as admin', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', token)
      .send({
        name: 'testuser_jest',
        surname: 'qa',
        department: 'Dev',
        telegramNumber: '100000501',
        email: 'testuser_jest@scj.local',
        scjId: '00361031-09999',
        role: 'analyst',
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('testuser_jest');
    expect(res.body.scjId).toBe('00361031-09999');

    // This endpoint can assign any role, including admin — previously had
    // zero audit trail. Confirm the real actor (not "public") is recorded.
    const creationAudit = await runAsPlatformAdmin(() => sequelize.models.AuditLog.findOne({
      where: { entityId: String(res.body.id), action: 'user.created_by_admin' },
    }));
    expect(creationAudit).toBeTruthy();
    expect(creationAudit.actorRole).toBe('admin');
  });

  it('lists users as admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Cookie', token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Tickets', () => {
  it('creates a ticket', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Cookie', token)
      .send({
        title: 'Test Ticket',
        description: 'This is a test ticket body',
        priority: 'high',
        assigneeId: '00361031-09999',
        assetLinks: [{ assetType: 'application', assetId: testAssetId }],
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Ticket');
    expect(res.body.assigneeId).toBe('00361031-09999');
  });

  it('rejects a ticket with no asset link', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Cookie', token)
      .send({
        title: 'No Asset Ticket',
        description: 'This ticket omits assetLinks entirely',
        priority: 'high',
      });
    expect(res.status).toBe(422);
  });

  it('rejects a ticket that links a nonexistent asset', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Cookie', token)
      .send({
        title: 'Fake Asset Ticket',
        description: 'This ticket links an asset id that does not exist',
        priority: 'high',
        assetLinks: [{ assetType: 'application', assetId: 999999 }],
      });
    expect(res.status).toBe(422);
  });

  it('persists root cause, actions taken, and preventive actions on update', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Cookie', token)
      .send({
        title: 'WHY HOW Ticket',
        description: 'Ticket for verifying WHY/HOW fields persist',
        priority: 'medium',
        assetLinks: [{ assetType: 'application', assetId: testAssetId }],
      });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/tickets/${created.body.id}`)
      .set('Cookie', token)
      .send({
        rootCause: 'An outdated dependency introduced the vulnerability.',
        actionsTaken: 'Applied the vendor patch and redeployed.',
        preventiveActions: 'Enabled automatic dependency update checks.',
      });
    expect(patched.status).toBe(200);
    expect(patched.body.rootCause).toBe('An outdated dependency introduced the vulnerability.');
    expect(patched.body.actionsTaken).toBe('Applied the vendor patch and redeployed.');
    expect(patched.body.preventiveActions).toBe('Enabled automatic dependency update checks.');
  });

  it('lists tickets', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .set('Cookie', token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('transitions lifecycle stage and stores collaboration artifacts', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Cookie', token)
      .send({
        title: 'Lifecycle Ticket',
        description: 'Incident lifecycle transition validation ticket',
        priority: 'critical',
        assigneeId: '00361031-09999',
        assetLinks: [{ assetType: 'application', assetId: testAssetId }],
      });
    expect(created.status).toBe(201);

    const ticketId = created.body.id;

    const moved = await request(app)
      .post(`/api/tickets/${ticketId}/transition`)
      .set('Cookie', token)
      .send({ stage: 'triaged', note: 'Triaged during test' });
    expect(moved.status).toBe(200);
    expect(moved.body.lifecycleStage).toBe('triaged');

    const comment = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Cookie', token)
      .send({ message: 'Initial triage note', visibility: 'internal' });
    expect(comment.status).toBe(201);

    const actionItem = await request(app)
      .post(`/api/tickets/${ticketId}/action-items`)
      .set('Cookie', token)
      .send({ title: 'Collect endpoint forensic image', ownerScjId: '00361031-09999' });
    expect(actionItem.status).toBe(201);

    const comments = await request(app)
      .get(`/api/tickets/${ticketId}/comments`)
      .set('Cookie', token);
    expect(comments.status).toBe(200);
    expect(Array.isArray(comments.body)).toBe(true);
    expect(comments.body.length).toBeGreaterThan(0);

    const items = await request(app)
      .get(`/api/tickets/${ticketId}/action-items`)
      .set('Cookie', token);
    expect(items.status).toBe(200);
    expect(Array.isArray(items.body)).toBe(true);
    expect(items.body.length).toBeGreaterThan(0);
  });
});

describe('Reports, Governance, and Assistant', () => {
  it('returns executive metrics and reports', async () => {
    const metrics = await request(app)
      .get('/api/tickets/metrics/executive')
      .set('Cookie', token);
    expect(metrics.status).toBe(200);
    expect(metrics.body).toHaveProperty('activeTickets');

    const impact = await request(app)
      .get('/api/security/executive-impact')
      .set('Cookie', token);
    expect(impact.status).toBe(200);
    expect(impact.body).toHaveProperty('riskIndex');

    const executive = await request(app)
      .get('/api/reports/executive')
      .set('Cookie', token);
    expect(executive.status).toBe(200);
    expect(executive.body).toHaveProperty('audience', 'executive');

    const technical = await request(app)
      .get('/api/reports/technical')
      .set('Cookie', token);
    expect(technical.status).toBe(200);
    expect(technical.body).toHaveProperty('audience', 'technical');
  });

  it('returns command centre fortress posture telemetry', async () => {
    const res = await request(app)
      .get('/api/security/fortress/posture')
      .set('Cookie', token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fortressScore');
    expect(res.body).toHaveProperty('postureBand');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('adminCount');
    expect(res.body.summary).toHaveProperty('recoveryReadinessScore');
    expect(res.body).toHaveProperty('recentPrivilegedActions');
    expect(res.body).toHaveProperty('securityTooling');
    expect(res.body).toHaveProperty('toolingAnomalies');
    expect(Array.isArray(res.body.securityTooling)).toBe(true);
    expect(res.body.securityTooling.length).toBeGreaterThan(0);
    expect(res.body.securityTooling[0]).toHaveProperty('engine');
    expect(res.body.securityTooling[0]).toHaveProperty('tool');
    expect(res.body.securityTooling[0]).toHaveProperty('status');
    expect(res.body.securityTooling[0]).toHaveProperty('scanState');
    expect(res.body.securityTooling[0]).toHaveProperty('lastSeenAt');
    expect(res.body.securityTooling[0]).toHaveProperty('protectsCommandCentre');
    expect(res.body.securityTooling[0]).toHaveProperty('protectedAssetCoverage');
    expect(res.body.securityTooling[0]).toHaveProperty('telemetryHealth');
    expect(res.body.summary).toHaveProperty('toolingCriticalSilentCount');
    expect(res.body.summary).toHaveProperty('toolingWatchSilentCount');
  });

  it('accepts fortress tooling heartbeat events and reflects them in posture', async () => {
    const heartbeat = await request(app)
      .post('/api/security/fortress/tooling/heartbeat')
      .set('Cookie', token)
      .send({
        id: 'runtime-guardian',
        engine: 'Cilium Tetragon',
        tool: 'Runtime Threat Hunting and Response',
        status: 'online',
        scanState: 'scanning',
        detail: 'Runtime policy enforcement active across command centre and assets',
        protectsCommandCentre: true,
        protectedAssets: 3,
        totalAssets: 4,
      });

    expect(heartbeat.status).toBe(201);
    expect(heartbeat.body).toHaveProperty('accepted', true);

    const posture = await request(app)
      .get('/api/security/fortress/posture')
      .set('Cookie', token);

    expect(posture.status).toBe(200);
    const runtimeGuardian = posture.body.securityTooling.find((item) => item.id === 'runtime-guardian');
    expect(runtimeGuardian).toBeTruthy();
    expect(runtimeGuardian.status).toBe('online');
    expect(runtimeGuardian.scanState).toBe('scanning');
    expect(runtimeGuardian.detail).toMatch(/command centre and assets/i);
    expect(runtimeGuardian.protectsCommandCentre).toBe(true);
    expect(runtimeGuardian.protectedAssetCoverage).toHaveProperty('protectedAssets', 3);
    expect(runtimeGuardian.protectedAssetCoverage).toHaveProperty('totalAssets', 4);
    expect(runtimeGuardian).toHaveProperty('telemetryHealth');
    expect(runtimeGuardian.telemetryHealth.state).toBe('healthy');
  });

  it('runs a fortress recovery drill and returns remediation guidance', async () => {
    const res = await request(app)
      .post('/api/security/fortress/recovery-drill')
      .set('Cookie', token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('exerciseStatus');
    expect(res.body).toHaveProperty('databasesReviewed');
    expect(res.body).toHaveProperty('remediationTasksCreated');
  });

  it('generates assistant triage and audit logs', async () => {
    const triage = await request(app)
      .post('/api/assistant/triage')
      .set('Cookie', token)
      .send({
        title: 'Potential phishing event',
        description: 'User received suspicious credential harvesting email and clicked link.',
        priority: 'high',
        businessImpactScore: 70,
      });
    expect(triage.status).toBe(200);
    expect(triage.body).toHaveProperty('urgencyScore');
    expect(Array.isArray(triage.body.recommendedActions)).toBe(true);

    const governance = await request(app)
      .get('/api/governance/audit-logs')
      .set('Cookie', token);
    expect(governance.status).toBe(200);
    expect(Array.isArray(governance.body)).toBe(true);
  });

  it('returns workforce telemetry and notification ledger for governance users', async () => {
    const workforce = await request(app)
      .get('/api/governance/workforce-telemetry')
      .set('Cookie', token);
    expect(workforce.status).toBe(200);
    expect(workforce.body).toHaveProperty('summary');
    expect(workforce.body).toHaveProperty('users');
    expect(Array.isArray(workforce.body.users)).toBe(true);

    const ledger = await request(app)
      .get('/api/governance/notification-ledger')
      .set('Cookie', token);
    expect(ledger.status).toBe(200);
    expect(Array.isArray(ledger.body)).toBe(true);
  });

  it('returns refreshed token after profile update', async () => {
    const previousToken = token;
    const updated = await request(app)
      .patch('/api/me/profile')
      .set('Cookie', token)
      .send({
        audienceCode: 'TJN',
        telegramNumber: null,
        telegramChatId: null,
        operationalTeams: [],
      });

    expect(updated.status).toBe(200);
    expect(updated.body).toHaveProperty('ok', true);
    expect(updated.body).toHaveProperty('token_type', 'bearer');
    expect(() => extractAuthCookie(updated)).not.toThrow();
    token = extractAuthCookie(updated);

    const oldTokenRequest = await request(app)
      .get('/api/assistant/command-centre')
      .set('Cookie', previousToken);
    expect(oldTokenRequest.status).toBe(401);

    const newTokenRequest = await request(app)
      .get('/api/assistant/command-centre')
      .set('Cookie', token);
    expect(newTokenRequest.status).toBe(200);
  });

  it('denies governance routes for STAFF audience users', async () => {
    const staffPassword = 'StrongPassword1!';
    const register = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Staff',
        surname: `Limited${Date.now()}`,
        scjId: '00361031-00806',
        email: `staff.limited.${Date.now()}@scratchsolidsolutions.org`,
        telegramNumber: '+27110000006',
        telegramChatId: '100001006',
        audienceCode: 'STAFF',
        operationalTeams: ['Network'],
        password: staffPassword,
      });
    expect(register.status).toBe(201);

    const login = await request(app)
      .post('/api/token')
      .send({ username: register.body.username, password: staffPassword });
    expect(login.status).toBe(200);

    const denied = await request(app)
      .get('/api/governance/workforce-telemetry')
      .set('Cookie', extractAuthCookie(login));
    expect(denied.status).toBe(403);
  });

  it('returns enriched assistant command-centre context', async () => {
    const res = await request(app)
      .get('/api/assistant/command-centre')
      .set('Cookie', token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('fortressContext');
    expect(res.body).toHaveProperty('performanceContext');
    expect(res.body.fortressContext).toHaveProperty('incidentPressureScore');
    expect(res.body.performanceContext).toHaveProperty('slowRoutes');
    expect(Array.isArray(res.body.performanceContext.slowRoutes)).toBe(true);
  });

  it('auto-tends a ticket and applies lifecycle progression', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Cookie', token)
      .send({
        title: 'Assistant Tend Ticket',
        description: 'Validate one-click ticket tending workflow',
        priority: 'high',
        assigneeId: '00361031-09999',
        assetLinks: [{ assetType: 'application', assetId: testAssetId }],
      });
    expect(created.status).toBe(201);

    const tended = await request(app)
      .post('/api/assistant/tend-ticket')
      .set('Cookie', token)
      .send({
        ticketId: created.body.id,
        notes: 'Auto-tend during API test',
      });

    expect(tended.status).toBe(200);
    expect(tended.body).toHaveProperty('tended', true);
    expect(tended.body).toHaveProperty('appliedChanges');
    expect(tended.body.appliedChanges).toHaveProperty('status', 'in_progress');
    expect(tended.body.appliedChanges).toHaveProperty('lifecycleStage', 'triaged');
    expect(Array.isArray(tended.body.recommendedActions)).toBe(true);
  });

  it('auto-tends an alert and links it to an incident ticket', async () => {
    const finding = await runWithOrganization(defaultOrgId, () => sequelize.models.SecurityFinding.create({
      sourceTool: 'jest-seed',
      detectionMode: 'passive',
      category: 'intrusion',
      severity: 'high',
      title: 'Assistant Tend Alert',
      description: 'Validate one-click alert tending workflow',
      fingerprint: `assistant-tend-alert-${Date.now()}`,
      status: 'new',
    }));

    const tended = await request(app)
      .post('/api/assistant/tend-alert')
      .set('Cookie', token)
      .send({
        findingId: finding.id,
        assigneeId: '00361031-09999',
        assetLinks: [{ assetType: 'application', assetId: testAssetId }],
      });

    expect(tended.status).toBe(200);
    expect(tended.body).toHaveProperty('tended', true);
    expect(tended.body).toHaveProperty('linkedTicketId');
    expect(tended.body.finding).toHaveProperty('status', 'investigating');
    expect(tended.body.linkedTicketId).not.toBeNull();

    const refreshed = await runWithOrganization(defaultOrgId, () => sequelize.models.SecurityFinding.findByPk(finding.id));
    expect(refreshed.ticketId).toBe(tended.body.linkedTicketId);
  });
});

describe('Password Recovery Hardening', () => {
  it('rate limits forgot-password request after five attempts', async () => {
    const email = `request.limit.${Date.now()}@scj.local`;
    const statuses = [];

    for (let i = 0; i < 7; i += 1) {
      const res = await request(app)
        .post('/api/auth/forgot-password/request')
        .send({ email });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(statuses[6]).toBe(429);
  });

  it('rate limits forgot-password reset verification and records auth recovery audits', async () => {
    const email = `verify.limit.${Date.now()}@scj.local`;
    const statuses = [];

    for (let i = 0; i < 7; i += 1) {
      const res = await request(app)
        .post('/api/auth/forgot-password/reset')
        .send({
          email,
          resetCode: '000000',
          newPassword: 'StrongPass123!',
        });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(statuses[6]).toBe(429);

    const governance = await request(app)
      .get('/api/governance/audit-logs')
      .set('Cookie', token);
    expect(governance.status).toBe(200);

    const actions = governance.body.map((entry) => entry.action);
    expect(actions).toContain('auth.reset_request_rate_limited');
    expect(actions).toContain('auth.reset_verify_rate_limited');
  });
});

describe('Patch Management', () => {
  it('creates, lists, and transitions patch tasks by asset class', async () => {
    const appAsset = await request(app)
      .post('/api/security/applications')
      .set('Cookie', token)
      .send({
        name: `Patch App ${Date.now()}`,
        baseUrl: 'http://localhost:3001/health',
        environment: 'production',
      });
    expect(appAsset.status).toBe(201);

    const networkAsset = await request(app)
      .post('/api/security/network/devices')
      .set('Cookie', token)
      .send({
        name: `Patch Router ${Date.now()}`,
        deviceType: 'router',
        location: 'Core',
      });
    expect(networkAsset.status).toBe(201);

    const dbAsset = await request(app)
      .post('/api/security/database/assets')
      .set('Cookie', token)
      .send({
        name: `Patch DB ${Date.now()}`,
        engine: 'postgresql',
        environment: 'on_prem',
        host: '10.0.0.11',
      });
    expect(dbAsset.status).toBe(201);

    const patch1 = await request(app)
      .post('/api/security/patches')
      .set('Cookie', token)
      .send({
        assetType: 'application',
        assetId: appAsset.body.id,
        title: 'Upgrade OpenSSL package',
        severity: 'high',
      });
    expect(patch1.status).toBe(201);

    const patch2 = await request(app)
      .post('/api/security/patches')
      .set('Cookie', token)
      .send({
        assetType: 'network_device',
        assetId: networkAsset.body.id,
        title: 'Update router firmware',
        severity: 'critical',
      });
    expect(patch2.status).toBe(201);

    const patch3 = await request(app)
      .post('/api/security/patches')
      .set('Cookie', token)
      .send({
        assetType: 'database_asset',
        assetId: dbAsset.body.id,
        title: 'Apply PostgreSQL security update',
        severity: 'high',
      });
    expect(patch3.status).toBe(201);

    const board = await request(app)
      .get('/api/security/patches')
      .set('Cookie', token);
    expect(board.status).toBe(200);
    expect(board.body.summary.total).toBeGreaterThanOrEqual(3);
    expect(board.body.grouped.application.todo.length).toBeGreaterThan(0);
    expect(board.body.grouped.network_device.todo.length).toBeGreaterThan(0);
    expect(board.body.grouped.database_asset.todo.length).toBeGreaterThan(0);

    const moved = await request(app)
      .patch(`/api/security/patches/${patch2.body.id}/status`)
      .set('Cookie', token)
      .send({ status: 'in_progress' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('in_progress');

    const completed = await request(app)
      .patch(`/api/security/patches/${patch3.body.id}/status`)
      .set('Cookie', token)
      .send({ status: 'completed' });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.completedAt).not.toBeNull();
  });
});

describe('Route Module Coverage', () => {
  it('returns automation status for admin users', async () => {
    const res = await request(app)
      .get('/api/automation/status')
      .set('Cookie', token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('networkEnabled');
    expect(res.body).toHaveProperty('databaseEnabled');
    expect(res.body).toHaveProperty('autoCreateTickets');
    expect(res.body).toHaveProperty('schedules');
    expect(res.body).toHaveProperty('thresholds');
    expect(res.body).toHaveProperty('locks');
  });

  it('handles webhook telegram updates with missing message safely', async () => {
    const res = await request(app)
      .post('/webhook/telegram')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('Scan Queue Throughput', () => {
  it('accepts passive scan requests as queued jobs', async () => {
    const res = await request(app)
      .post('/api/security/scan/passive')
      .set('Cookie', token);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('accepted', true);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('status');
    expect(['queued', 'running']).toContain(res.body.status);

    const job = await request(app)
      .get(`/api/security/scan/jobs/${res.body.jobId}`)
      .set('Cookie', token);

    expect(job.status).toBe(200);
    expect(job.body).toHaveProperty('id', res.body.jobId);
    expect(job.body).toHaveProperty('mode', 'passive');
    expect(job.body).toHaveProperty('status');
  });
});

describe('Asset Types (non-application assets)', () => {
  it('registers a router by IP address alone, with no base URL', async () => {
    const res = await request(app)
      .post('/api/security/applications')
      .set('Cookie', token)
      .send({
        name: `office-router-${Date.now()}`,
        assetType: 'router',
        ipAddress: '192.168.1.1',
        environment: 'production',
      });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('router');
    expect(res.body.ipAddress).toBe('192.168.1.1');
    expect(res.body.baseUrl).toBeNull();
  });

  it('rejects an asset with neither a base URL nor an IP address', async () => {
    const res = await request(app)
      .post('/api/security/applications')
      .set('Cookie', token)
      .send({ name: `unreachable-asset-${Date.now()}`, environment: 'production' });
    expect(res.status).toBe(422);
  });

  it('never exposes raw key hashes or the edge credential ciphertext in the asset list', async () => {
    const res = await request(app)
      .get('/api/security/applications')
      .set('Cookie', token);
    expect(res.status).toBe(200);
    for (const asset of res.body) {
      expect(asset).not.toHaveProperty('agentKeyHash');
      expect(asset).not.toHaveProperty('sentinelKeyHash');
      expect(asset).not.toHaveProperty('edgeCredentialSecret');
      expect(asset).toHaveProperty('hasAgentKey');
      expect(asset).toHaveProperty('hasSentinelKey');
      expect(asset).toHaveProperty('hasEdgeCredential');
    }
  });
});

describe('Asset Enforcement Onboarding', () => {
  let testServer;
  let testServerUrl;
  let assetId;

  beforeAll((done) => {
    // A real local HTTP target so the backend's canary probe (a genuine
    // outbound fetch) has something real to reach, rather than mocking fetch.
    testServer = http.createServer((_req, res) => res.end('ok')).listen(0, '127.0.0.1', () => {
      testServerUrl = `http://127.0.0.1:${testServer.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    testServer.close(done);
  });

  beforeAll(async () => {
    const asset = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.create({
      name: 'enforcement-test-asset',
      baseUrl: 'http://placeholder.invalid',
    }));
    assetId = asset.id;
  });

  it('issues an agent key and requires it for heartbeats', async () => {
    const issued = await request(app)
      .post(`/api/security/applications/${assetId}/agent-key`)
      .set('Cookie', token);
    expect(issued.status).toBe(201);
    expect(issued.body).toHaveProperty('agentKey');
    expect(issued.body.agentKey).toMatch(/^cca_/);

    const rejected = await request(app)
      .post(`/api/security/applications/${assetId}/agent-heartbeat`)
      .set('x-agent-key', 'wrong-key');
    expect(rejected.status).toBe(401);

    const accepted = await request(app)
      .post(`/api/security/applications/${assetId}/agent-heartbeat`)
      .set('x-agent-key', issued.body.agentKey);
    expect(accepted.status).toBe(200);

    const asset = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.findByPk(assetId));
    expect(asset.enforcementModel).toBe('agent');
    expect(asset.enforcementMode).toBe('shadow');
    expect(asset.lastHeartbeatAt).not.toBeNull();

    // Point the asset at a real reachable server for the verify step below.
    await runWithOrganization(defaultOrgId, () => asset.update({ baseUrl: testServerUrl }));
  });

  it('blocks promotion to active mode until verification succeeds, then allows it', async () => {
    const blocked = await request(app)
      .patch(`/api/security/applications/${assetId}/mode`)
      .set('Cookie', token)
      .send({ mode: 'active' });
    expect(blocked.status).toBe(409);

    const verify = await request(app)
      .post(`/api/security/applications/${assetId}/verify`)
      .set('Cookie', token);
    expect(verify.status).toBe(202);
    expect(verify.body).toHaveProperty('verificationId');
    const nonce = verify.body.verificationId;

    // Simulate the agent's own report of having seen the canary probe —
    // exercises the same endpoint the real @commandcentre/agent package
    // will call once built. Re-issue a key here since the previous test's
    // raw key wasn't persisted for reuse across `it` blocks — this also
    // verifies the agent-report auth path.
    const reissued = await request(app)
      .post(`/api/security/applications/${assetId}/agent-key`)
      .set('Cookie', token);

    const report = await request(app)
      .post(`/api/security/applications/${assetId}/agent-report`)
      .set('x-agent-key', reissued.body.agentKey)
      .send({ type: 'canary_seen', nonce });
    expect(report.status).toBe(200);

    // Poll once — the canary probe is fired in the background but should
    // resolve well within the test's default timeout.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const status = await request(app)
      .get(`/api/security/applications/${assetId}/verify/${nonce}`)
      .set('Cookie', token);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('verified');

    const promoted = await request(app)
      .patch(`/api/security/applications/${assetId}/mode`)
      .set('Cookie', token)
      .send({ mode: 'active' });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toHaveProperty('mode', 'active');
  });
});

describe('Edge Enforcement (Cloudflare)', () => {
  // A real local HTTP server standing in for Cloudflare's API, shaped like
  // the real thing — the backend's edge-enforcement service makes genuine
  // outbound HTTP calls against it (via CLOUDFLARE_EDGE_API_BASE_URL), not a
  // mocked fetch. Only the "who's on the other end" changes from production.
  let cfServer;
  let cfServerUrl;
  let assetId;
  const rules = new Map();
  let nextRuleId = 1;

  beforeAll((done) => {
    cfServer = http
      .createServer((req, res) => {
        const send = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET' && req.url === '/zones/zone-good') {
          return send(200, { success: true, result: { name: 'client-example.com' } });
        }
        if (req.method === 'GET' && req.url === '/zones/zone-bad') {
          return send(403, { success: false, errors: [{ message: 'Invalid API token for this zone' }] });
        }
        if (req.method === 'POST' && req.url === '/zones/zone-good/firewall/access_rules/rules') {
          const id = `rule-${nextRuleId++}`;
          rules.set(id, true);
          return send(200, { success: true, result: { id } });
        }
        const deleteMatch = req.url.match(/^\/zones\/zone-good\/firewall\/access_rules\/rules\/(.+)$/);
        if (req.method === 'DELETE' && deleteMatch) {
          rules.delete(deleteMatch[1]);
          return send(200, { success: true, result: { id: deleteMatch[1] } });
        }
        send(404, { success: false, errors: [{ message: 'not found in mock' }] });
      })
      .listen(0, '127.0.0.1', () => {
        cfServerUrl = `http://127.0.0.1:${cfServer.address().port}`;
        process.env.CLOUDFLARE_EDGE_API_BASE_URL = cfServerUrl;
        done();
      });
  });

  afterAll((done) => {
    delete process.env.CLOUDFLARE_EDGE_API_BASE_URL;
    cfServer.close(done);
  });

  beforeAll(async () => {
    const asset = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.create({
      name: 'edge-enforcement-test-asset',
      baseUrl: 'http://placeholder.invalid',
    }));
    assetId = asset.id;
  });

  it('rejects verification for a token/zone the provider does not recognize', async () => {
    const set = await request(app)
      .post(`/api/security/applications/${assetId}/edge-credential`)
      .set('Cookie', token)
      .send({ token: 'cf-token-placeholder', meta: { zoneId: 'zone-bad' } });
    expect(set.status).toBe(201);

    const verify = await request(app)
      .post(`/api/security/applications/${assetId}/verify`)
      .set('Cookie', token);
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe('failed');

    const asset = await runWithOrganization(defaultOrgId, () => sequelize.models.ApplicationAsset.findByPk(assetId));
    expect(asset.verificationStatus).toBe('failed');
  });

  it('verifies a real zone, promotes to active, then blocks and unblocks an IP against the real provider API', async () => {
    await request(app)
      .post(`/api/security/applications/${assetId}/edge-credential`)
      .set('Cookie', token)
      .send({ token: 'cf-token-placeholder', meta: { zoneId: 'zone-good' } });

    const verify = await request(app)
      .post(`/api/security/applications/${assetId}/verify`)
      .set('Cookie', token);
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe('verified');

    const promoted = await request(app)
      .patch(`/api/security/applications/${assetId}/mode`)
      .set('Cookie', token)
      .send({ mode: 'active' });
    expect(promoted.status).toBe(200);

    const rejectedSession = await request(app)
      .post(`/api/security/applications/${assetId}/commands`)
      .set('Cookie', token)
      .send({ action: 'block_session', target: 'sess-123' });
    expect(rejectedSession.status).toBe(400);

    const blocked = await request(app)
      .post(`/api/security/applications/${assetId}/commands`)
      .set('Cookie', token)
      .send({ action: 'block_ip', target: '203.0.113.9', reason: 'automated test block' });
    expect(blocked.status).toBe(201);
    expect(blocked.body.status).toBe('acknowledged');
    expect(blocked.body.externalRef).toMatch(/^rule-/);
    expect(rules.has(blocked.body.externalRef)).toBe(true);

    const unblocked = await request(app)
      .post(`/api/security/applications/${assetId}/commands`)
      .set('Cookie', token)
      .send({ action: 'unblock_ip', target: '203.0.113.9' });
    expect(unblocked.status).toBe(201);
    expect(unblocked.body.status).toBe('acknowledged');
    expect(rules.has(blocked.body.externalRef)).toBe(false);
  });
});

describe('Fortress Kill Switch', () => {
  afterEach(async () => {
    // Each tier is independent — reset all of them between tests so one
    // test's activation can't leak into the next.
    await request(app)
      .post('/api/security/fortress/kill-switch/unblock-ip')
      .set('Cookie', token)
      .send({ ip: '::ffff:127.0.0.1' });
    await request(app)
      .post('/api/security/fortress/kill-switch/lockdown')
      .set('Cookie', token)
      .send({ active: false });
  });

  it('blocks the requesting IP and the kill-switch path stays reachable to undo it', async () => {
    const blocked = await request(app)
      .post('/api/security/fortress/kill-switch/block-ip')
      .set('Cookie', token)
      .send({ ip: '::ffff:127.0.0.1', reason: 'test' });
    expect(blocked.status).toBe(200);

    const rejected = await request(app).get('/api/tickets').set('Cookie', token);
    expect(rejected.status).toBe(403);

    // The management path itself must stay reachable even while our own IP
    // is blocked — otherwise a self-block has no recovery path.
    const unblocked = await request(app)
      .post('/api/security/fortress/kill-switch/unblock-ip')
      .set('Cookie', token)
      .send({ ip: '::ffff:127.0.0.1' });
    expect(unblocked.status).toBe(200);

    const restored = await request(app).get('/api/tickets').set('Cookie', token);
    expect(restored.status).toBe(200);
  });

  it('full lockdown blocks ordinary routes but exempts login and the kill-switch path', async () => {
    const activated = await request(app)
      .post('/api/security/fortress/kill-switch/lockdown')
      .set('Cookie', token)
      .send({ active: true, reason: 'test lockdown' });
    expect(activated.status).toBe(200);
    expect(activated.body).toHaveProperty('lockdownActive', true);

    const duringLockdown = await request(app).get('/api/tickets').set('Cookie', token);
    expect(duringLockdown.status).toBe(503);

    const loginStillWorks = await request(app)
      .post('/api/token')
      .send({ username: 'admin_test', password: 'password123' });
    expect(loginStillWorks.status).toBe(200);

    const deactivated = await request(app)
      .post('/api/security/fortress/kill-switch/lockdown')
      .set('Cookie', token)
      .send({ active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toHaveProperty('lockdownActive', false);

    const afterLockdown = await request(app).get('/api/tickets').set('Cookie', token);
    expect(afterLockdown.status).toBe(200);
  });

  it('revoking all sessions rejects tokens issued before the revoke instant, including the caller\'s own', async () => {
    const login = await request(app)
      .post('/api/token')
      .send({ username: 'admin_test', password: 'password123' });
    const freshToken = extractAuthCookie(login);

    const revoked = await request(app)
      .post('/api/security/fortress/kill-switch/revoke-sessions')
      .set('Cookie', freshToken)
      .send({ reason: 'test revoke' });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toHaveProperty('revoked', true);

    const rejectedOldToken = await request(app).get('/api/tickets').set('Cookie', freshToken);
    expect(rejectedOldToken.status).toBe(401);

    // JWT `iat` is second-precision, and the revoke check treats a token
    // minted in the exact same wall-clock second as the revoke as revoked
    // too (see app.js) — step past that second so this re-login produces an
    // unambiguously-after token, rather than racing the clock.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const reLogin = await request(app)
      .post('/api/token')
      .send({ username: 'admin_test', password: 'password123' });
    expect(reLogin.status).toBe(200);
    const worksAfterReLogin = await request(app)
      .get('/api/tickets')
      .set('Cookie', extractAuthCookie(reLogin));
    expect(worksAfterReLogin.status).toBe(200);

    // Restore the shared `token` used by every other describe block in this
    // file — it was minted before the revoke instant too.
    token = extractAuthCookie(reLogin);
  });
});