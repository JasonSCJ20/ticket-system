import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import app, { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';

let orgId;
let analystToken;
let analystUser;
let soleAdminToken;

beforeAll(async () => {
  await ready;
  const hash = await bcrypt.hash('password123', 10);

  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    orgId = org.id;
    await sequelize.models.User.destroy({ where: { name: { [Op.in]: ['gdpr_analyst_test', 'gdpr_admin_a_test'] } } });
    analystUser = await sequelize.models.User.create({
      organizationId: org.id,
      name: 'gdpr_analyst_test',
      role: 'analyst',
      password_hash: hash,
      email: 'gdpr-analyst-test@example.com',
      telegramNumber: '+27100000200',
      telegramChatId: '200000200',
      scjId: '00361031-00900',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });

  const login = await request(app).post('/api/token').send({ username: 'gdpr_analyst_test', password: 'password123' });
  expect(login.status).toBe(200);
  analystToken = login.body.access_token;

  // A dedicated single-admin org proves the "can't delete the last admin"
  // guard without touching the shared default org's real admin fixtures.
  await runAsPlatformAdmin(async () => {
    const soleOrg = await sequelize.models.Organization.create({ name: 'GDPR Sole Admin Org', slug: `gdpr-sole-admin-${Date.now()}` });
    await sequelize.models.User.create({
      organizationId: soleOrg.id,
      name: 'gdpr_admin_a_test',
      role: 'admin',
      password_hash: hash,
      telegramNumber: '+27100000201',
      telegramChatId: '200000201',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
  });
  const soleAdminLogin = await request(app).post('/api/token').send({ username: 'gdpr_admin_a_test', password: 'password123' });
  expect(soleAdminLogin.status).toBe(200);
  soleAdminToken = soleAdminLogin.body.access_token;
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/me/export', () => {
  it('includes tickets, comments, patch tasks, and audit log entries tied to the requesting user, but never credential fields', async () => {
    const asset = await runWithOrganization(orgId, () => sequelize.models.ApplicationAsset.create({
      name: `GDPR export test asset ${Date.now()}`,
      baseUrl: 'https://gdpr-export-test.example',
      environment: 'production',
    }));

    await runWithOrganization(orgId, async () => {
      await sequelize.models.Ticket.create({
        organizationId: orgId,
        title: 'Created by the exporting analyst',
        description: 'test ticket',
        creatorId: analystUser.id,
      });
      await sequelize.models.Ticket.create({
        organizationId: orgId,
        title: 'Assigned to the exporting analyst',
        description: 'test ticket',
        assigneeId: analystUser.scjId,
      });
      const commentedTicket = await sequelize.models.Ticket.create({
        organizationId: orgId,
        title: 'Has a comment from the exporting analyst',
        description: 'test ticket',
      });
      await sequelize.models.TicketComment.create({
        organizationId: orgId,
        ticketId: commentedTicket.id,
        authorName: 'gdpr_analyst_test',
        message: 'a real comment',
      });
      await sequelize.models.PatchTask.create({
        organizationId: orgId,
        assetType: 'application',
        assetId: asset.id,
        assetName: asset.name,
        title: 'Patch created by the exporting analyst',
        createdBy: 'gdpr_analyst_test',
      });
    });

    const res = await request(app)
      .get('/api/me/export')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe('gdpr_analyst_test');
    expect(res.body.profile.password_hash).toBeUndefined();
    expect(res.body.profile.mfaSecret).toBeUndefined();

    expect(res.body.ticketsCreated.some((t) => t.title === 'Created by the exporting analyst')).toBe(true);
    expect(res.body.ticketsAssigned.some((t) => t.title === 'Assigned to the exporting analyst')).toBe(true);
    expect(res.body.ticketComments.some((c) => c.message === 'a real comment')).toBe(true);
    expect(res.body.patchTasksCreated.some((p) => p.title === 'Patch created by the exporting analyst')).toBe(true);

    // The export request itself is now a real, checkable audit event.
    const exportAudit = await runAsPlatformAdmin(() => sequelize.models.AuditLog.findOne({
      where: { action: 'user.data_exported', actor: 'gdpr_analyst_test' },
    }));
    expect(exportAudit).toBeTruthy();
  });
});

describe('DELETE /api/me', () => {
  it('rejects an incorrect current password', async () => {
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ currentPassword: 'definitely-wrong' });
    expect(res.status).toBe(401);
  });

  it('blocks the sole admin of an organization from deleting their own account', async () => {
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${soleAdminToken}`)
      .send({ currentPassword: 'password123' });
    expect(res.status).toBe(409);
  });

  it('anonymizes the account, logs the deletion, and revokes the current session', async () => {
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ currentPassword: 'password123' });
    expect(res.status).toBe(200);

    const scrubbed = await runAsPlatformAdmin(() => sequelize.models.User.findByPk(analystUser.id));
    expect(scrubbed.name).toBe('Deleted user');
    expect(scrubbed.email).toBeNull();
    expect(scrubbed.username).toBeNull();
    expect(scrubbed.password_hash).toBeNull();

    const deletionAudit = await runAsPlatformAdmin(() => sequelize.models.AuditLog.findOne({
      where: { action: 'user.self_deleted', actor: 'gdpr_analyst_test' },
    }));
    expect(deletionAudit).toBeTruthy();

    // Same token that just deleted the account must no longer work.
    const revoked = await request(app)
      .get('/api/me/export')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(revoked.status).toBe(401);
  });
});
