import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';
import { checkSlaBreaches } from '../src/services/slaEnforcement.js';

let orgId;
let assigneeScjId;

beforeAll(async () => {
  await ready;
  await runAsPlatformAdmin(async () => {
    const org = await sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } });
    orgId = org.id;
    await sequelize.models.User.destroy({ where: { name: 'sla_test_analyst' } });
    const hash = await bcrypt.hash('password123', 10);
    const analyst = await sequelize.models.User.create({
      organizationId: org.id,
      name: 'sla_test_analyst',
      role: 'analyst',
      password_hash: hash,
      telegramNumber: '+27100000300',
      telegramChatId: '200000300',
      scjId: '00361031-00950',
      audienceCode: 'TJN',
      operationalTeams: ['Network'],
      department: 'Networks',
    });
    assigneeScjId = analyst.scjId;
  });
});

afterAll(async () => {
  await sequelize.close();
});

const models = () => ({
  Ticket: sequelize.models.Ticket,
  TicketHistory: sequelize.models.TicketHistory,
  User: sequelize.models.User,
  AuditLog: sequelize.models.AuditLog,
});

describe('checkSlaBreaches', () => {
  it('flags an overdue open ticket, records it in the timeline, audits it, and notifies once', async () => {
    const ticket = await runWithOrganization(orgId, () => sequelize.models.Ticket.create({
      organizationId: orgId,
      title: 'SLA test — overdue open ticket',
      description: 'test ticket',
      priority: 'high',
      status: 'open',
      slaDueAt: new Date(Date.now() - 60 * 60 * 1000), // an hour overdue
      assigneeId: assigneeScjId,
    }));

    const notify = jest.fn().mockResolvedValue(undefined);
    const result = await runWithOrganization(orgId, () => checkSlaBreaches({ models: models(), notify }));

    expect(result.breached).toBeGreaterThanOrEqual(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      ticket: expect.objectContaining({ id: ticket.id }),
      assignee: expect.objectContaining({ scjId: assigneeScjId }),
    }));

    const refreshed = await runWithOrganization(orgId, () => sequelize.models.Ticket.findByPk(ticket.id));
    expect(refreshed.breachedSla).toBe(true);

    const historyRow = await runWithOrganization(orgId, () => sequelize.models.TicketHistory.findOne({
      where: { ticketId: ticket.id, eventType: 'sla_breached' },
    }));
    expect(historyRow).toBeTruthy();

    const auditRow = await runAsPlatformAdmin(() => sequelize.models.AuditLog.findOne({
      where: { entityType: 'ticket', entityId: String(ticket.id), action: 'ticket.sla_breached' },
    }));
    expect(auditRow).toBeTruthy();
    expect(auditRow.actor).toBe('scheduler');
  });

  it('does not re-notify a ticket that was already flagged as breached', async () => {
    const ticket = await runWithOrganization(orgId, () => sequelize.models.Ticket.create({
      organizationId: orgId,
      title: 'SLA test — already flagged',
      description: 'test ticket',
      priority: 'medium',
      status: 'open',
      slaDueAt: new Date(Date.now() - 60 * 60 * 1000),
      breachedSla: true,
    }));

    const notify = jest.fn().mockResolvedValue(undefined);
    await runWithOrganization(orgId, () => checkSlaBreaches({ models: models(), notify }));

    const notifiedThisTicket = notify.mock.calls.some(([arg]) => arg.ticket.id === ticket.id);
    expect(notifiedThisTicket).toBe(false);
  });

  it('ignores overdue tickets that are already resolved or closed', async () => {
    const ticket = await runWithOrganization(orgId, () => sequelize.models.Ticket.create({
      organizationId: orgId,
      title: 'SLA test — resolved, should not breach',
      description: 'test ticket',
      priority: 'low',
      status: 'resolved',
      slaDueAt: new Date(Date.now() - 60 * 60 * 1000),
    }));

    const notify = jest.fn().mockResolvedValue(undefined);
    await runWithOrganization(orgId, () => checkSlaBreaches({ models: models(), notify }));

    const notifiedThisTicket = notify.mock.calls.some(([arg]) => arg.ticket.id === ticket.id);
    expect(notifiedThisTicket).toBe(false);

    const refreshed = await runWithOrganization(orgId, () => sequelize.models.Ticket.findByPk(ticket.id));
    expect(refreshed.breachedSla).toBe(false);
  });
});
