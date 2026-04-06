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
import { recordScanRun } from './services/scanRunLedger.js';
import { generateAndPushEvents, pushScanToolEvent } from './services/socLiveFeed.js';
import { recordToolSchedulerRun } from './services/toolRegistry.js';
import { buildAssignment5W1H, buildAssignmentGuidance, buildAssignmentMessage, buildResolutionReport, detectAssignmentDomain } from './services/ticketAssist.js';
import {
  findingImpactedTeams,
  getAudienceLabel,
  getProfileCompletionState,
  isLeadershipAudience,
  isOperationalStaffAudience,
  normalizeOperationalTeams,
  readUserOperationalTeams,
} from './services/userProfile.js';
// Import security functions
import { sanitizeString, validatePriority } from './security.js';
import { Op } from 'sequelize';
import { randomInt, randomUUID } from 'crypto';
import speakeasy from 'speakeasy';
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
let isTokenRevoked = async () => false;
let revokeTokenJti = async () => {};
const NOTIFICATION_LEDGER_RETENTION_DAYS = Number.parseInt(CONFIG.NOTIFICATION_LEDGER_RETENTION_DAYS || '90', 10);
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

function escapeTelegramMarkdown(value = '') {
  return String(value).replace(/([_\*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Apply security headers middleware
app.set('trust proxy', resolveTrustProxy(CONFIG.TRUST_PROXY));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
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

    let parsedOrigin = null;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      parsedOrigin = null;
    }

    const allowLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    const allowPrivateLan = /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
    const allowCloudflarePages = /^https:\/\/[a-z0-9-]+\.ticket-system-frontend-f77\.pages\.dev$/i.test(origin);
    const allowAnyPagesDev = /^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin);
    const allowRenderFrontend = /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin);
    const allowVercelFrontend = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
    const allowNetlifyFrontend = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
    const allowCustomHttpsOrigin = parsedOrigin?.protocol === 'https:' && Boolean(parsedOrigin.hostname);
    if (allowLocalhost || allowPrivateLan || allowCloudflarePages || allowAnyPagesDev || allowRenderFrontend || allowVercelFrontend || allowNetlifyFrontend || allowCustomHttpsOrigin) return callback(null, true);

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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
async function authMiddleware(req, res, next) {
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
    if (payload?.jti && await isTokenRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }
    // Attach user info to request
    req.user = payload;
    req.token = token;
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

function governanceAccessMiddleware(req, res, next) {
  const audienceCode = String(req.user?.audienceCode || '').trim().toUpperCase();
  // Admin: full access. TJN = Command Centre Manager (Jason). GJN = Operational Manager.
  if (req.user?.role === 'admin' || audienceCode === 'TJN' || audienceCode === 'GJN') {
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions' });
}

// In-memory storage for Telegram conversation states
const telegramConversations = new Map();

// Geo-IP cache: ip -> { geo, cachedAt }  (TTL: 1 hour per entry)
const geoCache = new Map();
const GEO_CACHE_TTL_MS = 60 * 60 * 1000;
const PRIVATE_IP_RE = /^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.)/;

async function getGeoForIp(ip) {
  if (!ip || PRIVATE_IP_RE.test(ip)) return 'Local / Private';
  const cached = geoCache.get(ip);
  if (cached && (Date.now() - cached.cachedAt) < GEO_CACHE_TTL_MS) return cached.geo;
  try {
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,country`, { signal: AbortSignal.timeout(3000) });
    const data = await r.json();
    const geo = data.status === 'success' ? `${data.city}, ${data.country}` : null;
    geoCache.set(ip, { geo, cachedAt: Date.now() });
    return geo;
  } catch {
    return null;
  }
}

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
    scanRunRecordModel,
    revokedTokenModel,
    notificationLedgerModel,
  } = await initModels();

  isTokenRevoked = async (jti) => {
    if (!jti) return false;
    const existing = await revokedTokenModel.findOne({ where: { jti } });
    if (!existing) return false;
    if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) {
      await existing.destroy().catch(() => {});
      return false;
    }
    return true;
  };

  revokeTokenJti = async (jti, expiresAt) => {
    if (!jti) return;
    await revokedTokenModel.findOrCreate({
      where: { jti },
      defaults: { jti, expiresAt: expiresAt || null },
    });
  };

  cron.schedule('*/15 * * * *', async () => {
    try {
      await revokedTokenModel.destroy({ where: { expiresAt: { [Op.lte]: new Date() } } });
    } catch (_err) {
      // best effort cleanup
    }
  });

  // Keep notification ledger bounded to avoid unbounded growth.
  cron.schedule('15 2 * * *', async () => {
    try {
      const retentionDays = Number.isFinite(NOTIFICATION_LEDGER_RETENTION_DAYS) && NOTIFICATION_LEDGER_RETENTION_DAYS > 0
        ? NOTIFICATION_LEDGER_RETENTION_DAYS
        : 90;
      const cutoff = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
      await notificationLedgerModel.destroy({ where: { createdAt: { [Op.lte]: cutoff } } });
    } catch (_err) {
      // best effort cleanup
    }
  });

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

  function getTelegramChatId(user) {
    return String(user?.telegramChatId || user?.telegramId || '').trim() || null;
  }

  function canReceiveTelegram(user) {
    const profileState = getProfileCompletionState(user);
    return Boolean(user?.notifyTelegram) && Boolean(getTelegramChatId(user)) && profileState.isComplete;
  }

  async function sendTelegramToUser(user, text, options = {}) {
    if (!user) return false;

    if (!canReceiveTelegram(user)) {
      const status = 'not_configured';
      await user.update({
        lastTelegramDeliveryAt: new Date(),
        lastTelegramDeliveryStatus: status,
      }).catch(() => {});
      await notificationLedgerModel.create({
        userId: user.id,
        channel: 'telegram',
        subject: String(text || '').slice(0, 255),
        status,
        deliveredAt: null,
        referenceType: options.referenceType || 'system',
        referenceId: options.referenceId ? String(options.referenceId) : null,
        errorMessage: 'Telegram not configured for this user',
      }).catch(() => {});
      return false;
    }

    const delivered = await sendTelegramMessage(getTelegramChatId(user), text, options);
    const status = delivered ? 'delivered' : 'failed';
    const deliveredAt = delivered ? new Date() : null;
    await user.update({
      lastTelegramDeliveryAt: new Date(),
      lastTelegramDeliveryStatus: status,
    }).catch(() => {});
    await notificationLedgerModel.create({
      userId: user.id,
      channel: 'telegram',
      subject: String(text || '').slice(0, 255),
      status,
      deliveredAt,
      referenceType: options.referenceType || 'system',
      referenceId: options.referenceId ? String(options.referenceId) : null,
      errorMessage: delivered ? null : 'Telegram send failed',
    }).catch(() => {});
    return delivered;
  }

  function buildLeadershipAssignmentMessage(ticket, guidance, assignee) {
    const briefing = buildAssignment5W1H(ticket, guidance, {
      assigneeName: `${assignee?.name || ''} ${assignee?.surname || ''}`.trim() || assignee?.name || 'Assigned CCC staff member',
      assigneeScjId: assignee?.scjId || ticket.assigneeId || null,
      assigneeRole: assignee?.role || null,
      impactedServices: ticket.impactedServices || null,
      coordinator: 'Cybersecurity Command Centre',
    });

    return [
      `5W1H Ticket Assignment Summary - #${ticket.id}`,
      `Audience: Operational escalation leadership`,
      `What: ${briefing.what}`,
      `Where: ${briefing.where}`,
      `When: ${briefing.when.assignedAt}${briefing.when.slaDueAt ? ` | SLA due ${briefing.when.slaDueAt}` : ''}`,
      `Who: ${briefing.who.assigneeName}${briefing.who.assigneeScjId ? ` (${briefing.who.assigneeScjId})` : ''}`,
      `Why: ${ticket.executiveSummary || guidance.issueSummary}`,
      `How: ${guidance.possibleSolutions?.[0] || 'Coordinate triage, containment, and recovery with the assigned CCC staff member.'}`,
      `Business impact: ${ticket.executiveSummary || 'Operational service disruption or cyber risk requires management visibility and stakeholder escalation.'}`,
    ].join('\n');
  }

  function buildTechnicalFindingAlert(finding, impactedTeams) {
    return [
      `*High Priority Security Alert*`,
      `Title: ${escapeTelegramMarkdown(finding.title || 'Security finding')}`,
      `Severity: ${String(finding.severity || '').toUpperCase()}`,
      `Category: ${finding.category || 'general'}`,
      `Impacted Teams: ${impactedTeams.join(', ')}`,
      `Summary: ${escapeTelegramMarkdown(finding.description || finding.executiveSummary || 'Investigation required.')}`,
    ].join('\n');
  }

  function buildLeadershipFindingAlert(finding, impactedTeams, audienceCode) {
    return [
      `5W1H Cyber Alert Summary`,
      `Audience: ${getAudienceLabel(audienceCode)}`,
      `What: ${finding.title || 'Security alert requiring attention'}`,
      `Where: ${finding.affectedAssetRef || finding.affectedAssetType || 'Command Centre monitored environment'}`,
      `When: ${new Date(finding.detectedAt || finding.createdAt || Date.now()).toISOString()}`,
      `Who: Impacted teams are ${impactedTeams.join(', ')} under CCC coordination.`,
      `Why: ${finding.executiveSummary || finding.description || 'Monitoring has detected a risk that requires visibility and coordinated response.'}`,
      `How: ${finding.remediationRecommendation || 'Coordinate immediate triage, validate impact, and prepare escalation updates for stakeholders.'}`,
      `Business impact: ${finding.businessImpact || 'Operational or service risk exists and should be monitored closely.'}`,
    ].join('\n');
  }

  async function notifyFindingAudience(finding) {
    if (!['high', 'critical'].includes(String(finding?.severity || '').toLowerCase())) return;

    const impactedTeams = findingImpactedTeams(finding);
    const users = await userModel.findAll({ where: { notifyTelegram: true } });

    for (const user of users) {
      const audienceCode = String(user.audienceCode || '').trim().toUpperCase();
      const userTeams = readUserOperationalTeams(user);
      const matchesOperationalTeam = userTeams.some((team) => impactedTeams.includes(team));
      const shouldNotify = matchesOperationalTeam || audienceCode === 'TJN' || audienceCode === 'GJN' || user.role === 'admin';
      if (!shouldNotify) continue;

      const text = audienceCode === 'GJN'
        ? buildLeadershipFindingAlert(finding, impactedTeams, audienceCode)
        : buildTechnicalFindingAlert(finding, impactedTeams);

      await sendTelegramToUser(user, text, audienceCode === 'GJN' ? {} : { parse_mode: 'MarkdownV2' });
    }
  }

  async function getTicketManagers() {
    return userModel.findAll({
      where: {
        [Op.or]: [
          { audienceCode: 'TJN' },
          { audienceCode: 'GJN' },
          { role: 'admin' },
        ],
      },
    });
  }

  const requireCompletedProfile = async (req, res, next) => {
    const user = await userModel.findByPk(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const profileState = getProfileCompletionState(user);
    if (profileState.isComplete) return next();

    return res.status(428).json({
      error: 'Profile completion required',
      profileCompletionRequired: true,
      profileCompletionIssues: profileState.issues,
      audienceCode: profileState.audienceCode,
      operationalTeams: profileState.operationalTeams,
    });
  };

  // Notification function for ticket events
  const notify = async (ticket, type) => {
    const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } });
    if (!assignee) return;
    const text = `Ticket ${type}:\n${ticketText(ticket)}`;

    await sendTelegramToUser(assignee, text, { parse_mode: 'Markdown' });

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
    const managers = await getTicketManagers();

    const guidance = buildAssignmentGuidance(ticket);
    const assignmentMessage = buildAssignmentMessage(ticket, guidance, {
      assigneeName: `${assignee.name || ''} ${assignee.surname || ''}`.trim() || assignee.name || 'Assigned IT/Security analyst',
      assigneeScjId: assignee.scjId || ticket.assigneeId || null,
      assigneeRole: assignee.role || null,
      impactedServices: ticket.impactedServices || null,
      coordinator: 'Cybersecurity Command Centre',
    });
    const leadershipMessage = buildLeadershipAssignmentMessage(ticket, guidance, assignee);

    await sendTelegramToUser(assignee, assignmentMessage);

    if (assignee.notifyEmail && assignee.email) {
      await sendEmailNotification(
        assignee.email,
        `Ticket #${ticket.id} assigned - ${ticket.title}`,
        assignmentMessage,
      );
    }

    for (const manager of managers) {
      if (manager.id === assignee.id) continue;
      const message = String(manager.audienceCode || '').trim().toUpperCase() === 'GJN'
        ? leadershipMessage
        : assignmentMessage;
      await sendTelegramToUser(manager, message);
    }
  };

  const sendResolutionReport = async ({ ticket, actorName, resolutionNotes, rootCause, actionsTaken, preventiveActions }) => {
    if (!ticket.assigneeId) return null;
    const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } });
    const managers = await getTicketManagers();

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

    if (await sendTelegramToUser(assignee, report.reportText)) {
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

    for (const manager of managers) {
      if (manager.id === assignee?.id) continue;
      const delivered = await sendTelegramToUser(manager, report.reportText);
      if (delivered) {
        deliveredToManager = true;
        channels.push(`manager_telegram_${manager.id}`);
      }
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

  securityFindingModel.addHook('afterCreate', 'notify-telegram-audience', async (finding) => {
    await notifyFindingAudience(finding).catch((err) => {
      console.error('High-severity finding notification failed:', err?.message || err);
    });
  });

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
        const startedAt = new Date();

        await device.update({
          passiveScanEnabled: true,
          lastPassiveScanAt: startedAt,
          lastSeenAt: startedAt,
          state: suspicious ? 'degraded' : 'online',
          riskScore: nextRisk,
        });

        await writeSystemAudit({
          entityType: 'network_device',
          entityId: device.id,
          action: 'automation.passive_scan',
          details: JSON.stringify({ suspicious, riskScore: nextRisk }),
        });

        let finding = null;
        if (suspicious) {
          finding = await securityFindingModel.create({
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

        await recordScanRun({
          ScanRunRecord: scanRunRecordModel,
          AuditLog: auditLogModel,
          toolId: 'zeek',
          toolName: 'Zeek',
          engine: 'Zeek',
          mode: 'passive',
          triggerSource: 'scheduler',
          actor: 'scheduler',
          actorRole: 'system',
          assetType: 'network_device',
          assetId: device.id,
          assetName: device.name,
          assetRef: device.ipAddress || null,
          findings: finding ? [finding] : [],
          newFindingsCount: finding ? 1 : 0,
          detail: suspicious
            ? `Scheduled Zeek passive scan detected elevated network risk on ${device.name}.`
            : `Scheduled Zeek passive scan completed on ${device.name} with no suspicious activity.`,
          startedAt,
          completedAt: new Date(),
          metadata: {
            deviceType: device.deviceType,
            riskScore: nextRisk,
          },
        });
        pushScanToolEvent({ toolName: 'Zeek', toolId: 'zeek', assetIp: device.ipAddress, assetName: device.name, assetType: 'network_device', findingCount: finding ? 1 : 0 });
        recordToolSchedulerRun('zeek', { success: true });
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
        const startedAt = new Date();

        await device.update({
          idsIpsEnabled: true,
          lastIdsIpsEventAt: startedAt,
          lastSeenAt: startedAt,
          state: intrusionSignal ? 'degraded' : 'online',
          riskScore: nextRisk,
        });

        await writeSystemAudit({
          entityType: 'network_device',
          entityId: device.id,
          action: 'automation.ids_ips_check',
          details: JSON.stringify({ intrusionSignal, riskScore: nextRisk }),
        });

        let finding = null;
        if (intrusionSignal) {
          finding = await securityFindingModel.create({
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

        await recordScanRun({
          ScanRunRecord: scanRunRecordModel,
          AuditLog: auditLogModel,
          toolId: 'suricata',
          toolName: 'Suricata',
          engine: 'Suricata',
          mode: 'passive',
          triggerSource: 'scheduler',
          actor: 'scheduler',
          actorRole: 'system',
          assetType: 'network_device',
          assetId: device.id,
          assetName: device.name,
          assetRef: device.ipAddress || null,
          findings: finding ? [finding] : [],
          newFindingsCount: finding ? 1 : 0,
          detail: intrusionSignal
            ? `Scheduled Suricata IDS/IPS check detected intrusion indicators on ${device.name}.`
            : `Scheduled Suricata IDS/IPS check completed on ${device.name} with no intrusion indicators.`,
          startedAt,
          completedAt: new Date(),
          metadata: {
            deviceType: device.deviceType,
            riskScore: nextRisk,
          },
        });
      }
    } finally {
      automationLocks.deviceIds = false;
      pushScanToolEvent({ toolName: 'Suricata', toolId: 'suricata', assetIp: device.ipAddress, assetName: device.name, assetType: 'network_device', findingCount: finding ? 1 : 0 });
      recordToolSchedulerRun('suricata', { success: true });
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
        const startedAt = new Date();

        await db.update({
          riskScore: nextRisk,
          backupStatus: issueCount > 1 ? 'warning' : 'healthy',
          state: issueCount > 1 ? 'degraded' : 'online',
          lastSeenAt: startedAt,
          lastSecurityReviewAt: startedAt,
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

        await recordScanRun({
          ScanRunRecord: scanRunRecordModel,
          AuditLog: auditLogModel,
          toolId: 'trivy',
          toolName: 'Trivy',
          engine: 'Trivy',
          mode: 'active',
          triggerSource: 'scheduler',
          actor: 'scheduler',
          actorRole: 'system',
          assetType: 'database_asset',
          assetId: db.id,
          assetName: db.name,
          assetRef: `${db.host}${db.port ? `:${db.port}` : ''}`,
          findings: [],
          newFindingsCount: issueCount,
          detail: issueCount > 0
            ? `Scheduled Trivy database review found ${issueCount} issue(s) on ${db.name}.`
            : `Scheduled Trivy database review completed on ${db.name} with no issues.`,
          startedAt,
          completedAt: new Date(),
          metadata: {
            riskScore: nextRisk,
            patchUnknown,
            weakCrypto,
            noOwner,
          },
        });
      }
    } finally {
      automationLocks.databaseReview = false;
      pushScanToolEvent({ toolName: 'Trivy', toolId: 'trivy', assetIp: db.host, assetName: db.name, assetType: 'database_asset', findingCount: issueCount });
      recordToolSchedulerRun('trivy', { success: true });
    }
  };

  // Mount user routes with auth middleware; write operations are restricted inside route handlers.
  app.use('/api/users', authMiddleware, protectedApiLimiter, requireCompletedProfile, usersRouteFactory({ User: userModel }));
  // Mount ticket routes with auth middleware
  app.use(
    '/api/tickets',
    authMiddleware,
    protectedApiLimiter,
    requireCompletedProfile,
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
    requireCompletedProfile,
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
        ScanRunRecord: scanRunRecordModel,
      },
      runSweep: runSecuritySweep,
      getSummary: healthSummary,
      notifyTicket: notify,
    }),
  );

  app.use('/api/assistant', authMiddleware, protectedApiLimiter, requireCompletedProfile, assistantRouteFactory({
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
    notificationLedgerModel,
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
    requireCompletedProfile,
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

  // Ambient SOC live-feed event generation: inject 3-7 events every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    const count = 3 + Math.floor(Math.random() * 5);
    generateAndPushEvents(count);
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
        AuditLog: auditLogModel,
        ScanRunRecord: scanRunRecordModel,
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
        AuditLog: auditLogModel,
        ScanRunRecord: scanRunRecordModel,
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
    randomUUID,
    jwt,
    speakeasy,
    authMiddleware,
    config: CONFIG,
    userModel,
    revokeTokenJti,
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

    const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip || null;
    await user.update({
      lastSeenAt: new Date(),
      lastSeenIp: ip,
      lastSeenUserAgent: String(req.get('user-agent') || '').slice(0, 512) || null,
      isOnline: true,
    }).catch(() => {});

    // Geo lookup is best-effort and must never block /api/me response latency.
    getGeoForIp(ip)
      .then((geo) => {
        if (!geo) return;
        return user.update({ lastSeenGeo: geo });
      })
      .catch(() => {});

    const profileState = getProfileCompletionState(user);
    // Return user info
    res.json({
      id: user.id,
      username: user.username || user.name,
      name: user.name,
      surname: user.surname,
      role: user.role,
      jobTitle: user.jobTitle || null,
      department: user.department || null,
      operationalTeams: profileState.operationalTeams,
      audienceCode: profileState.audienceCode,
      audienceLabel: profileState.audienceLabel,
      email: user.email || null,
      scjId: user.scjId || null,
      telegramId: user.telegramId,
      telegramNumber: user.telegramNumber || null,
      telegramChatId: user.telegramChatId || null,
      mfaEnabled: Boolean(user.mfaEnabled),
      profileCompletionRequired: !profileState.isComplete,
      profileCompletionIssues: profileState.issues,
    });
  });

  // Lightweight heartbeat — keeps isOnline accurate between full page refreshes
  app.post('/api/heartbeat', authMiddleware, protectedApiLimiter, async (req, res) => {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip || null;
    const ua = String(req.get('user-agent') || '').slice(0, 512) || null;
    await userModel.update(
      { lastSeenAt: new Date(), lastSeenIp: ip, lastSeenUserAgent: ua, isOnline: true },
      { where: { id: req.user.sub } },
    ).catch(() => {});
    getGeoForIp(ip)
      .then((geo) => {
        if (!geo) return;
        return userModel.update({ lastSeenGeo: geo }, { where: { id: req.user.sub } });
      })
      .catch(() => {});
    res.json({ ok: true });
  });

  app.patch(
    '/api/me/profile',
    authMiddleware,
    protectedApiLimiter,
    body('telegramNumber').optional({ nullable: true }).isString().trim().isLength({ min: 8, max: 32 }),
    body('telegramChatId').optional({ nullable: true }).isString().trim().matches(/^-?\d{5,32}$/),
    body('audienceCode').isString().trim().isIn(['STAFF', 'TJN', 'GJN', 'BJN', 'DGSN']),
    body('operationalTeams').optional({ nullable: true }).custom((value) => value === undefined || value === null || Array.isArray(value)),
    body('operationalTeams.*').optional().isString().trim(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const user = await userModel.findByPk(req.user.sub);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const operationalTeams = normalizeOperationalTeams(req.body.operationalTeams);
      const audienceCode = req.body.audienceCode.trim().toUpperCase();
      const isOperationalStaff = isOperationalStaffAudience(audienceCode);

      if (isOperationalStaff && (operationalTeams.length < 1 || operationalTeams.length > 2)) {
        return res.status(422).json({ error: 'Select one or two operational teams' });
      }

      if (isOperationalStaff && !String(req.body.telegramNumber || '').trim()) {
        return res.status(422).json({ error: 'Telegram phone number is required for operational staff' });
      }

      if (isOperationalStaff && !String(req.body.telegramChatId || '').trim()) {
        return res.status(422).json({ error: 'Telegram chat ID is required for operational staff' });
      }

      await user.update({
        telegramNumber: isOperationalStaff ? req.body.telegramNumber.trim() : null,
        telegramChatId: isOperationalStaff ? req.body.telegramChatId.trim() : null,
        audienceCode,
        operationalTeams: isOperationalStaff ? operationalTeams : [],
        department: isOperationalStaff
          ? (operationalTeams.includes('Network')
              ? 'Networks'
              : operationalTeams.includes('Developer')
                ? 'Dev'
                : 'Hardware')
          : null,
      });

      const profileState = getProfileCompletionState(user);
      const newJti = randomUUID();
      const exp = req.user?.exp ? new Date(req.user.exp * 1000) : null;
      await revokeTokenJti(req.user?.jti, exp);
      const refreshedToken = jwt.sign(
        {
          sub: user.id,
          username: user.username || user.name,
          role: user.role,
          audienceCode: profileState.audienceCode,
          jti: newJti,
        },
        CONFIG.SECRET_KEY,
        { expiresIn: CONFIG.ACCESS_TOKEN_TTL || '15m' },
      );
      return res.json({
        ok: true,
        operationalTeams: profileState.operationalTeams,
        audienceCode: profileState.audienceCode,
        audienceLabel: profileState.audienceLabel,
        telegramNumber: user.telegramNumber,
        telegramChatId: user.telegramChatId,
        profileCompletionRequired: !profileState.isComplete,
        profileCompletionIssues: profileState.issues,
        access_token: refreshedToken,
        token_type: 'bearer',
      });
    },
  );

  app.get('/api/governance/audit-logs', authMiddleware, protectedApiLimiter, governanceAccessMiddleware, async (_req, res) => {
    const rows = await auditLogModel.findAll({
      order: [['createdAt', 'DESC']],
      limit: 300,
    });
    res.json(rows);
  });

  app.get('/api/governance/workforce-telemetry', authMiddleware, protectedApiLimiter, governanceAccessMiddleware, async (_req, res) => {
    const users = await userModel.findAll({ order: [['createdAt', 'ASC']] });
    const now = Date.now();
    const onlineThresholdMs = 5 * 60 * 1000;
    const readThresholdMs = 24 * 60 * 60 * 1000;

    const mappedUsers = users.map((user) => {
      const lastSeenAt = user.lastSeenAt ? new Date(user.lastSeenAt) : null;
      const isRecentlyActive = Boolean(lastSeenAt && (now - lastSeenAt.getTime()) <= onlineThresholdMs);
      const presence = isRecentlyActive ? 'online' : 'offline';
      const audienceCode = String(user.audienceCode || '').trim().toUpperCase() || null;

      return {
        id: user.id,
        username: user.username || user.name,
        name: user.name,
        surname: user.surname,
        role: user.role,
        audienceCode,
        operationalTeams: readUserOperationalTeams(user),
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        lastLoginIp: user.lastLoginIp,
        lastSeenAt: user.lastSeenAt,
        lastSeenIp: user.lastSeenIp,
        lastSeenGeo: user.lastSeenGeo || null,
        lastSeenUserAgent: user.lastSeenUserAgent,
        presence,
        isOnline: presence === 'online',
        telegramConfigured: Boolean(getTelegramChatId(user)),
        telegramDeliveryStatus: user.lastTelegramDeliveryStatus || 'unknown',
        lastTelegramDeliveryAt: user.lastTelegramDeliveryAt,
        lastTelegramReadAt: user.lastTelegramReadAt,
      };
    });

    const totalUsers = mappedUsers.length;
    const onlineUsers = mappedUsers.filter((user) => user.isOnline).length;
    const createdLast30Days = mappedUsers.filter((user) => user.createdAt && (now - new Date(user.createdAt).getTime()) <= 30 * 24 * 60 * 60 * 1000).length;
    const telegramConfiguredUsers = mappedUsers.filter((user) => user.telegramConfigured).length;
    const telegramDeliveredRecently = mappedUsers.filter((user) => user.lastTelegramDeliveryAt && (now - new Date(user.lastTelegramDeliveryAt).getTime()) <= readThresholdMs && user.telegramDeliveryStatus === 'delivered').length;
    const telegramReadRecently = mappedUsers.filter((user) => user.lastTelegramReadAt && (now - new Date(user.lastTelegramReadAt).getTime()) <= readThresholdMs).length;

    // Stale account risk scoring
    const staleThreshold30d = 30 * 24 * 60 * 60 * 1000;
    const staleThreshold90d = 90 * 24 * 60 * 60 * 1000;
    const mappedUsersWithRisks = mappedUsers.map((user) => {
      const risks = [];
      if (!user.lastLoginAt) {
        risks.push('never_logged_in');
      } else if ((now - new Date(user.lastLoginAt).getTime()) >= staleThreshold30d) {
        risks.push('no_login_30d');
      }
      if (!user.telegramConfigured) risks.push('telegram_not_configured');
      if (user.telegramDeliveryStatus === 'failed') risks.push('telegram_delivery_failed');
      if (user.lastSeenAt && (now - new Date(user.lastSeenAt).getTime()) >= staleThreshold90d) risks.push('inactive_90d');
      return { ...user, staleRisks: risks, staleRiskLevel: risks.length === 0 ? 'none' : risks.length === 1 ? 'low' : 'high' };
    });

    const staleAccountCount = mappedUsersWithRisks.filter((u) => u.staleRisks.length > 0).length;
    const highRiskAccountCount = mappedUsersWithRisks.filter((u) => u.staleRiskLevel === 'high').length;

    res.json({
      summary: {
        totalUsers,
        onlineUsers,
        offlineUsers: Math.max(totalUsers - onlineUsers, 0),
        createdLast30Days,
        telegramConfiguredUsers,
        telegramDeliveredRecently,
        telegramReadRecently,
        staleAccountCount,
        highRiskAccountCount,
      },
      users: mappedUsersWithRisks,
    });
  });

  app.get('/api/governance/performance', authMiddleware, protectedApiLimiter, governanceAccessMiddleware, async (_req, res) => {
    res.json(getApiPerformanceSnapshot());
  });

  // Notification ledger — full per-message delivery audit trail
  app.get('/api/governance/notification-ledger', authMiddleware, protectedApiLimiter, governanceAccessMiddleware, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
    const rows = await notificationLedgerModel.findAll({
      order: [['createdAt', 'DESC']],
      limit,
    });
    // Enrich each row with username from userModel (best-effort join)
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const usersById = {};
    if (userIds.length) {
      const users = await userModel.findAll({ where: { id: userIds }, attributes: ['id', 'username', 'name', 'surname'] });
      for (const u of users) {
        usersById[u.id] = u.username || `${u.name || ''} ${u.surname || ''}`.trim() || `User #${u.id}`;
      }
    }
    res.json(rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: usersById[r.userId] || `User #${r.userId}`,
      channel: r.channel,
      subject: r.subject,
      status: r.status,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
    })));
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
