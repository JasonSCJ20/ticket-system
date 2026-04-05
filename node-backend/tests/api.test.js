import request from 'supertest';
import bcrypt from 'bcrypt';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';

let token;

beforeAll(async () => {
  // Wait for DB init and route mounting
  await ready;

  // Seed an admin user directly into DB
  const hash = await bcrypt.hash('password123', 10);
  await sequelize.models.User.destroy({ where: {}, truncate: true });
  await sequelize.models.User.create({ name: 'admin_test', role: 'admin', password_hash: hash });

  // Login to get a real token
  const res = await request(app)
    .post('/api/token')
    .send({ username: 'admin_test', password: 'password123' });
  expect(res.status).toBe(200);
  token = res.body.access_token;
});

afterAll(async () => {
  await sequelize.close();
});

describe('Auth', () => {
  it('returns 401 for unauthenticated /api/tickets', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });
});

describe('Registration Policy', () => {
  it('creates an account only when required identity fields and NHNE email are provided', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Jane',
        surname: 'Doe',
        scjId: '00361031-00803',
        email: 'jane.doe@nhne.org.za',
        password: 'StrongPassword1!',
      });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('Jane Doe');
    expect(res.body.name).toBe('Jane');
    expect(res.body.surname).toBe('Doe');
    expect(res.body.scjId).toBe('00361031-00803');

    const loginRes = await request(app)
      .post('/api/token')
      .send({ username: 'Jane Doe', password: 'StrongPassword1!' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty('access_token');

    const normalizedLoginRes = await request(app)
      .post('/api/token')
      .send({ username: '  jane doe  ', password: 'StrongPassword1!' });

    expect(normalizedLoginRes.status).toBe(200);
    expect(normalizedLoginRes.body).toHaveProperty('access_token');
  });

  it('rejects account creation for non-nhne email domains', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'John',
        surname: 'Smith',
        scjId: '00361031-00804',
        email: 'john.smith@example.com',
        password: 'StrongPassword1!',
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Email address must use the @nhne.org.za domain');
  });

  it('rejects weak passwords during account creation', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Jill',
        surname: 'Taylor',
        scjId: '00361031-00805',
        email: 'jill.taylor@nhne.org.za',
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
      .set('Authorization', `Bearer ${token}`)
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
  });

  it('lists users as admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Tickets', () => {
  it('creates a ticket', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Test Ticket',
        description: 'This is a test ticket body',
        priority: 'high',
        assigneeId: '00361031-09999',
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Ticket');
    expect(res.body.assigneeId).toBe('00361031-09999');
  });

  it('lists tickets', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('transitions lifecycle stage and stores collaboration artifacts', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Lifecycle Ticket',
        description: 'Incident lifecycle transition validation ticket',
        priority: 'critical',
        assigneeId: '00361031-09999',
      });
    expect(created.status).toBe(201);

    const ticketId = created.body.id;

    const moved = await request(app)
      .post(`/api/tickets/${ticketId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'triaged', note: 'Triaged during test' });
    expect(moved.status).toBe(200);
    expect(moved.body.lifecycleStage).toBe('triaged');

    const comment = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Initial triage note', visibility: 'internal' });
    expect(comment.status).toBe(201);

    const actionItem = await request(app)
      .post(`/api/tickets/${ticketId}/action-items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Collect endpoint forensic image', ownerScjId: '00361031-09999' });
    expect(actionItem.status).toBe(201);

    const comments = await request(app)
      .get(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${token}`);
    expect(comments.status).toBe(200);
    expect(Array.isArray(comments.body)).toBe(true);
    expect(comments.body.length).toBeGreaterThan(0);

    const items = await request(app)
      .get(`/api/tickets/${ticketId}/action-items`)
      .set('Authorization', `Bearer ${token}`);
    expect(items.status).toBe(200);
    expect(Array.isArray(items.body)).toBe(true);
    expect(items.body.length).toBeGreaterThan(0);
  });
});

describe('Reports, Governance, and Assistant', () => {
  it('returns executive metrics and reports', async () => {
    const metrics = await request(app)
      .get('/api/tickets/metrics/executive')
      .set('Authorization', `Bearer ${token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body).toHaveProperty('activeTickets');

    const impact = await request(app)
      .get('/api/security/executive-impact')
      .set('Authorization', `Bearer ${token}`);
    expect(impact.status).toBe(200);
    expect(impact.body).toHaveProperty('riskIndex');

    const executive = await request(app)
      .get('/api/reports/executive')
      .set('Authorization', `Bearer ${token}`);
    expect(executive.status).toBe(200);
    expect(executive.body).toHaveProperty('audience', 'executive');

    const technical = await request(app)
      .get('/api/reports/technical')
      .set('Authorization', `Bearer ${token}`);
    expect(technical.status).toBe(200);
    expect(technical.body).toHaveProperty('audience', 'technical');
  });

  it('returns command centre fortress posture telemetry', async () => {
    const res = await request(app)
      .get('/api/security/fortress/posture')
      .set('Authorization', `Bearer ${token}`);

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
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`);

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
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('exerciseStatus');
    expect(res.body).toHaveProperty('databasesReviewed');
    expect(res.body).toHaveProperty('remediationTasksCreated');
  });

  it('generates assistant triage and audit logs', async () => {
    const triage = await request(app)
      .post('/api/assistant/triage')
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`);
    expect(governance.status).toBe(200);
    expect(Array.isArray(governance.body)).toBe(true);
  });

  it('returns enriched assistant command-centre context', async () => {
    const res = await request(app)
      .get('/api/assistant/command-centre')
      .set('Authorization', `Bearer ${token}`);

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
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Assistant Tend Ticket',
        description: 'Validate one-click ticket tending workflow',
        priority: 'high',
        assigneeId: '00361031-09999',
      });
    expect(created.status).toBe(201);

    const tended = await request(app)
      .post('/api/assistant/tend-ticket')
      .set('Authorization', `Bearer ${token}`)
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
    const finding = await sequelize.models.SecurityFinding.create({
      sourceTool: 'jest-seed',
      detectionMode: 'passive',
      category: 'intrusion',
      severity: 'high',
      title: 'Assistant Tend Alert',
      description: 'Validate one-click alert tending workflow',
      fingerprint: `assistant-tend-alert-${Date.now()}`,
      status: 'new',
    });

    const tended = await request(app)
      .post('/api/assistant/tend-alert')
      .set('Authorization', `Bearer ${token}`)
      .send({
        findingId: finding.id,
        assigneeId: '00361031-09999',
      });

    expect(tended.status).toBe(200);
    expect(tended.body).toHaveProperty('tended', true);
    expect(tended.body).toHaveProperty('linkedTicketId');
    expect(tended.body.finding).toHaveProperty('status', 'investigating');
    expect(tended.body.linkedTicketId).not.toBeNull();

    const refreshed = await sequelize.models.SecurityFinding.findByPk(finding.id);
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
      .set('Authorization', `Bearer ${token}`);
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
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Patch App ${Date.now()}`,
        baseUrl: 'http://localhost:3001/health',
        environment: 'production',
      });
    expect(appAsset.status).toBe(201);

    const networkAsset = await request(app)
      .post('/api/security/network/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Patch Router ${Date.now()}`,
        deviceType: 'router',
        location: 'Core',
      });
    expect(networkAsset.status).toBe(201);

    const dbAsset = await request(app)
      .post('/api/security/database/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Patch DB ${Date.now()}`,
        engine: 'postgresql',
        environment: 'on_prem',
        host: '10.0.0.11',
      });
    expect(dbAsset.status).toBe(201);

    const patch1 = await request(app)
      .post('/api/security/patches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetType: 'application',
        assetId: appAsset.body.id,
        title: 'Upgrade OpenSSL package',
        severity: 'high',
      });
    expect(patch1.status).toBe(201);

    const patch2 = await request(app)
      .post('/api/security/patches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetType: 'network_device',
        assetId: networkAsset.body.id,
        title: 'Update router firmware',
        severity: 'critical',
      });
    expect(patch2.status).toBe(201);

    const patch3 = await request(app)
      .post('/api/security/patches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assetType: 'database_asset',
        assetId: dbAsset.body.id,
        title: 'Apply PostgreSQL security update',
        severity: 'high',
      });
    expect(patch3.status).toBe(201);

    const board = await request(app)
      .get('/api/security/patches')
      .set('Authorization', `Bearer ${token}`);
    expect(board.status).toBe(200);
    expect(board.body.summary.total).toBeGreaterThanOrEqual(3);
    expect(board.body.grouped.application.todo.length).toBeGreaterThan(0);
    expect(board.body.grouped.network_device.todo.length).toBeGreaterThan(0);
    expect(board.body.grouped.database_asset.todo.length).toBeGreaterThan(0);

    const moved = await request(app)
      .patch(`/api/security/patches/${patch2.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('in_progress');

    const completed = await request(app)
      .patch(`/api/security/patches/${patch3.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`);

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
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('accepted', true);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('status');
    expect(['queued', 'running']).toContain(res.body.status);

    const job = await request(app)
      .get(`/api/security/scan/jobs/${res.body.jobId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(job.status).toBe(200);
    expect(job.body).toHaveProperty('id', res.body.jobId);
    expect(job.body).toHaveProperty('mode', 'passive');
    expect(job.body).toHaveProperty('status');
  });
});