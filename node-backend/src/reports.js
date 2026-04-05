// Import Sequelize operators
import { Op } from 'sequelize';
// Import configuration
import { CONFIG } from './config.js';
// Import Telegram functions
import { sendTelegramMessage, ticketText } from './telegram.js';

// Function to generate monthly ticket summary
export async function monthlySummary(reportDate, Ticket) {
  // Calculate date 30 days ago
  const monthAgo = new Date(reportDate);
  monthAgo.setDate(monthAgo.getDate() - 30);

  // Count total tickets
  const total = await Ticket.count();
  // Count tickets created in last 30 days
  const created = await Ticket.count({ where: { createdAt: { [Op.gte]: monthAgo } } });
  // Count closed tickets
  const closed = await Ticket.count({ where: { status: 'closed' } });

  // Return summary object
  return { total, created, closed };
}

// Function to send monthly report via Telegram
export async function sendMonthlyReport(Ticket) {
  // Skip if no chat ID configured
  if (!CONFIG.MONTHLY_REPORT_CHAT_ID) return;

  // Get summary data
  const summary = await monthlySummary(new Date(), Ticket);
  // Format report text in Markdown
  const text = `*Monthly Cybersecurity Ticket Report*\nTotal tickets: ${summary.total}\nCreated last 30 days: ${summary.created}\nClosed total: ${summary.closed}`;
  // Send message to configured chat
  sendTelegramMessage(CONFIG.MONTHLY_REPORT_CHAT_ID, text, { parse_mode: 'Markdown' });
}

export async function executiveReport(models) {
  const { Ticket, SecurityFinding } = models;
  const [totalTickets, activeTickets, criticalOpen, findingsNew, findingsInvestigating, resolvedThisMonth] = await Promise.all([
    Ticket.count(),
    Ticket.count({ where: { status: { [Op.in]: ['open', 'in_progress'] } } }),
    Ticket.count({ where: { status: { [Op.in]: ['open', 'in_progress'] }, priority: 'critical' } }),
    SecurityFinding.count({ where: { status: 'new' } }),
    SecurityFinding.count({ where: { status: 'investigating' } }),
    Ticket.count({
      where: {
        status: { [Op.in]: ['resolved', 'closed'] },
        resolvedAt: { [Op.gte]: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)) },
      },
    }),
  ]);

  const riskIndex = Math.min(100, (criticalOpen * 12) + (findingsNew * 5) + (findingsInvestigating * 3));
  return {
    audience: 'executive',
    headline: riskIndex >= 75
      ? 'Cyber risk is elevated and needs immediate steering decisions.'
      : riskIndex >= 45
        ? 'Cyber risk is manageable but requires close monitoring.'
        : 'Cyber risk is currently within controlled tolerance.',
    riskIndex,
    posture: riskIndex >= 75 ? 'high-risk' : riskIndex >= 45 ? 'watch' : 'controlled',
    metrics: {
      totalTickets,
      activeTickets,
      criticalOpen,
      findingsNew,
      findingsInvestigating,
      resolvedThisMonth,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function technicalReport(models) {
  const { Ticket, SecurityFinding, TicketActionItem, TicketComment } = models;

  const [openByPriority, findingsBySeverity, lifecycleSpread, overdueActions, collaborationSignals] = await Promise.all([
    Promise.all(['low', 'medium', 'high', 'critical'].map(async (priority) => [
      priority,
      await Ticket.count({ where: { priority, status: { [Op.in]: ['open', 'in_progress'] } } }),
    ])),
    Promise.all(['low', 'medium', 'high', 'critical'].map(async (severity) => [
      severity,
      await SecurityFinding.count({ where: { severity, status: { [Op.in]: ['new', 'investigating'] } } }),
    ])),
    Promise.all(['identified', 'triaged', 'contained', 'eradicated', 'recovered', 'postmortem', 'closed'].map(async (stage) => [
      stage,
      await Ticket.count({ where: { lifecycleStage: stage } }),
    ])),
    TicketActionItem.count({ where: { status: { [Op.ne]: 'done' }, dueAt: { [Op.lt]: new Date() } } }),
    Promise.all([
      TicketComment.count({ where: { visibility: 'internal' } }),
      TicketComment.count({ where: { visibility: 'executive' } }),
    ]),
  ]);

  return {
    audience: 'technical',
    openByPriority: Object.fromEntries(openByPriority),
    findingsBySeverity: Object.fromEntries(findingsBySeverity),
    lifecycleSpread: Object.fromEntries(lifecycleSpread),
    overdueActions,
    collaboration: {
      internalNotes: collaborationSignals[0],
      executiveNotes: collaborationSignals[1],
    },
    generatedAt: new Date().toISOString(),
  };
}
