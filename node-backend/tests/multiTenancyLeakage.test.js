import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { extractAuthCookie } from './helpers/authCookie.js';

// The definitive proof for Phase 1 multi-tenancy: two REAL organizations,
// created the same way any two customers would end up isolated, exercised
// entirely through real HTTP requests (not direct model calls) — the same
// path an actual customer's browser would take. If organization A can see
// organization B's data through any of these, tenant scoping has failed in
// the one way that actually matters.

let orgAToken;
let orgBToken;
let orgAAssetId;
let orgBAssetId;

beforeAll(async () => {
  await ready;
  const hash = await bcrypt.hash('password123', 10);

  await runAsPlatformAdmin(async () => {
    await sequelize.models.User.destroy({ where: { name: { [Op.in]: ['org-a-admin', 'org-b-admin'] } } });
    await sequelize.models.Organization.destroy({ where: { slug: { [Op.in]: ['tenant-a', 'tenant-b'] } } });

    const orgA = await sequelize.models.Organization.create({ name: 'Tenant A Inc', slug: 'tenant-a' });
    const orgB = await sequelize.models.Organization.create({ name: 'Tenant B Inc', slug: 'tenant-b' });
    // Deliberately NOT pre-creating a SecurityState row for either org here
    // — this test exercises fortressKillSwitch.js's getState() self-healing
    // via findOrCreate, since nothing auto-provisions a new organization's
    // SecurityState row yet (there's no real org-onboarding route in this
    // phase).

    await sequelize.models.User.create({
      organizationId: orgA.id,
      name: 'org-a-admin',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27100000001',
      telegramChatId: '200000001',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    await sequelize.models.User.create({
      organizationId: orgB.id,
      name: 'org-b-admin',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27100000002',
      telegramChatId: '200000002',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });

    const orgAAsset = await runWithOrganization(orgA.id, () => sequelize.models.ApplicationAsset.create({
      name: 'tenant-a-secret-asset',
      baseUrl: 'https://tenant-a.test',
      environment: 'production',
      enabled: true,
    }));
    orgAAssetId = orgAAsset.id;

    const orgBAsset = await runWithOrganization(orgB.id, () => sequelize.models.ApplicationAsset.create({
      name: 'tenant-b-secret-asset',
      baseUrl: 'https://tenant-b.test',
      environment: 'production',
      enabled: true,
    }));
    orgBAssetId = orgBAsset.id;

    await runWithOrganization(orgA.id, () => sequelize.models.SecurityFinding.create({
      applicationAssetId: orgAAssetId,
      sourceTool: 'Test',
      detectionMode: 'active',
      category: 'vulnerability',
      severity: 'critical',
      title: 'Tenant A confidential finding',
      description: 'x',
      requiresManualConfirmation: true,
    }));
    await runWithOrganization(orgB.id, () => sequelize.models.SecurityFinding.create({
      applicationAssetId: orgBAssetId,
      sourceTool: 'Test',
      detectionMode: 'active',
      category: 'vulnerability',
      severity: 'critical',
      title: 'Tenant B confidential finding',
      description: 'x',
      requiresManualConfirmation: true,
    }));

    await runWithOrganization(orgA.id, () => sequelize.models.Ticket.create({
      title: 'Tenant A confidential ticket',
      description: 'x',
      priority: 'high',
    }));
    await runWithOrganization(orgB.id, () => sequelize.models.Ticket.create({
      title: 'Tenant B confidential ticket',
      description: 'x',
      priority: 'high',
    }));
  });

  const loginA = await request(app).post('/api/token').send({ username: 'org-a-admin', password: 'password123' });
  orgAToken = extractAuthCookie(loginA);
  const loginB = await request(app).post('/api/token').send({ username: 'org-b-admin', password: 'password123' });
  orgBToken = extractAuthCookie(loginB);
});

afterAll(async () => {
  await sequelize.close();
});

describe('Multi-tenancy: cross-organization data isolation (real HTTP, real orgs)', () => {
  it('tenant A cannot see tenant B\'s assets in GET /applications', async () => {
    const res = await request(app).get('/api/security/applications').set('Cookie', orgAToken);
    expect(res.status).toBe(200);
    const names = res.body.map((a) => a.name);
    expect(names).toContain('tenant-a-secret-asset');
    expect(names).not.toContain('tenant-b-secret-asset');
  });

  it('tenant B cannot see tenant A\'s assets in GET /applications', async () => {
    const res = await request(app).get('/api/security/applications').set('Cookie', orgBToken);
    expect(res.status).toBe(200);
    const names = res.body.map((a) => a.name);
    expect(names).toContain('tenant-b-secret-asset');
    expect(names).not.toContain('tenant-a-secret-asset');
  });

  it('tenant A cannot fetch tenant B\'s asset directly by ID', async () => {
    // Confirms the isolation is enforced by organizationId, not merely by
    // omission from a list — directly requesting the other tenant's known
    // asset id must not resolve, exactly like it doesn't exist.
    const res = await request(app)
      .get(`/api/security/applications/${orgBAssetId}/enforcement-status`)
      .set('Cookie', orgAToken);
    expect([403, 404]).toContain(res.status);
  });

  it('tenant A cannot see tenant B\'s findings in GET /findings', async () => {
    const res = await request(app).get('/api/security/findings').set('Cookie', orgAToken);
    expect(res.status).toBe(200);
    const titles = res.body.map((f) => f.title);
    expect(titles).toContain('Tenant A confidential finding');
    expect(titles).not.toContain('Tenant B confidential finding');
  });

  it('tenant B cannot see tenant A\'s findings in GET /findings', async () => {
    const res = await request(app).get('/api/security/findings').set('Cookie', orgBToken);
    expect(res.status).toBe(200);
    const titles = res.body.map((f) => f.title);
    expect(titles).toContain('Tenant B confidential finding');
    expect(titles).not.toContain('Tenant A confidential finding');
  });

  it('tenant A cannot see tenant B\'s tickets in GET /tickets', async () => {
    const res = await request(app).get('/api/tickets').set('Cookie', orgAToken);
    expect(res.status).toBe(200);
    const titles = res.body.map((t) => t.title);
    expect(titles).toContain('Tenant A confidential ticket');
    expect(titles).not.toContain('Tenant B confidential ticket');
  });

  it('each tenant has its own independent Fortress security state (lockdown does not cross tenants)', async () => {
    const lockdownA = await request(app)
      .post('/api/security/fortress/kill-switch/lockdown')
      .set('Cookie', orgAToken)
      .send({ active: true, reason: 'tenant A test lockdown' });
    expect(lockdownA.status).toBe(200);
    expect(lockdownA.body.lockdownActive).toBe(true);

    // Tenant B's own status must be completely unaffected by tenant A's lockdown.
    const statusB = await request(app)
      .get('/api/security/fortress/kill-switch/status')
      .set('Cookie', orgBToken);
    expect(statusB.status).toBe(200);
    expect(statusB.body.lockdownActive).toBe(false);

    // Clean up tenant A's lockdown so it doesn't affect any other test file.
    await request(app)
      .post('/api/security/fortress/kill-switch/lockdown')
      .set('Cookie', orgAToken)
      .send({ active: false });
  });

  // The routes backed by readAnalyticsCache/writeAnalyticsCache (network
  // visibility, health summary, fortress posture, threat intel, database
  // overview) used to cache under a bare string key with no tenant
  // component at all — meaning tenant B's request, made shortly after
  // tenant A's, could receive tenant A's cached response verbatim within
  // the cache TTL. Calling A then B back-to-back (well inside the 12s TTL)
  // is exactly the scenario that would have leaked before the cache key
  // was scoped to the requester's own tenant context.
  it('the analytics cache never serves one tenant\'s cached response to another', async () => {
    const resA = await request(app).get('/api/security/network-visibility/overview').set('Cookie', orgAToken);
    expect(resA.status).toBe(200);
    const appsA = resA.body.perApplication.map((a) => a.applicationName);
    expect(appsA).toContain('tenant-a-secret-asset');
    expect(appsA).not.toContain('tenant-b-secret-asset');

    const resB = await request(app).get('/api/security/network-visibility/overview').set('Cookie', orgBToken);
    expect(resB.status).toBe(200);
    const appsB = resB.body.perApplication.map((a) => a.applicationName);
    expect(appsB).toContain('tenant-b-secret-asset');
    expect(appsB).not.toContain('tenant-a-secret-asset');
  });
});
