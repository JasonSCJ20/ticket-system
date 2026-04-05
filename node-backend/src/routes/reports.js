import express from 'express';

export default function reportsRouteFactory({
  authMiddleware,
  protectedApiLimiter,
  roleMiddleware,
  monthlySummary,
  executiveReport,
  technicalReport,
  models,
}) {
  const router = express.Router();
  const limiter = protectedApiLimiter || ((_req, _res, next) => next());

  router.get('/monthly', authMiddleware, limiter, async (_req, res) => {
    const report = await monthlySummary(new Date(), models.Ticket);
    res.json(report);
  });

  router.get('/executive', authMiddleware, limiter, roleMiddleware('admin'), async (_req, res) => {
    const report = await executiveReport({
      Ticket: models.Ticket,
      SecurityFinding: models.SecurityFinding,
    });
    res.json(report);
  });

  router.get('/technical', authMiddleware, limiter, async (_req, res) => {
    const report = await technicalReport({
      Ticket: models.Ticket,
      SecurityFinding: models.SecurityFinding,
      TicketActionItem: models.TicketActionItem,
      TicketComment: models.TicketComment,
    });
    res.json(report);
  });

  return router;
}
