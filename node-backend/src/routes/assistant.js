import express from 'express';
import { body, validationResult } from 'express-validator';
import { Op } from 'sequelize';
import { buildAssignment5W1H, buildAssignmentGuidance, detectAssignmentDomain } from '../services/ticketAssist.js';

const router = express.Router();

function scoreUrgency({ priority, severity, businessImpactScore }) {
  const normalizedPriority = String(priority || severity || 'medium').toLowerCase();
  const priorityScore = normalizedPriority === 'critical'
    ? 95
    : normalizedPriority === 'high'
      ? 80
      : normalizedPriority === 'medium'
        ? 60
        : 35;

  const impact = Number(businessImpactScore);
  const impactScore = Number.isNaN(impact) ? 50 : Math.max(0, Math.min(100, impact));
  return Math.round((priorityScore * 0.65) + (impactScore * 0.35));
}

function confidenceFromInputs(input) {
  const signalCount = [
    input.title,
    input.description,
    input.priority,
    input.severity,
    input.businessImpactScore,
  ].filter(Boolean).length;

  if (signalCount >= 4) return 'high';
  if (signalCount >= 3) return 'medium';
  return 'low';
}

function severityRank(severity) {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  if (severity === 'low') return 1;
  return 0;
}

function summarizeTicket(ticket) {
  const guidance = buildAssignmentGuidance(ticket);
  const fiveW1H = buildAssignment5W1H(ticket, guidance, {
    assigneeScjId: ticket.assigneeId || null,
    coordinator: 'Cybersecurity Command Centre',
  });

  return {
    id: ticket.id,
    title: ticket.title,
    priority: ticket.priority,
    status: ticket.status,
    lifecycleStage: ticket.lifecycleStage,
    businessImpactScore: ticket.businessImpactScore,
    domain: detectAssignmentDomain(ticket),
    briefing5W1H: fiveW1H,
  };
}

export default ({ writeAudit, models, getPerformanceSnapshot }) => {
  const { Ticket, User, SecurityFinding, TicketActionItem } = models || {};

  router.get('/command-centre', async (req, res) => {
    if (!Ticket || !User || !SecurityFinding) {
      return res.status(500).json({ error: 'Assistant models not configured' });
    }

    const currentUser = await User.findByPk(req.user.sub);
    const assigneeId = currentUser?.scjId || null;

    const [openTickets, assignedTickets, activeFindings, recentFindings, actionItems, criticalFindings, highFindings] = await Promise.all([
      Ticket.count({ where: { status: { [Op.in]: ['open', 'in_progress'] } } }),
      assigneeId
        ? Ticket.findAll({
          where: { assigneeId, status: { [Op.in]: ['open', 'in_progress'] } },
          order: [['priority', 'DESC'], ['createdAt', 'DESC']],
          limit: 8,
        })
        : [],
      SecurityFinding.count({ where: { status: { [Op.in]: ['new', 'investigating'] } } }),
      SecurityFinding.findAll({
        where: { status: { [Op.in]: ['new', 'investigating'] } },
        order: [['createdAt', 'DESC']],
        limit: 15,
      }),
      TicketActionItem
        ? TicketActionItem.findAll({
          where: { status: { [Op.in]: ['open', 'blocked'] } },
          order: [['dueAt', 'ASC']],
          limit: 20,
        })
        : [],
      SecurityFinding.count({ where: { severity: 'critical', status: { [Op.in]: ['new', 'investigating'] } } }),
      SecurityFinding.count({ where: { severity: 'high', status: { [Op.in]: ['new', 'investigating'] } } }),
    ]);

    const prioritizedFindings = recentFindings
      .slice()
      .sort((a, b) => {
        const sev = severityRank(b.severity) - severityRank(a.severity);
        if (sev !== 0) return sev;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 5)
      .map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        status: f.status,
        category: f.category,
      }));

    const blockedActions = actionItems.filter((a) => a.status === 'blocked').length;
    const staleAlerts = recentFindings.filter((f) => {
      const createdAt = new Date(f.createdAt).getTime();
      return Number.isFinite(createdAt) && (Date.now() - createdAt) > (24 * 60 * 60 * 1000);
    }).length;
    const topAssigned = assignedTickets
      .slice()
      .sort((a, b) => {
        const sev = severityRank(b.priority) - severityRank(a.priority);
        if (sev !== 0) return sev;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .map(summarizeTicket);

    const fortressContext = {
      criticalFindings,
      highFindings,
      staleAlerts,
      blockedActions,
      activeFindings,
      incidentPressureScore: Math.min(100, (criticalFindings * 20) + (highFindings * 9) + (blockedActions * 7) + (staleAlerts * 6)),
    };

    const performanceSnapshot = typeof getPerformanceSnapshot === 'function'
      ? getPerformanceSnapshot()
      : { routes: [] };
    const slowRoutes = (performanceSnapshot?.routes || []).filter((r) => (r.p95Ms || 0) > 250).slice(0, 5);

    const priorityAction = prioritizedFindings[0]
      ? `Investigate ${prioritizedFindings[0].severity} finding #${prioritizedFindings[0].id} and confirm containment path.`
      : assignedTickets[0]
        ? `Advance ticket #${assignedTickets[0].id} to next lifecycle stage and update executive note.`
        : 'No urgent incidents detected; continue hunt and prevention routines.';

    await writeAudit(req, {
      entityType: 'assistant',
      entityId: 'command-centre',
      action: 'command_centre.snapshot',
      details: JSON.stringify({ openTickets, activeFindings, assigned: topAssigned.length }),
    });

    return res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        openTickets,
        activeFindings,
        assignedOpenTickets: topAssigned.length,
        blockedActions,
      },
      fortressContext,
      performanceContext: {
        sampleWindowPerRoute: performanceSnapshot?.sampleWindowPerRoute || 0,
        routesTracked: performanceSnapshot?.routesTracked || 0,
        slowRoutes,
      },
      priorityAction,
      assignedTickets: topAssigned,
      topFindings: prioritizedFindings,
      recommendations: [
        'Focus first on critical/high findings without linked tickets.',
        'Resolve blocked action items before opening new remediation work.',
        'Update lifecycle stage and executive notes immediately after containment changes.',
        slowRoutes.length > 0 ? `Coordinate with engineering to reduce API p95 hotspots. Top route: ${slowRoutes[0].method} ${slowRoutes[0].route} (${slowRoutes[0].p95Ms}ms).` : 'API performance remains within current sampled response budgets.',
      ],
    });
  });

  router.post(
    '/triage',
    body('title').isString().trim().isLength({ min: 3, max: 512 }),
    body('description').isString().trim().isLength({ min: 5, max: 5000 }),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('businessImpactScore').optional().isInt({ min: 0, max: 100 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const pseudoTicket = {
        id: 'draft',
        title: req.body.title,
        description: req.body.description,
        priority: req.body.priority || req.body.severity || 'medium',
        status: 'open',
      };

      const guidance = buildAssignmentGuidance(pseudoTicket);
      const urgencyScore = scoreUrgency(req.body);
      const confidence = confidenceFromInputs(req.body);
      const recommendedStage = urgencyScore >= 85 ? 'contained' : urgencyScore >= 65 ? 'triaged' : 'identified';

      await writeAudit(req, {
        entityType: 'assistant',
        entityId: 'triage',
        action: 'triage.generated',
        details: JSON.stringify({
          urgencyScore,
          confidence,
          issueType: guidance.issueType,
        }),
      });

      return res.json({
        urgencyScore,
        confidence,
        issueType: guidance.issueType,
        recommendedStage,
        summary: guidance.issueSummary,
        recommendedActions: guidance.possibleSolutions,
        plainLanguageBrief: 'The assistant analyzed the incident text and produced a prioritized triage path with immediate containment and remediation recommendations.',
      });
    },
  );

  router.post(
    '/analyze-ticket',
    body('ticketId').isInt(),
    body('notes').optional().isString().trim().isLength({ min: 3, max: 5000 }),
    async (req, res) => {
      if (!Ticket) return res.status(500).json({ error: 'Assistant models not configured' });

      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const ticket = await Ticket.findByPk(Number(req.body.ticketId));
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

      const guidance = buildAssignmentGuidance(ticket);
      const urgencyScore = scoreUrgency({ priority: ticket.priority, businessImpactScore: ticket.businessImpactScore });
      const nextStage = ticket.lifecycleStage === 'identified'
        ? 'triaged'
        : ticket.lifecycleStage === 'triaged'
          ? 'contained'
          : ticket.lifecycleStage === 'contained'
            ? 'eradicated'
            : ticket.lifecycleStage === 'eradicated'
              ? 'recovered'
              : ticket.lifecycleStage;

      const productivityPlan = [
        `Update ticket #${ticket.id} lifecycle from ${ticket.lifecycleStage || 'identified'} to ${nextStage}.`,
        'Document one internal and one executive-facing note for current status.',
        'Assign or verify ownership for top remediation action item.',
      ];
      if (req.body.notes) {
        productivityPlan.push(`Incorporate analyst note into action plan: ${req.body.notes.slice(0, 220)}.`);
      }

      await writeAudit(req, {
        entityType: 'assistant',
        entityId: String(ticket.id),
        action: 'ticket.analysis_generated',
        details: JSON.stringify({ urgencyScore, nextStage, issueType: guidance.issueType }),
      });

      return res.json({
        ticket: summarizeTicket(ticket),
        urgencyScore,
        nextStage,
        issueType: guidance.issueType,
        summary: guidance.issueSummary,
        recommendedActions: guidance.possibleSolutions,
        productivityPlan,
        coaching: 'Focus on rapid containment, explicit ownership, and high-quality status updates to accelerate closure.',
      });
    },
  );

  router.post(
    '/tend-ticket',
    body('ticketId').isInt(),
    body('notes').optional().isString().trim().isLength({ min: 3, max: 5000 }),
    async (req, res) => {
      if (!Ticket) return res.status(500).json({ error: 'Assistant models not configured' });

      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const ticket = await Ticket.findByPk(Number(req.body.ticketId));
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

      const guidance = buildAssignmentGuidance(ticket);
      const previousStatus = ticket.status;
      const nextStatus = previousStatus === 'open' ? 'in_progress' : previousStatus;
      const nextStage = ticket.lifecycleStage === 'identified'
        ? 'triaged'
        : ticket.lifecycleStage === 'triaged'
          ? 'contained'
          : ticket.lifecycleStage;

      await ticket.update({
        status: nextStatus,
        lifecycleStage: nextStage,
        executiveSummary: ticket.executiveSummary || guidance.issueSummary,
      });

      let createdActionItem = null;
      if (TicketActionItem) {
        createdActionItem = await TicketActionItem.create({
          ticketId: ticket.id,
          title: `AI follow-up: ${guidance.possibleSolutions[0] || 'Validate containment and ownership'}`,
          ownerScjId: ticket.assigneeId || null,
          status: 'open',
        });
      }

      await writeAudit(req, {
        entityType: 'assistant',
        entityId: String(ticket.id),
        action: 'ticket.tended',
        details: JSON.stringify({
          previousStatus,
          nextStatus,
          nextStage,
          createdActionItemId: createdActionItem?.id || null,
        }),
      });

      return res.json({
        tended: true,
        ticket: summarizeTicket(ticket),
        actionSummary: `Ticket #${ticket.id} is now being actively tended by AI workflow.`,
        appliedChanges: {
          status: nextStatus,
          lifecycleStage: nextStage,
          actionItemCreated: Boolean(createdActionItem),
        },
        recommendedActions: guidance.possibleSolutions,
      });
    },
  );

  router.post(
    '/tend-alert',
    body('findingId').isInt(),
    body('assigneeId').optional().isString().trim().isLength({ min: 3, max: 14 }),
    async (req, res) => {
      if (!SecurityFinding || !Ticket) return res.status(500).json({ error: 'Assistant models not configured' });

      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const finding = await SecurityFinding.findByPk(Number(req.body.findingId));
      if (!finding) return res.status(404).json({ error: 'Finding not found' });

      const previousFindingStatus = finding.status;
      const nextFindingStatus = previousFindingStatus === 'new' ? 'investigating' : previousFindingStatus;
      if (previousFindingStatus === 'new') {
        await finding.update({ status: 'investigating' });
      }

      let linkedTicketId = finding.ticketId || null;
      if (!linkedTicketId) {
        const createdTicket = await Ticket.create({
          title: `AI Alert Response: ${finding.title}`,
          description: finding.description || 'Generated by AI tend-alert workflow.',
          priority: finding.severity === 'critical' ? 'critical' : finding.severity === 'high' ? 'high' : 'medium',
          status: 'open',
          lifecycleStage: 'identified',
          assigneeId: req.body.assigneeId || null,
          businessImpactScore: finding.severity === 'critical' ? 90 : finding.severity === 'high' ? 75 : 60,
          executiveSummary: `AI generated response ticket for finding #${finding.id}`,
        });
        linkedTicketId = createdTicket.id;
        await finding.update({ ticketId: createdTicket.id, autoTicketCreated: true });

        if (TicketActionItem) {
          await TicketActionItem.create({
            ticketId: createdTicket.id,
            title: `AI containment task for finding #${finding.id}`,
            ownerScjId: req.body.assigneeId || null,
            status: 'open',
          });
        }
      }

      await writeAudit(req, {
        entityType: 'assistant',
        entityId: String(finding.id),
        action: 'alert.tended',
        details: JSON.stringify({
          previousFindingStatus,
          findingStatus: nextFindingStatus,
          linkedTicketId,
        }),
      });

      return res.json({
        tended: true,
        finding: {
          id: finding.id,
          title: finding.title,
          severity: finding.severity,
          status: nextFindingStatus,
          ticketId: linkedTicketId,
        },
        actionSummary: `Alert #${finding.id} is now in AI-assisted response flow.`,
        linkedTicketId,
      });
    },
  );

  router.post(
    '/analyze-alert',
    body('findingId').isInt(),
    async (req, res) => {
      if (!SecurityFinding) return res.status(500).json({ error: 'Assistant models not configured' });

      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const finding = await SecurityFinding.findByPk(Number(req.body.findingId));
      if (!finding) return res.status(404).json({ error: 'Finding not found' });

      const urgencyScore = scoreUrgency({ priority: finding.severity, severity: finding.severity, businessImpactScore: 70 });
      const recommendedActions = [
        'Validate evidence integrity and confirm source telemetry quality.',
        'Check if related assets show matching indicators across IDS, flow, and endpoint tools.',
        'Link or create an incident ticket and assign owner with response SLA.',
      ];
      if (finding.severity === 'critical' || finding.severity === 'high') {
        recommendedActions.unshift('Initiate containment controls immediately (network isolation / ACL / IPS policy).');
      }

      await writeAudit(req, {
        entityType: 'assistant',
        entityId: String(finding.id),
        action: 'alert.analysis_generated',
        details: JSON.stringify({ urgencyScore, severity: finding.severity, category: finding.category }),
      });

      return res.json({
        finding: {
          id: finding.id,
          title: finding.title,
          severity: finding.severity,
          status: finding.status,
          category: finding.category,
        },
        urgencyScore,
        recommendedActions,
        interpretation: `This alert indicates a ${finding.severity} ${finding.category} risk and should be treated as ${urgencyScore >= 85 ? 'urgent containment' : 'priority triage'}.`,
      });
    },
  );

  return router;
};
