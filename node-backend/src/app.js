// Import Express framework for building the API
import express from 'express';
// Import CORS middleware for cross-origin requests
import cors from 'cors';
// Import Helmet for security headers
import helmet from 'helmet';
// Import JWT for token handling
import jwt from 'jsonwebtoken';
// Import cron for scheduled tasks
import cron from 'node-cron';
// Import rate limiting middleware
import rateLimit from 'express-rate-limit';
// Import Morgan for HTTP request logging
import morgan from 'morgan';
// Import validation middleware
import { body, validationResult } from 'express-validator';
// Import bcryptjs for password hashing (avoids native bindings on PaaS)
import bcrypt from 'bcryptjs';
// Import configuration
import { CONFIG } from './config.js';
// Import database models initialization
import { initModels } from './models/index.js';
// Import Telegram bot functions
import { bot, sendTelegramMessage, ticketText } from './telegram.js';
import { sendEmailNotification } from './mailer.js';
// Import report functions
import { sendMonthlyReport, monthlySummary, executiveReport, technicalReport } from './reports.js';
// Import route factories
import usersRouteFactory from './routes/users.js';
import ticketsRouteFactory from './routes/tickets.js';
import securityRouteFactory from './routes/security.js';
import securityConnectorsRouteFactory from './routes/securityConnectors.js';
import assistantRouteFactory from './routes/assistant.js';
import authRouteFactory from './routes/auth.js';
import reportsRouteFactory from './routes/reports.js';
import automationRouteFactory from './routes/automation.js';
import webhooksRouteFactory from './routes/webhooks.js';
import { runSecuritySweep, healthSummary } from './services/securityEngine.js';
import { buildAssignmentGuidance, buildAssignmentMessage, buildResolutionReport } from './services/ticketAssist.js';
// Import security functions
import { sanitizeString, validatePriority } from './security.js';
import { Op } from 'sequelize';
import { randomInt } from 'crypto';
import {
  initAuthRateLimit,
  consumeAuthAttempt,
  clearAuthAttemptState,
  pruneExpiredAuthRateLimits,
} from './services/authRateLimit.js';

// Create Express application instance
const app = express();
const API_PERF_SAMPLE_SIZE = 200;
const apiPerformanceMetrics = new Map();
const explicitCorsOrigins = CONFIG.CORS_ALLOWED_ORIGINS
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function normalizeRoutePath(path = '') {
  return String(path)
    .replace(/\b\d+\b/g, ':id')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, ':uuid');
}

function computePercentile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1));
  return Number(sortedValues[index].toFixed(2));
}

function recordApiPerformance(routeKey, method, statusCode, durationMs) {
  const key = `${method} ${routeKey}`;
  const current = apiPerformanceMetrics.get(key) || {
    route: routeKey,
    method,
    count: 0,
    errorCount: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    samples: [],
  };

  current.count += 1;
  if (statusCode >= 400) current.errorCount += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastMs = durationMs;
  current.samples.push(durationMs);
  if (current.samples.length > API_PERF_SAMPLE_SIZE) {
    current.samples.shift();
  }

  apiPerformanceMetrics.set(key, current);
}

function getApiPerformanceSnapshot(limit = null) {
  const rows = Array.from(apiPerformanceMetrics.values()).map((entry) => {
    const sorted = entry.samples.slice().sort((a, b) => a - b);
    const avgMs = entry.count > 0 ? Number((entry.totalMs / entry.count).toFixed(2)) : 0;
    const errorRate = entry.count > 0 ? Number(((entry.errorCount / entry.count) * 100).toFixed(2)) : 0;
    return {
      route: entry.route,
      method: entry.method,
      count: entry.count,
      errorCount: entry.errorCount,
      errorRate,
      avgMs,
      p50Ms: computePercentile(sorted, 50),
      p95Ms: computePercentile(sorted, 95),
      p99Ms: computePercentile(sorted, 99),
      maxMs: Number(entry.maxMs.toFixed(2)),
      lastMs: Number(entry.lastMs.toFixed(2)),
    };
  }).sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    generatedAt: new Date().toISOString(),
    sampleWindowPerRoute: API_PERF_SAMPLE_SIZE,
    routesTracked: rows.length,
    routes: Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows,
  };
}

function resolveTrustProxy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return value;
}

// Apply security headers middleware
app.set('trust proxy', resolveTrustProxy(CONFIG.TRUST_PROXY));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 60 * 60 * 24 * 365,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'no-referrer' },
}));

// Disable caching for API responses that can contain sensitive data.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Capture API timing metrics for percentile-based performance governance.
app.use('/api', (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const rawPath = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`
      : (req.originalUrl || req.url || '').split('?')[0];
    const routeKey = normalizeRoutePath(rawPath || '/api/unknown');
    recordApiPerformance(routeKey, req.method, res.statusCode, Number(elapsedMs.toFixed(2)));
  });
  next();
});
// Apply request logging middleware
app.use(morgan('combined'));

const authApiLimiter = rateLimit({
  windowMs: CONFIG.API_AUTH_RATE_LIMIT_WINDOW_MS,
  max: CONFIG.API_AUTH_RATE_LIMIT_MAX,
  standardHeaders: true, // Include rate limit info in headers
  legacyHeaders: false, // Disable legacy headers
  message: { error: 'Too many authentication requests. Please try again shortly.' },
});

const protectedApiLimiter = rateLimit({
  windowMs: CONFIG.API_PROTECTED_RATE_LIMIT_WINDOW_MS,
  max: CONFIG.API_PROTECTED_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub ? `user:${req.user.sub}` : req.ip,
  message: { error: 'Too many API requests. Please retry shortly.' },
});

// Keep stricter limits on authentication surface, while protected APIs support high team concurrency.
app.use(['/api/token', '/api/auth'], authApiLimiter);
// Configure CORS for local frontend origins (any localhost/127.0.0.1 dev port).
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (explicitCorsOrigins.includes(origin)) return callback(null, true);

    const allowLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    const allowPrivateLan = /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
    const allowCloudflarePages = /^https:\/\/[a-z0-9-]+\.ticket-system-frontend-f77\.pages\.dev$/i.test(origin);
    if (allowLocalhost || allowPrivateLan || allowCloudflarePages) return callback(null, true);

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Parse JSON bodies with size limit
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

app.get('/api/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'node-backend', timestamp: new Date().toISOString() });
});

// Middleware function for JWT authentication
function authMiddleware(req, res, next) {
  // Get authorization header
  const authHeader = req.headers.authorization;
  // Check if header exists
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  // Extract token from "Bearer <token>" format
  const token = authHeader.split(' ')[1];
  // Check if token exists
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // Verify and decode JWT token
    const payload = jwt.verify(token, CONFIG.SECRET_KEY);
    // Attach user info to request
    req.user = payload;
    // Continue to next middleware
    next();
  } catch (err) {
    // Return error for invalid token
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware factory for role-based access control
function roleMiddleware(requiredRole) {
  return (req, res, next) => {
    // Check if user has a role
    if (!req.user?.role) return res.status(403).json({ error: 'No role found' });
    // Check if user has required role or is admin
    if (req.user.role !== requiredRole && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    // Continue if authorized
    next();
  };
}

// In-memory storage for Telegram conversation states
const telegramConversations = new Map();

// Main setup function (async for database initialization)
async function setup() {
  // Initialize database models
  const {
    userModel,
    ticketModel,
    ticketHistoryModel,
    applicationAssetModel,
    securityFindingModel,
    connectorDeadLetterModel,
    connectorReceiptModel,
    ticketResolutionReportModel,
    auditLogModel,
    ticketCommentModel,
    ticketActionItemModel,
    networkDeviceModel,
    databaseAssetModel,
    patchTaskModel,
  } = await initModels();

  // Initialise persistent auth rate limit table and purge stale entries.
  await initAuthRateLimit();
  pruneExpiredAuthRateLimits().catch(() => {});

  // Enforce a single admin account using configured credentials.
  const configuredAdminName = CONFIG.ADMIN_USERNAME;
  const passwordHash = bcrypt.hashSync(CONFIG.ADMIN_PASSWORD, 10);
  const [configuredAdmin] = await userModel.findOrCreate({
    where: {
      [Op.or]: [{ username: configuredAdminName }, { name: configuredAdminName }],
    },
    defaults: {
      username: configuredAdminName,
      name: configuredAdminName,
      surname: null,
      role: 'admin',
      password_hash: passwordHash,
    },
  });

  await configuredAdmin.update({
    username: configuredAdminName,
    name: configuredAdminName,
    role: 'admin',
    password_hash: passwordHash,
  });

  await userModel.update(
    { role: 'analyst' },
    {
      where: {
        role: 'admin',
        id: { [Op.ne]: configuredAdmin.id },
      },
    },
  );

  // Helper function to find or create user from Telegram data
  function findOrCreateUser(from) {
    return userModel.findOrCreate({ where: { telegramId: from.id }, defaults: { name: from.first_name || 'Unknown', telegramId: from.id } });
  }

  // Notification function for ticket events
  const notify = async (ticket, type) => {
    // Skip if no assignee
    if (!ticket.assigneeId) return;
    // Find assignee by SCJ ID
    const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } });
    // Skip if no assignee
    if (!assignee) return;
    // Build notification text
    const text = `Ticket ${type}:\n${ticketText(ticket)}`;

    if (assignee.notifyTelegram && assignee.telegramNumber) {
      sendTelegramMessage(Number(assignee.telegramNumber), text, { parse_mode: 'Markdown' });
    }

    if (assignee.notifyEmail && assignee.email) {
      await sendEmailNotification(
        assignee.email,
        `Cybersecurity Ticket ${type.toUpperCase()} - #${ticket.id}`,
        text,
      );
    }
  };

  const sendAssignmentGuidance = async (ticket) => {
    if (!ticket.assigneeId) return;
    const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } });
    if (!assignee) return;

    const guidance = buildAssignmentGuidance(ticket);
    const assignmentMessage = buildAssignmentMessage(ticket, guidance, {
      assigneeName: `${assignee.name || ''} ${assignee.surname || ''}`.trim() || assignee.name || 'Assigned IT/Security analyst',
      assigneeScjId: assignee.scjId || ticket.assigneeId || null,
      assigneeRole: assignee.role || null,
      impactedServices: ticket.impactedServices || null,
      coordinator: 'Cybersecurity Command Centre',
    });

    if (assignee.notifyTelegram && assignee.telegramNumber) {
      sendTelegramMessage(Number(assignee.telegramNumber), assignmentMessage);
    }

    if (assignee.notifyEmail && assignee.email) {
      await sendEmailNotification(
        assignee.email,
        `Ticket #${ticket.id} assigned - ${ticket.title}`,
        assignmentMessage,
      );
    }
  };

  const sendResolutionReport = async ({ ticket, actorName, resolutionNotes, rootCause, actionsTaken, preventiveActions }) => {
    if (!ticket.assigneeId) return null;
    const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } });

    const guidance = buildAssignmentGuidance(ticket);
    const report = buildResolutionReport({
      ticket,
      guidance,
      resolvedBy: actorName,
      resolutionNotes,
      rootCause,
      actionsTaken,
      preventiveActions,
    });

    let deliveredToAssignee = false;
    let deliveredToManager = false;
    const channels = [];

    if (assignee?.notifyTelegram && assignee.telegramNumber) {
      sendTelegramMessage(Number(assignee.telegramNumber), report.reportText);
      deliveredToAssignee = true;
      channels.push('assignee_telegram');
    }
    if (assignee?.notifyEmail && assignee.email) {
      await sendEmailNotification(
        assignee.email,
        `Resolution Report - Ticket #${ticket.id}`,
        report.reportText,
      );
      deliveredToAssignee = true;
      channels.push('assignee_email');
    }

    if (CONFIG.MANAGER_TELEGRAM_NUMBER) {
      sendTelegramMessage(Number(CONFIG.MANAGER_TELEGRAM_NUMBER), report.reportText);
      deliveredToManager = true;
      channels.push('manager_telegram');
    }

    if (CONFIG.MANAGER_EMAIL) {
      await sendEmailNotification(
        CONFIG.MANAGER_EMAIL,
        `CCC Manager Resolution Report - Ticket #${ticket.id}`,
        report.reportText,
      );
      deliveredToManager = true;
      channels.push('manager_email');
    }

    const saved = await ticketResolutionReportModel.create({
      ticketId: ticket.id,
      issueType: report.issueType,
      issueSummary: report.issueSummary,
      possibleSolutions: report.possibleSolutions.join('\n'),
      reportText: report.reportText,
      resolvedBy: actorName || null,
      deliveredToAssignee,
      deliveredToManager,
      deliveryChannels: channels.join(','),
    });

    return saved;
  };

  const writeAudit = async (req, { entityType, entityId, action, details = null }) => {
    await auditLogModel.create({
      entityType,
      entityId: String(entityId),
      actor: req.user?.username || 'system',
      actorRole: req.user?.role || null,
      action,
      ipAddress: req.ip,
      details,
    });
  };

  const writeSystemAudit = async ({ entityType, entityId, action, details = null }) => {
    await auditLogModel.create({
      entityType,
      entityId: String(entityId),
      actor: 'scheduler',
      actorRole: 'system',
      action,
      ipAddress: null,
      details,
    });
  };

  const writePublicAudit = async (req, { entityType, entityId, action, details = null }) => {
    await auditLogModel.create({
      entityType,
      entityId: String(entityId),
      actor: 'public',
      actorRole: null,
      action,
      ipAddress: req.ip,
      details,
    });
  };

  const ensureAutomationTicket = async ({ title, description, priority = 'high', lifecycleStage = 'identified' }) => {
    const existing = await ticketModel.findOne({
      where: {
        title,
        status: { [Op.in]: ['open', 'in_progress'] },
      },
      order: [['createdAt', 'DESC']],
    });

    if (existing) return existing;

    const ticket = await ticketModel.create({
      title,
      description,
      priority,
      status: 'open',
      lifecycleStage,
      businessImpactScore: priority === 'critical' ? 90 : priority === 'high' ? 75 : 55,
      executiveSummary: `Automated monitoring opened this incident due to elevated ${priority} risk.`,
    });
    await ticketHistoryModel.create({
      ticketId: ticket.id,
      eventType: 'created',
      reason: 'Created by automation scheduler',
    });
    await notify(ticket, 'created');
    return ticket;
  };

  const automationLocks = {
    devicePassive: false,
    deviceIds: false,
    databaseReview: false,
  };

  const runDevicePassiveAutomation = async () => {
    if (automationLocks.devicePassive) return;
    automationLocks.devicePassive = true;
    try {
      const devices = await networkDeviceModel.findAll({ where: { monitoringEnabled: true } });
      if (!devices.length) return;

      const [fallbackApp] = await applicationAssetModel.findOrCreate({
        where: { name: 'Network Core Infrastructure' },
        defaults: {
          baseUrl: 'https://network-core.local',
          environment: 'production',
          ownerEmail: CONFIG.MANAGER_EMAIL || null,
          healthStatus: 'unknown',
        },
      });

      const intervalMs = CONFIG.AUTOMATION_DEVICE_PASSIVE_INTERVAL_MINUTES * 60 * 1000;
      for (const device of devices) {
        const due = !device.lastPassiveScanAt || (Date.now() - new Date(device.lastPassiveScanAt).getTime() >= intervalMs);
        if (!due) continue;

        const suspicious = device.riskScore >= CONFIG.AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD || ['degraded', 'offline'].includes(device.state);
        const nextRisk = suspicious ? Math.min(100, device.riskScore + 4) : Math.max(10, device.riskScore - 2);

        await device.update({
          passiveScanEnabled: true,
          lastPassiveScanAt: new Date(),
          lastSeenAt: new Date(),
          state: suspicious ? 'degraded' : 'online',
          riskScore: nextRisk,
        });

        await writeSystemAudit({
          entityType: 'network_device',
          entityId: device.id,
          action: 'automation.passive_scan',
          details: JSON.stringify({ suspicious, riskScore: nextRisk }),
        });

        if (!suspicious) continue;

        const finding = await securityFindingModel.create({
          applicationAssetId: fallbackApp.id,
          sourceTool: 'Passive Scheduler',
          detectionMode: 'passive',
          category: 'network',
          severity: nextRisk >= 85 ? 'critical' : nextRisk >= 70 ? 'high' : 'medium',
          title: `Automated passive scan anomaly on ${device.name}`,
          description: `Scheduled passive scan observed elevated network risk on ${device.name} (${device.deviceType}).`,
          evidence: `device=${device.name}; ip=${device.ipAddress || 'n/a'}; state=${device.state}; risk=${nextRisk}`,
          status: 'new',
          requiresManualConfirmation: false,
          manualConfirmed: true,
          manualConfirmedBy: 'scheduler',
        });

        if (CONFIG.AUTOMATION_AUTO_CREATE_TICKETS && nextRisk >= CONFIG.AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD) {
          const ticket = await ensureAutomationTicket({
            title: `[AUTO][NETWORK] High risk device ${device.name}`,
            description: `Automated passive monitoring flagged ${device.name} with risk score ${nextRisk}. Finding #${finding.id}.`,
            priority: nextRisk >= 85 ? 'critical' : 'high',
          });
          await finding.update({ ticketId: ticket.id, status: 'investigating' });
        }
      }
    } finally {
      automationLocks.devicePassive = false;
    }
  };

  const runDeviceIdsAutomation = async () => {
    if (automationLocks.deviceIds) return;
    automationLocks.deviceIds = true;
    try {
      const devices = await networkDeviceModel.findAll({ where: { monitoringEnabled: true } });
      if (!devices.length) return;

      const [fallbackApp] = await applicationAssetModel.findOrCreate({
        where: { name: 'Network Core Infrastructure' },
        defaults: {
          baseUrl: 'https://network-core.local',
          environment: 'production',
          ownerEmail: CONFIG.MANAGER_EMAIL || null,
          healthStatus: 'unknown',
        },
      });

      const intervalMs = CONFIG.AUTOMATION_DEVICE_IDS_INTERVAL_MINUTES * 60 * 1000;
      for (const device of devices) {
        const due = !device.lastIdsIpsEventAt || (Date.now() - new Date(device.lastIdsIpsEventAt).getTime() >= intervalMs);
        if (!due) continue;

        const intrusionSignal = device.riskScore >= CONFIG.AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD + 5 || device.deviceType === 'firewall';
        const nextRisk = intrusionSignal ? Math.min(100, device.riskScore + 6) : Math.max(10, device.riskScore - 2);

        await device.update({
          idsIpsEnabled: true,
          lastIdsIpsEventAt: new Date(),
          lastSeenAt: new Date(),
          state: intrusionSignal ? 'degraded' : 'online',
          riskScore: nextRisk,
        });

        await writeSystemAudit({
          entityType: 'network_device',
          entityId: device.id,
          action: 'automation.ids_ips_check',
          details: JSON.stringify({ intrusionSignal, riskScore: nextRisk }),
        });

        if (!intrusionSignal) continue;

        const finding = await securityFindingModel.create({
          applicationAssetId: fallbackApp.id,
          sourceTool: 'IDS/IPS Scheduler',
          detectionMode: 'passive',
          category: 'intrusion',
          severity: nextRisk >= 85 ? 'critical' : 'high',
          title: `Automated IDS/IPS intrusion signal on ${device.name}`,
          description: `Scheduled IDS/IPS check detected suspicious network behavior on ${device.name}.`,
          evidence: `device=${device.name}; type=${device.deviceType}; ip=${device.ipAddress || 'n/a'}; risk=${nextRisk}`,
          status: 'new',
          requiresManualConfirmation: false,
          manualConfirmed: true,
          manualConfirmedBy: 'scheduler',
        });

        if (CONFIG.AUTOMATION_AUTO_CREATE_TICKETS && nextRisk >= CONFIG.AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD) {
          const ticket = await ensureAutomationTicket({
            title: `[AUTO][IDS] Intrusion signal on ${device.name}`,
            description: `Automated IDS/IPS monitoring detected intrusion indicators on ${device.name}. Finding #${finding.id}.`,
            priority: nextRisk >= 85 ? 'critical' : 'high',
          });
          await finding.update({ ticketId: ticket.id, status: 'investigating' });
        }
      }
    } finally {
      automationLocks.deviceIds = false;
    }
  };

  const runDatabaseReviewAutomation = async () => {
    if (automationLocks.databaseReview) return;
    automationLocks.databaseReview = true;
    try {
      const assets = await databaseAssetModel.findAll({ where: { monitoringEnabled: true } });
      if (!assets.length) return;

      const intervalMs = CONFIG.AUTOMATION_DATABASE_REVIEW_INTERVAL_MINUTES * 60 * 1000;
      for (const db of assets) {
        const due = !db.lastSecurityReviewAt || (Date.now() - new Date(db.lastSecurityReviewAt).getTime() >= intervalMs);
        if (!due) continue;

        const patchUnknown = !db.patchLevel || String(db.patchLevel).toLowerCase().includes('unknown');
        const weakCrypto = !db.encryptionAtRest || !db.tlsInTransit;
        const noOwner = !db.ownerEmail;
        const issueCount = [patchUnknown, weakCrypto, noOwner].filter(Boolean).length;
        const nextRisk = issueCount > 0 ? Math.min(100, db.riskScore + (issueCount * 6)) : Math.max(10, db.riskScore - 4);

        await db.update({
          riskScore: nextRisk,
          backupStatus: issueCount > 1 ? 'warning' : 'healthy',
          state: issueCount > 1 ? 'degraded' : 'online',
          lastSeenAt: new Date(),
          lastSecurityReviewAt: new Date(),
        });

        await writeSystemAudit({
          entityType: 'database_asset',
          entityId: db.id,
          action: 'automation.database_security_review',
          details: JSON.stringify({ patchUnknown, weakCrypto, noOwner, riskScore: nextRisk }),
        });

        if (CONFIG.AUTOMATION_AUTO_CREATE_TICKETS && nextRisk >= CONFIG.AUTOMATION_DATABASE_RISK_ALERT_THRESHOLD) {
          await ensureAutomationTicket({
            title: `[AUTO][DATABASE] Elevated risk ${db.name}`,
            description: `Automated database security review flagged ${db.name} with risk score ${nextRisk}. Patch level=${db.patchLevel || 'unknown'}, encryptionAtRest=${db.encryptionAtRest}, tlsInTransit=${db.tlsInTransit}.`,
            priority: nextRisk >= 88 ? 'critical' : 'high',
          });
        }
      }
    } finally {
      automationLocks.databaseReview = false;
    }
  };

  // Mount user routes with auth middleware; write operations are restricted inside route handlers.
  app.use('/api/users', authMiddleware, protectedApiLimiter, usersRouteFactory({ User: userModel }));
  // Mount ticket routes with auth middleware
  app.use(
    '/api/tickets',
    authMiddleware,
    protectedApiLimiter,
    ticketsRouteFactory(
      {
        Ticket: ticketModel,
        User: userModel,
        TicketHistory: ticketHistoryModel,
        TicketResolutionReport: ticketResolutionReportModel,
        TicketComment: ticketCommentModel,
        TicketActionItem: ticketActionItemModel,
        AuditLog: auditLogModel,
      },
      {
        notifyTicket: notify,
        sendAssignmentGuidance,
        sendResolutionReport,
        writeAudit,
      },
    ),
  );
  app.use(
    '/api/security/connectors',
    securityConnectorsRouteFactory({
      models: {
        ApplicationAsset: applicationAssetModel,
        SecurityFinding: securityFindingModel,
        Ticket: ticketModel,
        TicketHistory: ticketHistoryModel,
        ConnectorReceipt: connectorReceiptModel,
      },
      notifyTicket: notify,
    }),
  );

  app.use(
    '/api/security',
    authMiddleware,
    protectedApiLimiter,
    securityRouteFactory({
      models: {
        ApplicationAsset: applicationAssetModel,
        SecurityFinding: securityFindingModel,
        Ticket: ticketModel,
        TicketHistory: ticketHistoryModel,
        User: userModel,
        ConnectorDeadLetter: connectorDeadLetterModel,
        AuditLog: auditLogModel,
        NetworkDevice: networkDeviceModel,
        DatabaseAsset: databaseAssetModel,
        PatchTask: patchTaskModel,
      },
      runSweep: runSecuritySweep,
      getSummary: healthSummary,
      notifyTicket: notify,
    }),
  );

  app.use('/api/assistant', authMiddleware, protectedApiLimiter, assistantRouteFactory({
    writeAudit,
    getPerformanceSnapshot: () => getApiPerformanceSnapshot(5),
    models: {
      Ticket: ticketModel,
      User: userModel,
      SecurityFinding: securityFindingModel,
      TicketActionItem: ticketActionItemModel,
    },
  }));

  app.use('/webhook', webhooksRouteFactory({
    sanitizeString,
    findOrCreateUser,
    telegramConversations,
    sendTelegramMessage,
    ticketModel,
    userModel,
    ticketHistoryModel,
    notify,
  }));

  app.use('/api/automation', automationRouteFactory({
    authMiddleware,
    protectedApiLimiter,
    roleMiddleware,
    config: CONFIG,
    automationLocks,
  }));

  app.use('/api/reports', reportsRouteFactory({
    authMiddleware,
    roleMiddleware,
    monthlySummary,
    executiveReport,
    protectedApiLimiter,
    technicalReport,
    models: {
      Ticket: ticketModel,
      SecurityFinding: securityFindingModel,
      TicketActionItem: ticketActionItemModel,
      TicketComment: ticketCommentModel,
    },
  }));

  // Schedule monthly report on the 1st at 9 AM
  cron.schedule('0 9 1 * *', async () => {
    await sendMonthlyReport(ticketModel);
  });

  // Passive and active scan schedules for the integrated security stack.
  cron.schedule('*/5 * * * *', async () => {
    await runSecuritySweep({
      mode: 'passive',
      actor: 'scheduler',
      models: {
        ApplicationAsset: applicationAssetModel,
        SecurityFinding: securityFindingModel,
        Ticket: ticketModel,
        TicketHistory: ticketHistoryModel,
        ConnectorDeadLetter: connectorDeadLetterModel,
      },
      notifyTicket: notify,
    });
  });

  cron.schedule('*/30 * * * *', async () => {
    await runSecuritySweep({
      mode: 'active',
      actor: 'scheduler',
      models: {
        ApplicationAsset: applicationAssetModel,
        SecurityFinding: securityFindingModel,
        Ticket: ticketModel,
        TicketHistory: ticketHistoryModel,
      },
      notifyTicket: notify,
    });
  });

  if (CONFIG.AUTOMATION_NETWORK_ENABLED) {
    cron.schedule(CONFIG.AUTOMATION_DEVICE_PASSIVE_CRON, async () => {
      try {
        await runDevicePassiveAutomation();
      } catch (err) {
        console.error('Device passive automation failed:', err);
      }
    });

    cron.schedule(CONFIG.AUTOMATION_DEVICE_IDS_CRON, async () => {
      try {
        await runDeviceIdsAutomation();
      } catch (err) {
        console.error('Device IDS/IPS automation failed:', err);
      }
    });
  }

  if (CONFIG.AUTOMATION_DATABASE_ENABLED) {
    cron.schedule(CONFIG.AUTOMATION_DATABASE_REVIEW_CRON, async () => {
      try {
        await runDatabaseReviewAutomation();
      } catch (err) {
        console.error('Database review automation failed:', err);
      }
    });
  }

  app.use('/api', authRouteFactory({
    body,
    validationResult,
    Op,
    bcrypt,
    randomInt,
    jwt,
    config: CONFIG,
    userModel,
    consumeAuthAttempt,
    clearAuthAttemptState,
    writePublicAudit,
    sendEmailNotification,
  }));

  // Get current user info endpoint
  app.get('/api/me', authMiddleware, protectedApiLimiter, async (req, res) => {
    // Find user by ID from token
    const user = await userModel.findByPk(req.user.sub);
    // Return 404 if not found
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Return user info
    res.json({
      id: user.id,
      username: user.username || user.name,
      name: user.name,
      surname: user.surname,
      role: user.role,
      jobTitle: user.jobTitle || null,
      department: user.department || null,
      email: user.email || null,
      scjId: user.scjId || null,
      telegramId: user.telegramId,
      telegramNumber: user.telegramNumber || null,
    });
  });

  app.get('/api/governance/audit-logs', authMiddleware, protectedApiLimiter, roleMiddleware('admin'), async (_req, res) => {
    const rows = await auditLogModel.findAll({
      order: [['createdAt', 'DESC']],
      limit: 300,
    });
    res.json(rows);
  });

  app.get('/api/governance/performance', authMiddleware, protectedApiLimiter, roleMiddleware('admin'), async (_req, res) => {
    res.json(getApiPerformanceSnapshot());
  });

}

// Export the express app for testing
export default app;

// Run setup, start server only outside test environment, and export the ready promise
export const ready = setup().then(() => {
  if (process.env.NODE_ENV !== 'test') {
    app.listen(CONFIG.PORT, () => console.log(`Node backend running on port ${CONFIG.PORT}`));
  }
}).catch(console.error);
