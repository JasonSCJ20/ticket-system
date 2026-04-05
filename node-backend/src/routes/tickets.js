// Import Express router
import express from 'express';
// Import validation middleware
import { body, param, query, validationResult } from 'express-validator';

// Create router instance
const router = express.Router();
const SCJ_ID_REGEX = /^\d{8}-\d{5}$/;
const LIFECYCLE_STAGES = ['identified', 'triaged', 'contained', 'eradicated', 'recovered', 'postmortem', 'closed'];
const STAGE_TO_STATUS = {
  identified: 'open',
  triaged: 'in_progress',
  contained: 'in_progress',
  eradicated: 'in_progress',
  recovered: 'resolved',
  postmortem: 'resolved',
  closed: 'closed',
};

function computeSlaDueAt(priority) {
  const now = Date.now();
  const hours = priority === 'critical'
    ? 4
    : priority === 'high'
      ? 8
      : priority === 'medium'
        ? 24
        : 72;
  return new Date(now + hours * 60 * 60 * 1000);
}

function lifecycleTimestampPatch(stage) {
  const now = new Date();
  if (stage === 'triaged') return { triagedAt: now };
  if (stage === 'contained') return { containedAt: now };
  if (stage === 'eradicated') return { eradicatedAt: now };
  if (stage === 'recovered') return { recoveredAt: now, resolvedAt: now };
  if (stage === 'postmortem') return { postmortemAt: now };
  if (stage === 'closed') return { closedAt: now };
  return {};
}

// Export factory function that takes models and notify function
export default (models, notify) => {
  const { notifyTicket, sendAssignmentGuidance, sendResolutionReport, writeAudit } = notify;
  // Destructure models
  const { Ticket, User, TicketResolutionReport, TicketComment, TicketActionItem } = models;

  const adminOnly = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };

  const scopedActor = (req) => req.user?.username || 'system';

  const writeTicketAudit = async (req, ticketId, action, details = null) => {
    if (!writeAudit) return;
    await writeAudit(req, {
      entityType: 'ticket',
      entityId: String(ticketId),
      action,
      details,
    });
  };

  // GET /api/tickets - List all tickets with assignee info
  router.get('/',
    query('status').optional().isIn(['open', 'in_progress', 'resolved', 'closed']),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    query('lifecycleStage').optional().isIn(LIFECYCLE_STAGES),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.priority) where.priority = req.query.priority;
      if (req.query.lifecycleStage) where.lifecycleStage = req.query.lifecycleStage;

    // Fetch all tickets including assignee relationship
      const tickets = await Ticket.findAll({
        where,
        include: [{ model: User, as: 'assignee' }],
        order: [['createdAt', 'DESC']],
      });
    // Return tickets as JSON
      res.json(tickets);
    });

  router.get('/metrics/executive', async (_req, res) => {
    const tickets = await Ticket.findAll();
    const active = tickets.filter((t) => ['open', 'in_progress'].includes(t.status));
    const now = new Date();

    const breached = active.filter((t) => t.slaDueAt && new Date(t.slaDueAt) < now).length;
    const criticalOpen = active.filter((t) => t.priority === 'critical').length;
    const postmortemOpen = active.filter((t) => t.lifecycleStage === 'postmortem').length;

    const resolvedDurationsHours = tickets
      .filter((t) => t.resolvedAt)
      .map((t) => (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 36e5)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const mttrHours = resolvedDurationsHours.length
      ? Number((resolvedDurationsHours.reduce((a, b) => a + b, 0) / resolvedDurationsHours.length).toFixed(2))
      : null;

    const avgBusinessImpact = tickets.length
      ? Number((tickets.reduce((acc, t) => acc + (Number(t.businessImpactScore) || 0), 0) / tickets.length).toFixed(1))
      : 0;

    return res.json({
      totalTickets: tickets.length,
      activeTickets: active.length,
      criticalOpen,
      slaBreached: breached,
      mttrHours,
      avgBusinessImpact,
      postmortemOpen,
      generatedAt: new Date().toISOString(),
    });
  });

  // POST /api/tickets - Create new ticket with validation
  router.post('/',
    // Validate title: string, trimmed, length 5-512, escaped
    body('title').isString().trim().isLength({ min: 5, max: 512 }).escape(),
    // Validate description: string, trimmed, length 10-2000, escaped
    body('description').isString().trim().isLength({ min: 10, max: 2000 }).escape(),
    // Validate priority: must be one of the allowed values
    body('priority').isString().isIn(['low', 'medium', 'high', 'critical']),
    body('businessImpactScore').optional().isInt({ min: 0, max: 100 }),
    body('executiveSummary').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    body('impactedServices').optional().isString().trim().isLength({ min: 3, max: 2000 }),
    body('governanceTags').optional().isArray({ max: 20 }),
    // Validate assigneeId (SCJ ID format)
    body('assigneeId').optional().isString().trim().matches(SCJ_ID_REGEX),
    // Validate creatorId: optional integer
    body('creatorId').optional().isInt(),
    async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      // Extract validated data
      const { title, description, priority, assigneeId, creatorId } = req.body;

      if (assigneeId) {
        const assignee = await User.findOne({ where: { scjId: assigneeId } });
        if (!assignee) {
          return res.status(422).json({ error: 'Assignee SCJ ID not found' });
        }
      }

      // Create ticket in database
      const ticket = await Ticket.create({
        title,
        description,
        priority,
        assigneeId,
        creatorId,
        lifecycleStage: 'identified',
        slaDueAt: computeSlaDueAt(priority),
        businessImpactScore: req.body.businessImpactScore || 50,
        executiveSummary: req.body.executiveSummary || null,
        impactedServices: req.body.impactedServices || null,
        governanceTags: Array.isArray(req.body.governanceTags) ? req.body.governanceTags : [],
      });
      // Add history entry
      await models.TicketHistory.create({ ticketId: ticket.id, eventType: 'created', reason: 'Created by API' });
      await writeTicketAudit(req, ticket.id, 'ticket.created', JSON.stringify({ priority, assigneeId: assigneeId || null }));
      // Notify assignee
      await notifyTicket(ticket, 'created');
      await sendAssignmentGuidance(ticket);
      // Return created ticket with 201 status
      res.status(201).json(ticket);
    }
  );

  // PATCH /api/tickets/:id - Update ticket with validation
  router.patch('/:id',
    // Validate ID parameter: must be integer
    param('id').isInt(),
    // Validate optional title
    body('title').optional().isString().trim().isLength({ min: 5, max: 512 }).escape(),
    // Validate optional description
    body('description').optional().isString().trim().isLength({ min: 10, max: 2000 }).escape(),
    // Validate optional priority
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    // Validate optional status
    body('status').optional().isIn(['open', 'in_progress', 'resolved', 'closed']),
    body('lifecycleStage').optional().isIn(LIFECYCLE_STAGES),
    body('businessImpactScore').optional().isInt({ min: 0, max: 100 }),
    body('executiveSummary').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    body('impactedServices').optional().isString().trim().isLength({ min: 3, max: 2000 }),
    body('governanceTags').optional().isArray({ max: 20 }),
    body('slaDueAt').optional().isISO8601(),
    // Validate optional assigneeId (SCJ format)
    body('assigneeId').optional().isString().trim().matches(SCJ_ID_REGEX),
    body('resolutionNotes').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    body('rootCause').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    body('actionsTaken').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    body('preventiveActions').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      // Find ticket by ID
      const ticket = await Ticket.findByPk(req.params.id);
      // Return 404 if not found
      if (!ticket) return res.status(404).json({ error: 'Not found' });

      const previousStatus = ticket.status;
      const previousAssignee = ticket.assigneeId;

      if (req.body.assigneeId) {
        const assignee = await User.findOne({ where: { scjId: req.body.assigneeId } });
        if (!assignee) {
          return res.status(422).json({ error: 'Assignee SCJ ID not found' });
        }
      }

      const stage = req.body.lifecycleStage;
      const stagePayload = stage ? lifecycleTimestampPatch(stage) : {};
      const nextStatus = stage ? STAGE_TO_STATUS[stage] : req.body.status;

      const slaDueAt = req.body.slaDueAt ? new Date(req.body.slaDueAt) : ticket.slaDueAt;
      const breachedSla = slaDueAt ? slaDueAt.getTime() < Date.now() && !['resolved', 'closed'].includes(nextStatus || ticket.status) : false;

      // Update ticket with request body fields supported by ticket model
      const updatePayload = {
        title: req.body.title,
        description: req.body.description,
        priority: req.body.priority,
        status: nextStatus,
        lifecycleStage: stage,
        businessImpactScore: req.body.businessImpactScore,
        executiveSummary: req.body.executiveSummary,
        impactedServices: req.body.impactedServices,
        governanceTags: req.body.governanceTags,
        slaDueAt,
        breachedSla,
        assigneeId: req.body.assigneeId,
        ...stagePayload,
      };
      await ticket.update(updatePayload);
      // Add history entry
      await models.TicketHistory.create({ ticketId: ticket.id, eventType: 'updated', reason: 'Updated by API' });
      await writeTicketAudit(req, ticket.id, 'ticket.updated', JSON.stringify({ status: ticket.status, lifecycleStage: ticket.lifecycleStage }));
      // Notify assignee
      await notifyTicket(ticket, 'updated');

      if (req.body.assigneeId && req.body.assigneeId !== previousAssignee) {
        await sendAssignmentGuidance(ticket);
      }

      const movedToResolved = ['resolved', 'closed'].includes(ticket.status) && !['resolved', 'closed'].includes(previousStatus);
      if (movedToResolved) {
        if (!ticket.resolvedAt) {
          await ticket.update({ resolvedAt: new Date() });
        }
        await sendResolutionReport({
          ticket,
          actorName: req.user?.username || 'system',
          resolutionNotes: req.body.resolutionNotes,
          rootCause: req.body.rootCause,
          actionsTaken: req.body.actionsTaken,
          preventiveActions: req.body.preventiveActions,
        });
      }
      // Return updated ticket
      res.json(ticket);
    }
  );

  router.post('/:id/transition',
    param('id').isInt(),
    body('stage').isIn(LIFECYCLE_STAGES),
    body('note').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const ticket = await Ticket.findByPk(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Not found' });

      const nextStage = req.body.stage;
      const allowed = LIFECYCLE_STAGES.indexOf(nextStage) >= LIFECYCLE_STAGES.indexOf(ticket.lifecycleStage || 'identified');
      if (!allowed) return res.status(409).json({ error: 'Invalid stage transition' });

      const status = STAGE_TO_STATUS[nextStage] || ticket.status;
      const patch = {
        lifecycleStage: nextStage,
        status,
        ...lifecycleTimestampPatch(nextStage),
      };
      if (nextStage === 'closed') patch.closedAt = new Date();
      if (nextStage === 'recovered' && !ticket.resolvedAt) patch.resolvedAt = new Date();

      await ticket.update(patch);
      await models.TicketHistory.create({
        ticketId: ticket.id,
        eventType: 'lifecycle_transition',
        reason: req.body.note || `Transitioned to ${nextStage} by ${scopedActor(req)}`,
      });
      await writeTicketAudit(req, ticket.id, 'ticket.lifecycle_transition', JSON.stringify({ nextStage, status }));

      return res.json(ticket);
    }
  );

  router.get('/:id/comments', async (req, res) => {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId)) return res.status(422).json({ error: 'Invalid ticket id' });

    const comments = await TicketComment.findAll({ where: { ticketId }, order: [['createdAt', 'DESC']] });
    return res.json(comments);
  });

  router.post('/:id/comments',
    param('id').isInt(),
    body('message').isString().trim().isLength({ min: 2, max: 5000 }),
    body('visibility').optional().isIn(['internal', 'executive']),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const ticketId = Number(req.params.id);
      const ticket = await Ticket.findByPk(ticketId);
      if (!ticket) return res.status(404).json({ error: 'Not found' });

      const comment = await TicketComment.create({
        ticketId,
        authorName: scopedActor(req),
        authorRole: req.user?.role || null,
        visibility: req.body.visibility || 'internal',
        message: req.body.message,
      });

      await models.TicketHistory.create({
        ticketId,
        eventType: 'comment_added',
        reason: `${scopedActor(req)} added ${comment.visibility} comment`,
      });
      await writeTicketAudit(req, ticketId, 'ticket.comment_added', JSON.stringify({ visibility: comment.visibility }));

      return res.status(201).json(comment);
    }
  );

  router.get('/:id/action-items', async (req, res) => {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId)) return res.status(422).json({ error: 'Invalid ticket id' });

    const items = await TicketActionItem.findAll({ where: { ticketId }, order: [['createdAt', 'DESC']] });
    return res.json(items);
  });

  router.post('/:id/action-items',
    param('id').isInt(),
    body('title').isString().trim().isLength({ min: 3, max: 255 }),
    body('ownerScjId').optional().isString().trim().matches(SCJ_ID_REGEX),
    body('dueAt').optional().isISO8601(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const ticketId = Number(req.params.id);
      const ticket = await Ticket.findByPk(ticketId);
      if (!ticket) return res.status(404).json({ error: 'Not found' });

      if (req.body.ownerScjId) {
        const owner = await User.findOne({ where: { scjId: req.body.ownerScjId } });
        if (!owner) return res.status(422).json({ error: 'Owner SCJ ID not found' });
      }

      const actionItem = await TicketActionItem.create({
        ticketId,
        title: req.body.title,
        ownerScjId: req.body.ownerScjId || null,
        dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
      });

      await models.TicketHistory.create({
        ticketId,
        eventType: 'action_item_added',
        reason: `${scopedActor(req)} created action item #${actionItem.id}`,
      });
      await writeTicketAudit(req, ticketId, 'ticket.action_item_added', JSON.stringify({ actionItemId: actionItem.id }));
      return res.status(201).json(actionItem);
    }
  );

  router.patch('/:id/action-items/:actionId',
    param('id').isInt(),
    param('actionId').isInt(),
    body('status').optional().isIn(['open', 'blocked', 'done']),
    body('ownerScjId').optional().isString().trim().matches(SCJ_ID_REGEX),
    body('dueAt').optional().isISO8601(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const ticketId = Number(req.params.id);
      const actionId = Number(req.params.actionId);
      const actionItem = await TicketActionItem.findOne({ where: { id: actionId, ticketId } });
      if (!actionItem) return res.status(404).json({ error: 'Action item not found' });

      if (req.body.ownerScjId) {
        const owner = await User.findOne({ where: { scjId: req.body.ownerScjId } });
        if (!owner) return res.status(422).json({ error: 'Owner SCJ ID not found' });
      }

      const nextStatus = req.body.status || actionItem.status;
      await actionItem.update({
        status: nextStatus,
        ownerScjId: req.body.ownerScjId || actionItem.ownerScjId,
        dueAt: req.body.dueAt ? new Date(req.body.dueAt) : actionItem.dueAt,
        completedAt: nextStatus === 'done' ? new Date() : null,
      });

      await models.TicketHistory.create({
        ticketId,
        eventType: 'action_item_updated',
        reason: `${scopedActor(req)} updated action item #${actionItem.id}`,
      });
      await writeTicketAudit(req, ticketId, 'ticket.action_item_updated', JSON.stringify({ actionItemId: actionItem.id, status: nextStatus }));
      return res.json(actionItem);
    }
  );

  router.get('/audit/logs', adminOnly, async (_req, res) => {
    const logs = await models.AuditLog.findAll({
      where: { entityType: 'ticket' },
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    return res.json(logs);
  });

  router.get('/:id/report', async (req, res) => {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId)) return res.status(422).json({ error: 'Invalid ticket id' });

    const report = await TicketResolutionReport.findOne({
      where: { ticketId },
      order: [['createdAt', 'DESC']],
    });

    if (!report) return res.status(404).json({ error: 'No resolution report found for this ticket' });
    return res.json(report);
  });

  // GET /api/tickets/:id/history - Get ticket history
  router.get('/:id/history', async (req, res) => {
    // Parse ticket ID
    const ticketId = Number(req.params.id);
    // Fetch history entries ordered by creation date descending
    const history = await models.TicketHistory.findAll({ where: { ticketId }, order: [['createdAt', 'DESC']] });
    // Return history as JSON
    res.json(history);
  });

  // Return configured router
  return router;
};
