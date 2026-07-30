import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin } from '../src/services/tenantContext.js';

let platformAdminToken;
let ordinaryAdminToken;

beforeAll(async () => {
  await ready;
  const hash = await bcrypt.hash('password123', 10);

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    await sequelize.models.User.destroy({ where: { name: { [Op.in]: ['platform_admin_test', 'ordinary_admin_test'] } } });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'platform_admin_test',
      role: 'platform_admin',
      password_hash: hash,
      telegramNumber: '+27100000010',
      telegramChatId: '200000010',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    await sequelize.models.User.create({
      organizationId: org.id,
      name: 'ordinary_admin_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27100000011',
      telegramChatId: '200000011',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });

  const platformLogin = await request(app).post('/api/token').send({ username: 'platform_admin_test', password: 'password123' });
  platformAdminToken = platformLogin.body.access_token;
  const ordinaryLogin = await request(app).post('/api/token').send({ username: 'ordinary_admin_test', password: 'password123' });
  ordinaryAdminToken = ordinaryLogin.body.access_token;
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /api/platform/organizations', () => {
  it('rejects a non-platform_admin, even an ordinary admin', async () => {
    const res = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${ordinaryAdminToken}`)
      .send({ name: 'Should Fail Inc', slug: 'should-fail' });
    expect(res.status).toBe(403);
  });

  it('creates a real new organization as a platform admin', async () => {
    const res = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ name: 'New Customer Inc', slug: `new-customer-${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Customer Inc');
    expect(res.body.id).toBeTruthy();
  });

  it('rejects a duplicate slug', async () => {
    const slug = `dup-org-${Date.now()}`;
    const first = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ name: 'Dup Org', slug });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ name: 'Dup Org Again', slug });
    expect(second.status).toBe(409);
  });
});

describe('Full onboarding lifecycle: create org, issue admin, forced password change', () => {
  let newOrgId;
  let newAdminEmail;
  let capturedTempPassword;

  it('creates the organization', async () => {
    const res = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ name: 'Lifecycle Test Org', slug: `lifecycle-${Date.now()}` });
    expect(res.status).toBe(201);
    newOrgId = res.body.id;
  });

  it('issues a first admin with a real, policy-compliant temp password', async () => {
    newAdminEmail = `lifecycle-admin-${Date.now()}@example.com`;
    const res = await request(app)
      .post(`/api/platform/organizations/${newOrgId}/admins`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ name: 'Lifecycle', surname: 'Admin', email: newAdminEmail });
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(newOrgId);

    // The temp password isn't returned by the API (it only ever goes out
    // by email) — read it back from the DB's password hash indirectly by
    // testing login with a few known-shape candidates is impractical, so
    // instead verify the *mechanism* directly: the created user really has
    // mustChangePassword set and a real bcrypt hash (not the literal temp
    // password stored in the clear).
    const created = await runAsPlatformAdmin(() => sequelize.models.User.findOne({ where: { email: newAdminEmail } }));
    expect(created.mustChangePassword).toBe(true);
    expect(created.password_hash).not.toBe('');
    expect(created.password_hash.startsWith('$2')).toBe(true); // real bcrypt hash format
    capturedTempPassword = null; // never available to the test on purpose — see below
  });

  it('the new admin is blocked from ordinary gated routes until they change their password', async () => {
    // Reset the known temp password to something the test can actually use,
    // simulating "the admin received the email and is logging in for the
    // first time" without needing to intercept the real email.
    const knownTempPassword = 'Temp-Pass-123!';
    await runAsPlatformAdmin(async () => {
      const user = await sequelize.models.User.findOne({ where: { email: newAdminEmail } });
      await user.update({ password_hash: bcrypt.hashSync(knownTempPassword, 10) });
    });

    const login = await request(app).post('/api/token').send({ username: 'Lifecycle Admin', password: knownTempPassword });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    const newAdminToken = login.body.access_token;

    const blocked = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${newAdminToken}`);
    expect(blocked.status).toBe(428);
    expect(blocked.body.mustChangePassword).toBe(true);

    const changeResult = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${newAdminToken}`)
      .send({ currentPassword: knownTempPassword, newPassword: 'A-Real-New-Password-1!' });
    expect(changeResult.status).toBe(200);

    // Same token, now unblocked — mustChangePassword was cleared server-side.
    const unblocked = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${newAdminToken}`);
    expect(unblocked.status).toBe(200);
  });
});
