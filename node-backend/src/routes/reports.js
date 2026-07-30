import express from 'express';
import { generateExecutivePdf, toCsv } from '../services/reportExport.js';

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

  // Real downloadable PDF of the exact same executive report data above —
  // for handing to a customer or auditor who wants a document, not a JSON
  // blob.
  router.get('/executive/export.pdf', authMiddleware, limiter, roleMiddleware('admin'), async (_req, res) => {
    const report = await executiveReport({
      Ticket: models.Ticket,
      SecurityFinding: models.SecurityFinding,
    });
    const buffer = await generateExecutivePdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="commandcentre-executive-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  });

  // Real CSV of the technical report's severity/priority/lifecycle
  // breakdowns — one row per metric, suitable for dropping straight into a
  // spreadsheet for a compliance packet.
  router.get('/technical/export.csv', authMiddleware, limiter, roleMiddleware('admin'), async (_req, res) => {
    const report = await technicalReport({
      Ticket: models.Ticket,
      SecurityFinding: models.SecurityFinding,
      TicketActionItem: models.TicketActionItem,
      TicketComment: models.TicketComment,
    });
    const rows = [
      ...Object.entries(report.openByPriority).map(([priority, count]) => ({ metric: 'openTicketsByPriority', key: priority, value: count })),
      ...Object.entries(report.findingsBySeverity).map(([severity, count]) => ({ metric: 'findingsBySeverity', key: severity, value: count })),
      ...Object.entries(report.lifecycleSpread).map(([stage, count]) => ({ metric: 'ticketsByLifecycleStage', key: stage, value: count })),
      { metric: 'overdueActions', key: 'total', value: report.overdueActions },
    ];
    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="commandcentre-technical-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  // Historical trend data — the daily snapshot cron in app.js is what
  // actually populates this over time; this just serves what's accumulated
  // so far.
  router.get('/trends', authMiddleware, limiter, roleMiddleware('admin'), async (req, res) => {
    const type = req.query.type || 'executive';
    const snapshots = await models.ReportSnapshot.findAll({
      where: { type },
      order: [['generatedAt', 'ASC']],
      limit: 365,
    });
    res.json(snapshots.map((s) => ({ generatedAt: s.generatedAt, payload: s.payload })));
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
