import express from 'express';

export default function automationRouteFactory({ authMiddleware, protectedApiLimiter, roleMiddleware, config, automationLocks }) {
  const router = express.Router();
  const limiter = protectedApiLimiter || ((_req, _res, next) => next());

  router.get('/status', authMiddleware, limiter, roleMiddleware('admin'), (_req, res) => {
    res.json({
      networkEnabled: config.AUTOMATION_NETWORK_ENABLED,
      databaseEnabled: config.AUTOMATION_DATABASE_ENABLED,
      autoCreateTickets: config.AUTOMATION_AUTO_CREATE_TICKETS,
      schedules: {
        devicePassive: config.AUTOMATION_DEVICE_PASSIVE_CRON,
        deviceIds: config.AUTOMATION_DEVICE_IDS_CRON,
        databaseReview: config.AUTOMATION_DATABASE_REVIEW_CRON,
      },
      thresholds: {
        deviceRiskAlert: config.AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD,
        databaseRiskAlert: config.AUTOMATION_DATABASE_RISK_ALERT_THRESHOLD,
      },
      locks: automationLocks,
    });
  });

  return router;
}
