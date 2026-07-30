import pino from 'pino';
import crypto from 'crypto';

// Real structured logging: JSON output with levels, so an operator can
// actually filter/search/ship these logs (to Docker's own log driver, a
// file, or a real aggregator later) instead of grepping unstructured
// console.log strings. Level is configurable via LOG_LEVEL so a production
// deploy can turn down verbosity without a code change.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Assigns each incoming request a correlation id and a child logger
// carrying it, so every log line emitted while handling that request can be
// tied back together — the single most useful thing a structured logger
// adds over plain console.log for actually investigating an incident.
export function requestLoggingMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.log = logger.child({ requestId: req.requestId });
  res.setHeader('x-request-id', req.requestId);
  next();
}
