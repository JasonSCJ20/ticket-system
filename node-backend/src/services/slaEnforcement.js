import { Op } from 'sequelize';

// Tickets have always tracked an SLA due date, but nothing ever acted on one
// being missed — breachedSla only updated as a side effect of a human
// editing that specific ticket, so an overdue ticket could sit unnoticed
// indefinitely. Called on a schedule (see app.js): finds every ticket whose
// SLA has just passed without having been flagged yet, marks it, records it
// in the ticket's own timeline, audits it, and notifies exactly once — the
// `breachedSla: false` filter below prevents re-notifying on every
// subsequent sweep once a ticket has already been flagged.
export async function checkSlaBreaches({ models, notify }) {
  const { Ticket, TicketHistory, User, AuditLog } = models;
  const now = new Date();

  const overdue = await Ticket.findAll({
    where: {
      slaDueAt: { [Op.lt]: now },
      status: { [Op.notIn]: ['resolved', 'closed'] },
      breachedSla: false,
    },
  });

  for (const ticket of overdue) {
    await ticket.update({ breachedSla: true });

    await TicketHistory.create({
      ticketId: ticket.id,
      eventType: 'sla_breached',
      reason: `SLA due ${ticket.slaDueAt.toISOString()} was missed`,
    });

    const assignee = ticket.assigneeId ? await User.findOne({ where: { scjId: ticket.assigneeId } }) : null;
    await notify({ ticket, assignee });

    await AuditLog.create({
      entityType: 'ticket',
      entityId: String(ticket.id),
      actor: 'scheduler',
      actorRole: 'system',
      action: 'ticket.sla_breached',
      ipAddress: null,
      details: JSON.stringify({ slaDueAt: ticket.slaDueAt, priority: ticket.priority }),
    });
  }

  return { breached: overdue.length };
}
