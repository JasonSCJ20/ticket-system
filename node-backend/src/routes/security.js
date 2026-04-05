import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { Op } from 'sequelize';
import { ingestFinding } from '../services/securityEngine.js';
import { DETECTION_STACK, enrichFindingRecord } from '../services/findingIntelligence.js';

const router = express.Router();
const SCJ_ID_REGEX = /^\d{8}-\d{5}$/;
const ANALYTICS_CACHE_TTL_MS = 12000;

async function probeApplicationRuntime(baseUrl) {
  if (!baseUrl) {
    return {
      powerState: 'unknown',
      runtimeState: 'unknown',
      runtimeReason: 'No base URL configured',
      httpStatus: null,
      checkedAt: new Date().toISOString(),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });

    const ok = response.status < 500;
    return {
      powerState: ok ? 'on' : 'off',
      runtimeState: ok ? 'running' : 'down',
      runtimeReason: ok ? 'Application endpoint responded' : `Endpoint returned status ${response.status}`,
      httpStatus: response.status,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = String(err?.message || err || 'Unknown runtime probe failure');
    return {
      powerState: 'off',
      runtimeState: 'down',
      runtimeReason: message.slice(0, 220),
      httpStatus: null,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default ({ models, runSweep, getSummary, notifyTicket }) => {
  const {
    ApplicationAsset,
    SecurityFinding,
    Ticket,
    TicketHistory,
    User,
    ConnectorDeadLetter,
    AuditLog,
    NetworkDevice,
    DatabaseAsset,
    PatchTask,
  } = models;

  const validPatchAssetTypes = ['application', 'network_device', 'database_asset'];
  const validPatchStatuses = ['todo', 'in_progress', 'completed'];
  const scanJobState = {
    runningByMode: {
      passive: false,
      active: false,
    },
    queueByMode: {
      passive: [],
      active: [],
    },
    jobs: new Map(),
    nextId: 1,
  };
  const SCAN_JOB_HISTORY_LIMIT = 120;
  let analyticsCacheVersion = 0;
  const analyticsCache = new Map();

  const readAnalyticsCache = (key) => {
    const entry = analyticsCache.get(key);
    if (!entry) return null;

    const isExpired = (Date.now() - entry.createdAt) > ANALYTICS_CACHE_TTL_MS;
    if (isExpired || entry.version !== analyticsCacheVersion) {
      analyticsCache.delete(key);
      return null;
    }

    return entry.payload;
  };

  const writeAnalyticsCache = (key, payload) => {
    analyticsCache.set(key, {
      payload,
      version: analyticsCacheVersion,
      createdAt: Date.now(),
    });
  };

  // Successful writes invalidate cached analytics snapshots.
  router.use((req, res, next) => {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();

    res.on('finish', () => {
      if (res.statusCode < 400) {
        analyticsCacheVersion += 1;
        analyticsCache.clear();
      }
    });
    next();
  });

  const trimScanJobHistory = () => {
    if (scanJobState.jobs.size <= SCAN_JOB_HISTORY_LIMIT) return;
    const ordered = Array.from(scanJobState.jobs.values())
      .sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime());
    while (ordered.length > SCAN_JOB_HISTORY_LIMIT) {
      const oldest = ordered.shift();
      if (oldest) scanJobState.jobs.delete(oldest.id);
    }
  };

  const findOpenJobByMode = (mode) => {
    const running = Array.from(scanJobState.jobs.values())
      .find((job) => job.mode === mode && job.status === 'running');
    if (running) return running;
    return scanJobState.queueByMode[mode]?.[0] || null;
  };

  const processScanQueue = async (mode) => {
    if (!scanJobState.queueByMode[mode]) return;
    if (scanJobState.runningByMode[mode]) return;

    const nextJob = scanJobState.queueByMode[mode].shift();
    if (!nextJob) return;

    scanJobState.runningByMode[mode] = true;
    nextJob.status = 'running';
    nextJob.startedAt = new Date().toISOString();

    try {
      const findings = await runSweep({ mode: nextJob.mode, actor: nextJob.actor, models, notifyTicket });
      nextJob.status = 'completed';
      nextJob.findingsCreated = Array.isArray(findings) ? findings.length : 0;
      nextJob.message = `${nextJob.mode} scan completed with ${nextJob.findingsCreated} findings.`;
    } catch (err) {
      nextJob.status = 'failed';
      nextJob.findingsCreated = 0;
      nextJob.error = String(err?.message || err || 'Scan execution failed');
      nextJob.message = `${nextJob.mode} scan failed. See job error for details.`;
    } finally {
      nextJob.finishedAt = new Date().toISOString();
      scanJobState.runningByMode[mode] = false;
      trimScanJobHistory();
      // Continue processing without blocking the request lifecycle.
      setImmediate(() => {
        processScanQueue(mode).catch(() => {});
      });
    }
  };

  const enqueueScanJob = (mode, actor) => {
    const existing = findOpenJobByMode(mode);
    if (existing) {
      return {
        job: existing,
        queued: false,
        coalesced: true,
      };
    }

    const jobId = `scan-${scanJobState.nextId}`;
    scanJobState.nextId += 1;
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      mode,
      actor,
      status: 'queued',
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      findingsCreated: null,
      error: null,
      message: `${mode} scan queued for execution.`,
    };

    scanJobState.queueByMode[mode].push(job);
    scanJobState.jobs.set(job.id, job);
    trimScanJobHistory();

    // Fire-and-forget queue pump.
    setImmediate(() => {
      processScanQueue(mode).catch(() => {});
    });

    return {
      job,
      queued: true,
      coalesced: false,
    };
  };

  const resolvePatchAsset = async (assetType, assetId) => {
    if (assetType === 'application') {
      const asset = await ApplicationAsset.findByPk(assetId);
      return asset ? { id: asset.id, name: asset.name } : null;
    }
    if (assetType === 'network_device') {
      const asset = await NetworkDevice.findByPk(assetId);
      return asset ? { id: asset.id, name: asset.name } : null;
    }
    if (assetType === 'database_asset') {
      const asset = await DatabaseAsset.findByPk(assetId);
      return asset ? { id: asset.id, name: asset.name } : null;
    }
    return null;
  };

  const adminOnly = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };

  router.get('/network/devices', async (_req, res) => {
    const devices = await NetworkDevice.findAll({ order: [['deviceType', 'ASC'], ['name', 'ASC']] });
    return res.json(devices);
  });

  router.post(
    '/network/devices',
    adminOnly,
    body('name').isString().trim().isLength({ min: 2, max: 128 }),
    body('deviceType').isIn(['router', 'switch', 'access_point', 'endpoint', 'firewall', 'server', 'other']),
    body('ipAddress').optional().isIP(),
    body('location').optional().isString().trim().isLength({ min: 2, max: 128 }),
    body('vendor').optional().isString().trim().isLength({ min: 2, max: 128 }),
    body('model').optional().isString().trim().isLength({ min: 1, max: 128 }),
    body('firmwareVersion').optional().isString().trim().isLength({ min: 1, max: 64 }),
    body('idsIpsEnabled').optional().isBoolean(),
    body('passiveScanEnabled').optional().isBoolean(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      try {
        const created = await NetworkDevice.create({
          name: req.body.name.trim(),
          deviceType: req.body.deviceType,
          ipAddress: req.body.ipAddress || null,
          location: req.body.location || 'Server Room',
          vendor: req.body.vendor || null,
          model: req.body.model || null,
          firmwareVersion: req.body.firmwareVersion || null,
          idsIpsEnabled: Boolean(req.body.idsIpsEnabled),
          passiveScanEnabled: Boolean(req.body.passiveScanEnabled),
          state: 'online',
          lastSeenAt: new Date(),
          riskScore: req.body.deviceType === 'router' || req.body.deviceType === 'firewall' ? 55 : 35,
        });
        return res.status(201).json(created);
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({ error: 'Device already exists' });
        }
        throw err;
      }
    },
  );

  router.post('/network/devices/:id/passive-scan', adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const device = await NetworkDevice.findByPk(Number(req.params.id));
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const suspicious = Math.random() > 0.55;
    const now = new Date();
    await device.update({
      passiveScanEnabled: true,
      lastPassiveScanAt: now,
      state: suspicious ? 'degraded' : 'online',
      riskScore: Math.min(100, suspicious ? device.riskScore + 8 : Math.max(10, device.riskScore - 4)),
      lastSeenAt: now,
    });

    let createdFinding = null;
    if (suspicious) {
      const fallbackApp = await ApplicationAsset.findOne({ order: [['id', 'ASC']] });
      if (fallbackApp) {
        createdFinding = await SecurityFinding.create({
          applicationAssetId: fallbackApp.id,
          sourceTool: 'Passive Network Scan',
          detectionMode: 'passive',
          category: 'network',
          severity: device.deviceType === 'router' || device.deviceType === 'firewall' ? 'high' : 'medium',
          title: `Suspicious traffic profile detected on ${device.name}`,
          description: `Passive telemetry observed unusual communication patterns from ${device.name} (${device.ipAddress || 'unknown IP'})`,
          evidence: `device=${device.name}; type=${device.deviceType}; location=${device.location || 'n/a'}`,
          status: 'new',
          requiresManualConfirmation: true,
          manualConfirmed: false,
        });
      }
    }

    return res.json({ scanned: true, suspicious, findingId: createdFinding?.id || null, device });
  });

  router.post('/network/devices/:id/ids-ips-check', adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const device = await NetworkDevice.findByPk(Number(req.params.id));
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const intrusionDetected = Math.random() > 0.68;
    const now = new Date();
    await device.update({
      idsIpsEnabled: true,
      lastIdsIpsEventAt: now,
      state: intrusionDetected ? 'degraded' : 'online',
      riskScore: Math.min(100, intrusionDetected ? device.riskScore + 12 : Math.max(10, device.riskScore - 3)),
      lastSeenAt: now,
    });

    let createdFinding = null;
    if (intrusionDetected) {
      const fallbackApp = await ApplicationAsset.findOne({ order: [['id', 'ASC']] });
      if (fallbackApp) {
        createdFinding = await SecurityFinding.create({
          applicationAssetId: fallbackApp.id,
          sourceTool: 'IDS/IPS Check',
          detectionMode: 'passive',
          category: 'intrusion',
          severity: device.deviceType === 'router' || device.deviceType === 'firewall' ? 'critical' : 'high',
          title: `Potential intrusion activity flagged on ${device.name}`,
          description: `IDS/IPS heuristic triggered for ${device.name}. Investigate east-west and north-south flows immediately.`,
          evidence: `device=${device.name}; type=${device.deviceType}; ip=${device.ipAddress || 'n/a'}`,
          status: 'new',
          requiresManualConfirmation: false,
          manualConfirmed: true,
          manualConfirmedBy: req.user.username,
        });
      }
    }

    return res.json({ checked: true, intrusionDetected, findingId: createdFinding?.id || null, device });
  });

  router.get('/database/assets', async (_req, res) => {
    const assets = await DatabaseAsset.findAll({ order: [['criticality', 'DESC'], ['name', 'ASC']] });
    return res.json(assets);
  });

  router.post(
    '/database/assets',
    adminOnly,
    body('name').isString().trim().isLength({ min: 2, max: 128 }),
    body('engine').isIn(['postgresql', 'mysql', 'mssql', 'oracle', 'mongodb', 'redis', 'other']),
    body('environment').isIn(['on_prem', 'cloud', 'hybrid']),
    body('host').isString().trim().isLength({ min: 2, max: 255 }),
    body('port').optional().isInt({ min: 1, max: 65535 }),
    body('ownerEmail').optional().isEmail().normalizeEmail(),
    body('criticality').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('patchLevel').optional().isString().trim().isLength({ min: 1, max: 128 }),
    body('encryptionAtRest').optional().isBoolean(),
    body('tlsInTransit').optional().isBoolean(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      try {
        const asset = await DatabaseAsset.create({
          name: req.body.name.trim(),
          engine: req.body.engine,
          environment: req.body.environment,
          host: req.body.host.trim(),
          port: req.body.port || null,
          ownerEmail: req.body.ownerEmail || null,
          criticality: req.body.criticality || 'high',
          patchLevel: req.body.patchLevel || 'unknown',
          encryptionAtRest: Boolean(req.body.encryptionAtRest),
          tlsInTransit: Boolean(req.body.tlsInTransit),
          state: 'online',
          backupStatus: 'unknown',
          lastSeenAt: new Date(),
          riskScore: req.body.criticality === 'critical' ? 78 : req.body.criticality === 'high' ? 62 : 40,
        });
        return res.status(201).json(asset);
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({ error: 'Database asset already exists' });
        }
        throw err;
      }
    },
  );

  router.post('/database/assets/:id/security-scan', adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await DatabaseAsset.findByPk(Number(req.params.id));
    if (!asset) return res.status(404).json({ error: 'Database asset not found' });

    const now = new Date();
    const patchNeeded = !asset.patchLevel || String(asset.patchLevel).toLowerCase().includes('unknown');
    const weakCrypto = !asset.encryptionAtRest || !asset.tlsInTransit;
    const findings = [];
    let score = asset.riskScore;

    if (patchNeeded) {
      findings.push('Patch level could not be verified; update to latest vendor-supported security release.');
      score = Math.min(100, score + 10);
    }
    if (weakCrypto) {
      findings.push('Encryption controls are incomplete; enable encryption at rest and TLS in transit.');
      score = Math.min(100, score + 12);
    }
    if (!asset.ownerEmail) {
      findings.push('No owner assigned; assign accountable DBA/service owner for vulnerability triage and sign-off.');
      score = Math.min(100, score + 6);
    }

    await asset.update({
      riskScore: findings.length ? score : Math.max(15, score - 5),
      lastSecurityReviewAt: now,
      backupStatus: findings.length ? 'warning' : 'healthy',
      state: findings.length > 1 ? 'degraded' : 'online',
      lastSeenAt: now,
    });

    return res.json({ scanned: true, findings, asset });
  });

  router.get('/database/overview', async (_req, res) => {
    const cacheKey = 'database-overview';
    const cached = readAnalyticsCache(cacheKey);
    if (cached) return res.json(cached);

    const assets = await DatabaseAsset.findAll({ order: [['criticality', 'DESC'], ['name', 'ASC']] });
    const online = assets.filter((a) => a.state === 'online').length;
    const degraded = assets.filter((a) => a.state === 'degraded').length;
    const critical = assets.filter((a) => a.criticality === 'critical').length;
    const avgRisk = assets.length
      ? Number((assets.reduce((acc, a) => acc + (a.riskScore || 0), 0) / assets.length).toFixed(1))
      : 0;

    const patchRecommendations = [];
    if (assets.some((a) => !a.patchLevel || String(a.patchLevel).toLowerCase().includes('unknown'))) {
      patchRecommendations.push('Standardize DB patch cadence: critical patches within 7 days, high within 14 days, medium within 30 days.');
    }
    if (assets.some((a) => !a.encryptionAtRest)) {
      patchRecommendations.push('Enable encryption at rest for all production and backup database volumes.');
    }
    if (assets.some((a) => !a.tlsInTransit)) {
      patchRecommendations.push('Enforce TLS 1.2+ for all database client/server connections and disable plaintext transport.');
    }
    if (assets.some((a) => a.backupStatus !== 'healthy')) {
      patchRecommendations.push('Automate backup integrity tests and restore drills for on-prem and hybrid recovery assurance.');
    }
    if (assets.some((a) => !a.ownerEmail)) {
      patchRecommendations.push('Assign owner per database to accelerate remediation and audit accountability.');
    }
    if (patchRecommendations.length === 0) {
      patchRecommendations.push('Database controls are in a healthy baseline. Continue monthly patch validation and access review hardening.');
    }

    const databaseOverviewPayload = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalDatabases: assets.length,
        online,
        degraded,
        critical,
        avgRisk,
      },
      assets,
      patchRecommendations,
    };

    writeAnalyticsCache(cacheKey, databaseOverviewPayload);
    return res.json(databaseOverviewPayload);
  });

  router.get(
    '/patches',
    query('status').optional().isIn(validPatchStatuses),
    query('assetType').optional().isIn(validPatchAssetTypes),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.assetType) where.assetType = req.query.assetType;

      const items = await PatchTask.findAll({
        where,
        order: [['status', 'ASC'], ['severity', 'DESC'], ['dueDate', 'ASC'], ['createdAt', 'DESC']],
        limit: 1000,
      });

      const grouped = {
        application: { todo: [], in_progress: [], completed: [] },
        network_device: { todo: [], in_progress: [], completed: [] },
        database_asset: { todo: [], in_progress: [], completed: [] },
      };

      const byStatus = { todo: 0, in_progress: 0, completed: 0 };
      const byAssetType = { application: 0, network_device: 0, database_asset: 0 };
      const now = Date.now();
      let overdue = 0;

      const normalized = items.map((item) => {
        const row = item.toJSON();
        if (grouped[row.assetType]?.[row.status]) grouped[row.assetType][row.status].push(row);
        if (typeof byStatus[row.status] === 'number') byStatus[row.status] += 1;
        if (typeof byAssetType[row.assetType] === 'number') byAssetType[row.assetType] += 1;
        if (row.status !== 'completed' && row.dueDate && new Date(row.dueDate).getTime() < now) overdue += 1;
        return row;
      });

      return res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          total: normalized.length,
          overdue,
          byStatus,
          byAssetType,
          completionRate: normalized.length ? Number(((byStatus.completed / normalized.length) * 100).toFixed(1)) : 0,
        },
        grouped,
        items: normalized,
      });
    },
  );

  router.post(
    '/patches',
    adminOnly,
    body('assetType').isIn(validPatchAssetTypes),
    body('assetId').isInt({ min: 1 }),
    body('title').isString().trim().isLength({ min: 4, max: 255 }),
    body('description').optional().isString().trim().isLength({ min: 4, max: 5000 }),
    body('status').optional().isIn(validPatchStatuses),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('currentVersion').optional().isString().trim().isLength({ min: 1, max: 128 }),
    body('targetVersion').optional().isString().trim().isLength({ min: 1, max: 128 }),
    body('ownerEmail').optional().isEmail().normalizeEmail(),
    body('dueDate').optional().isISO8601(),
    body('notes').optional().isString().trim().isLength({ min: 1, max: 5000 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const assetType = req.body.assetType;
      const assetId = Number(req.body.assetId);
      const asset = await resolvePatchAsset(assetType, assetId);
      if (!asset) return res.status(404).json({ error: 'Referenced asset was not found' });

      const created = await PatchTask.create({
        assetType,
        assetId,
        assetName: asset.name,
        title: req.body.title.trim(),
        description: req.body.description || null,
        status: req.body.status || 'todo',
        severity: req.body.severity || 'medium',
        currentVersion: req.body.currentVersion || null,
        targetVersion: req.body.targetVersion || null,
        ownerEmail: req.body.ownerEmail || null,
        dueDate: req.body.dueDate || null,
        notes: req.body.notes || null,
        lastActionAt: new Date(),
        createdBy: req.user?.username || 'unknown',
        updatedBy: req.user?.username || 'unknown',
        completedAt: req.body.status === 'completed' ? new Date() : null,
      });

      return res.status(201).json(created);
    },
  );

  router.patch(
    '/patches/:id/status',
    adminOnly,
    param('id').isInt({ min: 1 }),
    body('status').isIn(validPatchStatuses),
    body('notes').optional().isString().trim().isLength({ min: 1, max: 5000 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const task = await PatchTask.findByPk(Number(req.params.id));
      if (!task) return res.status(404).json({ error: 'Patch task not found' });

      const nextStatus = req.body.status;
      await task.update({
        status: nextStatus,
        notes: req.body.notes ? req.body.notes.trim() : task.notes,
        completedAt: nextStatus === 'completed' ? new Date() : null,
        lastActionAt: new Date(),
        updatedBy: req.user?.username || 'unknown',
      });

      return res.json(task);
    },
  );

  router.get('/health-summary', async (_req, res) => {
    const cacheKey = 'health-summary';
    const cached = readAnalyticsCache(cacheKey);
    if (cached) return res.json(cached);

    const summary = await getSummary(models);
    writeAnalyticsCache(cacheKey, summary);
    return res.json(summary);
  });

  router.get('/fortress/posture', async (_req, res) => {
    const cacheKey = 'fortress-posture';
    const cached = readAnalyticsCache(cacheKey);
    if (cached) return res.json(cached);

    const [
      adminCount,
      activeFindings,
      criticalFindings,
      intrusionFindings,
      applications,
      patchTasks,
      databases,
      devices,
      auditEvents,
      privilegedAuditEvents,
      recentPrivilegedActions,
      recentToolingHeartbeats,
    ] = await Promise.all([
      User.count({ where: { role: 'admin' } }),
      SecurityFinding.count({ where: { status: { [Op.in]: ['new', 'investigating'] } } }),
      SecurityFinding.count({ where: { severity: 'critical', status: { [Op.in]: ['new', 'investigating'] } } }),
      SecurityFinding.count({ where: { category: 'intrusion', status: { [Op.in]: ['new', 'investigating'] } } }),
      ApplicationAsset.findAll({
        attributes: ['id', 'lastActiveScanAt', 'lastPassiveScanAt', 'updatedAt'],
        raw: true,
      }),
      PatchTask.findAll({
        attributes: ['status', 'dueDate', 'lastActionAt', 'updatedAt'],
        raw: true,
      }),
      DatabaseAsset.findAll({
        attributes: ['state', 'backupStatus', 'encryptionAtRest', 'tlsInTransit', 'lastSecurityReviewAt', 'updatedAt'],
        raw: true,
      }),
      NetworkDevice.findAll({
        attributes: ['state', 'idsIpsEnabled', 'passiveScanEnabled', 'lastIdsIpsEventAt', 'lastPassiveScanAt', 'updatedAt'],
        raw: true,
      }),
      AuditLog.count(),
      AuditLog.count({ where: { actorRole: 'admin' } }),
      AuditLog.findAll({
        where: { actorRole: 'admin' },
        attributes: ['id', 'actor', 'action', 'entityType', 'entityId', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 5,
        raw: true,
      }),
      AuditLog.findAll({
        where: {
          entityType: 'fortress_tooling',
          action: 'fortress.tooling_heartbeat',
        },
        attributes: ['entityId', 'details', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 250,
        raw: true,
      }),
    ]);

    const pendingPatches = patchTasks.filter((task) => task.status !== 'completed').length;
    const overduePatches = patchTasks.filter((task) => task.status !== 'completed' && task.dueDate && new Date(task.dueDate).getTime() < Date.now()).length;
    const hardenedDatabases = databases.filter((asset) => asset.encryptionAtRest && asset.tlsInTransit).length;
    const healthyBackups = databases.filter((asset) => asset.backupStatus === 'healthy').length;
    const warningBackups = databases.filter((asset) => asset.backupStatus === 'warning').length;
    const criticalBackups = databases.filter((asset) => asset.backupStatus === 'critical').length;
    const onlineDevices = devices.filter((device) => device.state === 'online').length;
    const offlineDevices = devices.filter((device) => device.state === 'offline').length;
    const degradedDevices = devices.filter((device) => device.state === 'degraded').length;
    const idsEnabledDevices = devices.filter((device) => device.idsIpsEnabled).length;
    const passiveScanEnabledDevices = devices.filter((device) => device.passiveScanEnabled).length;
    const recentlyReviewedDatabases = databases.filter((asset) => asset.lastSecurityReviewAt && (Date.now() - new Date(asset.lastSecurityReviewAt).getTime()) <= (30 * 24 * 60 * 60 * 1000)).length;
    const nowMs = Date.now();
    const scanWindowMs = 15 * 60 * 1000;

    const recentIdsChecks = devices.filter((device) => (
      device.lastIdsIpsEventAt && (nowMs - new Date(device.lastIdsIpsEventAt).getTime()) <= scanWindowMs
    )).length;
    const recentPassiveScans = devices.filter((device) => (
      device.lastPassiveScanAt && (nowMs - new Date(device.lastPassiveScanAt).getTime()) <= scanWindowMs
    )).length;
    const recentActiveAppScans = applications.filter((asset) => (
      asset.lastActiveScanAt && (nowMs - new Date(asset.lastActiveScanAt).getTime()) <= scanWindowMs
    )).length;
    const recentPassiveAppScans = applications.filter((asset) => (
      asset.lastPassiveScanAt && (nowMs - new Date(asset.lastPassiveScanAt).getTime()) <= scanWindowMs
    )).length;
    const recentDatabaseScans = databases.filter((asset) => (
      asset.lastSecurityReviewAt && (nowMs - new Date(asset.lastSecurityReviewAt).getTime()) <= scanWindowMs
    )).length;
    const inProgressPatchTasks = patchTasks.filter((task) => task.status === 'in_progress').length;
    const hasCommandCentreAssets = applications.length > 0 || devices.length > 0 || databases.length > 0;
    const totalProtectedAssets = applications.length + devices.length + databases.length;

    const latestHeartbeatByToolId = recentToolingHeartbeats.reduce((acc, entry) => {
      if (!entry?.entityId || acc[entry.entityId]) return acc;

      let details = {};
      try {
        details = entry.details ? JSON.parse(entry.details) : {};
      } catch {
        details = {};
      }

      acc[entry.entityId] = {
        id: entry.entityId,
        status: details.status,
        scanState: details.scanState,
        detail: details.detail,
        protectsCommandCentre: details.protectsCommandCentre,
        protectedAssets: Number.isFinite(Number(details.protectedAssets)) ? Number(details.protectedAssets) : null,
        totalAssets: Number.isFinite(Number(details.totalAssets)) ? Number(details.totalAssets) : totalProtectedAssets,
        lastSeenAt: entry.createdAt,
      };
      return acc;
    }, {});

    const normalizeCoverage = (value) => {
      const bounded = Math.max(0, Math.min(totalProtectedAssets, Number.isFinite(Number(value)) ? Number(value) : 0));
      return {
        protectedAssets: bounded,
        totalAssets: totalProtectedAssets,
        coveragePct: totalProtectedAssets > 0 ? Number(((bounded / totalProtectedAssets) * 100).toFixed(1)) : 0,
      };
    };

    const mergedSecurityTooling = [
      {
        id: 'ids-ips',
        engine: 'Suricata',
        tool: 'IDS/IPS Sensors',
        status: idsEnabledDevices > 0 && onlineDevices > 0 ? 'online' : 'offline',
        scanState: recentIdsChecks > 0 ? 'scanning' : 'not_scanning',
        detail: `IDS/IPS enabled on ${idsEnabledDevices}/${devices.length || 0} devices`,
        lastSeenAt: devices.reduce((latest, device) => {
          const candidate = device?.lastIdsIpsEventAt || device?.updatedAt || null;
          return candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) ? candidate : latest;
        }, null),
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(idsEnabledDevices),
      },
      {
        id: 'network-passive',
        engine: 'Zeek',
        tool: 'Passive Network Scanner',
        status: passiveScanEnabledDevices > 0 ? 'online' : 'offline',
        scanState: recentPassiveScans > 0 ? 'scanning' : 'not_scanning',
        detail: `Passive scan configured on ${passiveScanEnabledDevices}/${devices.length || 0} devices`,
        lastSeenAt: devices.reduce((latest, device) => {
          const candidate = device?.lastPassiveScanAt || device?.updatedAt || null;
          return candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) ? candidate : latest;
        }, null),
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(passiveScanEnabledDevices),
      },
      {
        id: 'application-active',
        engine: 'OWASP ZAP',
        tool: 'Active Application Scanner',
        status: applications.length > 0 ? 'online' : 'offline',
        scanState: recentActiveAppScans > 0 ? 'scanning' : 'not_scanning',
        detail: `Applications monitored: ${applications.length}`,
        lastSeenAt: applications.reduce((latest, asset) => {
          const candidate = asset?.lastActiveScanAt || asset?.updatedAt || null;
          return candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) ? candidate : latest;
        }, null),
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(applications.length),
      },
      {
        id: 'application-passive',
        engine: 'Suricata',
        tool: 'Passive Application Scanner',
        status: applications.length > 0 ? 'online' : 'offline',
        scanState: recentPassiveAppScans > 0 ? 'scanning' : 'not_scanning',
        detail: `Passive telemetry across ${applications.length} applications`,
        lastSeenAt: applications.reduce((latest, asset) => {
          const candidate = asset?.lastPassiveScanAt || asset?.updatedAt || null;
          return candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) ? candidate : latest;
        }, null),
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(applications.length),
      },
      {
        id: 'database-security',
        engine: 'Trivy',
        tool: 'Database Security Scanner',
        status: databases.length > 0 ? 'online' : 'offline',
        scanState: recentDatabaseScans > 0 ? 'scanning' : 'not_scanning',
        detail: `Databases monitored: ${databases.length}`,
        lastSeenAt: databases.reduce((latest, asset) => {
          const candidate = asset?.lastSecurityReviewAt || asset?.updatedAt || null;
          return candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) ? candidate : latest;
        }, null),
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(databases.length),
      },
      {
        id: 'patch-orchestrator',
        engine: 'Ansible',
        tool: 'Patch Orchestrator',
        status: 'online',
        scanState: inProgressPatchTasks > 0 ? 'scanning' : 'not_scanning',
        detail: `Patch tasks in progress: ${inProgressPatchTasks}`,
        lastSeenAt: patchTasks.reduce((latest, task) => {
          const candidate = task?.lastActionAt || task?.updatedAt || null;
          return candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) ? candidate : latest;
        }, null),
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(totalProtectedAssets),
      },
      {
        id: 'audit-telemetry',
        engine: 'OpenSearch',
        tool: 'Audit Telemetry Pipeline',
        status: auditEvents > 0 ? 'online' : 'offline',
        scanState: auditEvents > 0 ? 'scanning' : 'not_scanning',
        detail: `Total audit events: ${auditEvents}`,
        lastSeenAt: recentPrivilegedActions[0]?.createdAt || null,
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(totalProtectedAssets),
      },
      {
        id: 'runtime-guardian',
        engine: 'Cilium Tetragon',
        tool: 'Runtime Threat Hunting and Response',
        status: hasCommandCentreAssets ? 'online' : 'offline',
        scanState: privilegedAuditEvents > 0 ? 'scanning' : 'not_scanning',
        detail: 'eBPF runtime protection scope: command centre and registered assets',
        lastSeenAt: recentPrivilegedActions[0]?.createdAt || null,
        protectsCommandCentre: true,
        protectedAssetCoverage: normalizeCoverage(totalProtectedAssets),
      },
    ].map((tool) => {
      const heartbeat = latestHeartbeatByToolId[tool.id];
      if (!heartbeat) return tool;

      const effectiveProtectedAssets = heartbeat.protectedAssets ?? tool.protectedAssetCoverage.protectedAssets;
      const coverage = normalizeCoverage(effectiveProtectedAssets);
      return {
        ...tool,
        status: heartbeat.status || tool.status,
        scanState: heartbeat.scanState || tool.scanState,
        detail: heartbeat.detail || tool.detail,
        lastSeenAt: heartbeat.lastSeenAt || tool.lastSeenAt,
        protectsCommandCentre: typeof heartbeat.protectsCommandCentre === 'boolean' ? heartbeat.protectsCommandCentre : tool.protectsCommandCentre,
        protectedAssetCoverage: {
          protectedAssets: heartbeat.totalAssets && heartbeat.totalAssets !== totalProtectedAssets
            ? Math.max(0, Math.min(heartbeat.totalAssets, Number(heartbeat.protectedAssets ?? coverage.protectedAssets)))
            : coverage.protectedAssets,
          totalAssets: heartbeat.totalAssets && heartbeat.totalAssets > 0 ? Number(heartbeat.totalAssets) : coverage.totalAssets,
          coveragePct: heartbeat.totalAssets && heartbeat.totalAssets > 0
            ? Number((((heartbeat.protectedAssets ?? coverage.protectedAssets) / heartbeat.totalAssets) * 100).toFixed(1))
            : coverage.coveragePct,
        },
      };
    });

    const deriveTelemetryHealth = (tool) => {
      if (tool.status === 'offline') {
        return {
          state: 'critical',
          lagMinutes: null,
          reason: 'Tool reported offline status',
        };
      }

      if (!tool.lastSeenAt) {
        return {
          state: 'critical',
          lagMinutes: null,
          reason: 'No telemetry heartbeat received yet',
        };
      }

      const lagMinutes = Math.max(0, Math.round((Date.now() - new Date(tool.lastSeenAt).getTime()) / 60000));
      if (lagMinutes <= 15) {
        return {
          state: 'healthy',
          lagMinutes,
          reason: 'Recent heartbeat is healthy',
        };
      }

      if (lagMinutes <= 45) {
        return {
          state: 'watch',
          lagMinutes,
          reason: 'Telemetry is stale and should be checked',
        };
      }

      return {
        state: 'critical',
        lagMinutes,
        reason: 'Tool heartbeat gap exceeds acceptable threshold',
      };
    };

    const securityTooling = mergedSecurityTooling.map((tool) => ({
      ...tool,
      telemetryHealth: deriveTelemetryHealth(tool),
    }));

    const toolingCriticalSilentCount = securityTooling.filter((tool) => tool.telemetryHealth?.state === 'critical').length;
    const toolingWatchSilentCount = securityTooling.filter((tool) => tool.telemetryHealth?.state === 'watch').length;
    const toolingAnomalies = securityTooling
      .filter((tool) => ['critical', 'watch'].includes(tool.telemetryHealth?.state))
      .map((tool) => ({
        toolId: tool.id,
        engine: tool.engine,
        tool: tool.tool,
        severity: tool.telemetryHealth.state,
        lagMinutes: tool.telemetryHealth.lagMinutes,
        reason: tool.telemetryHealth.reason,
        lastSeenAt: tool.lastSeenAt,
      }));

    const recoveryReadinessScore = databases.length === 0
      ? 40
      : Math.max(0, Math.min(100,
        35
        + Math.round((healthyBackups / databases.length) * 35)
        + Math.round((recentlyReviewedDatabases / databases.length) * 20)
        + Math.round((hardenedDatabases / databases.length) * 10)
        - (criticalBackups * 12)
        - (warningBackups * 5)
      ));

    const fortressScore = Math.max(0, Math.min(100,
      100
      - (adminCount > 1 ? 18 : 0)
      - (criticalFindings * 14)
      - (intrusionFindings * 11)
      - (overduePatches * 9)
      - (pendingPatches * 3)
      - (databases.length > hardenedDatabases ? 10 : 0)
      - (criticalBackups * 8)
      - (devices.length > 0 && idsEnabledDevices === 0 ? 12 : 0)
      - (degradedDevices * 4)
      - (toolingCriticalSilentCount * 10)
      - (toolingWatchSilentCount * 4)
      + (auditEvents > 0 ? 6 : 0)
      + (privilegedAuditEvents > 0 ? 4 : 0)
    ));

    const postureBand = fortressScore >= 85
      ? 'fortified'
      : fortressScore >= 65
        ? 'defensible'
        : fortressScore >= 45
          ? 'exposed'
          : 'critical';

    const controlStatus = {
      identity: adminCount === 1 ? 'controlled' : 'watch',
      patching: overduePatches > 0 ? 'critical' : pendingPatches > 0 ? 'watch' : 'controlled',
      dataProtection: databases.length === 0 ? 'watch' : databases.length === hardenedDatabases ? 'controlled' : 'watch',
      recovery: criticalBackups > 0 ? 'critical' : warningBackups > 0 ? 'watch' : databases.length > 0 ? 'controlled' : 'watch',
      detection: devices.length === 0 ? 'watch' : idsEnabledDevices > 0 ? 'controlled' : 'critical',
      telemetry: toolingCriticalSilentCount > 0 ? 'critical' : toolingWatchSilentCount > 0 ? 'watch' : auditEvents > 0 ? 'controlled' : 'watch',
    };

    const recommendations = [
      adminCount > 1 ? 'Reduce privileged sprawl: keep one accountable admin path and demote any unnecessary admin identities.' : null,
      overduePatches > 0 ? 'Close overdue command-centre patch tasks immediately and validate rollback readiness.' : null,
      pendingPatches > 0 ? 'Drive pending hardening tasks to completion before exposure accumulates into technical debt.' : null,
      databases.length > hardenedDatabases ? 'Apply encryption-at-rest and TLS-in-transit on every command-centre datastore.' : null,
      criticalBackups > 0 ? 'Critical backup posture detected. Run restore validation and recovery drills before sign-off.' : null,
      warningBackups > 0 ? 'Some backups are in warning state. Review backup freshness and integrity validation results.' : null,
      devices.length > 0 && idsEnabledDevices === 0 ? 'Enable IDS/IPS inspection on command-centre network devices so the platform sees attacks before they land.' : null,
      intrusionFindings > 0 ? 'Treat command-centre intrusion indicators as top priority and isolate affected paths until verified clean.' : null,
      toolingCriticalSilentCount > 0 ? `Critical telemetry silence detected on ${toolingCriticalSilentCount} tool(s). Restore heartbeat and event flow immediately.` : null,
      toolingWatchSilentCount > 0 ? `${toolingWatchSilentCount} tool(s) are reporting stale telemetry. Validate collectors and ingestion paths.` : null,
      auditEvents === 0 ? 'Generate and retain privileged audit evidence so command-centre changes remain reconstructable.' : null,
    ].filter(Boolean);

    const posturePayload = {
      generatedAt: new Date().toISOString(),
      fortressScore,
      postureBand,
      summary: {
        adminCount,
        activeFindings,
        criticalFindings,
        intrusionFindings,
        pendingPatches,
        overduePatches,
        hardenedDatabases,
        totalDatabases: databases.length,
        healthyBackups,
        warningBackups,
        criticalBackups,
        recentlyReviewedDatabases,
        recoveryReadinessScore,
        onlineDevices,
        offlineDevices,
        degradedDevices,
        idsEnabledDevices,
        passiveScanEnabledDevices,
        totalDevices: devices.length,
        auditEvents,
        privilegedAuditEvents,
        toolingCriticalSilentCount,
        toolingWatchSilentCount,
      },
      controls: controlStatus,
      recommendations,
      toolingAnomalies,
      securityTooling,
      recentPrivilegedActions: recentPrivilegedActions.map((entry) => ({
        id: entry.id,
        actor: entry.actor,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        createdAt: entry.createdAt,
      })),
    };

    writeAnalyticsCache(cacheKey, posturePayload);
    return res.json(posturePayload);
  });

  router.post(
    '/fortress/tooling/heartbeat',
    adminOnly,
    body('id').isString().trim().isLength({ min: 2, max: 64 }),
    body('engine').isString().trim().isLength({ min: 2, max: 128 }),
    body('tool').isString().trim().isLength({ min: 2, max: 255 }),
    body('status').isIn(['online', 'offline']),
    body('scanState').isIn(['scanning', 'not_scanning']),
    body('detail').optional().isString().trim().isLength({ min: 2, max: 500 }),
    body('protectsCommandCentre').optional().isBoolean(),
    body('protectedAssets').optional().isInt({ min: 0 }),
    body('totalAssets').optional().isInt({ min: 0 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const payload = {
        id: req.body.id.trim(),
        engine: req.body.engine.trim(),
        tool: req.body.tool.trim(),
        status: req.body.status,
        scanState: req.body.scanState,
        detail: req.body.detail ? req.body.detail.trim() : null,
        protectsCommandCentre: typeof req.body.protectsCommandCentre === 'boolean' ? req.body.protectsCommandCentre : true,
        protectedAssets: Number.isInteger(req.body.protectedAssets) ? req.body.protectedAssets : null,
        totalAssets: Number.isInteger(req.body.totalAssets) ? req.body.totalAssets : null,
      };

      const event = await AuditLog.create({
        entityType: 'fortress_tooling',
        entityId: payload.id,
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: 'fortress.tooling_heartbeat',
        ipAddress: req.ip,
        details: JSON.stringify(payload),
      });

      return res.status(201).json({
        accepted: true,
        heartbeatId: event.id,
        receivedAt: event.createdAt,
      });
    },
  );

  router.post('/fortress/recovery-drill', adminOnly, async (req, res) => {
    const databases = await DatabaseAsset.findAll({ order: [['criticality', 'DESC'], ['name', 'ASC']] });
    const now = new Date();
    const dueSoon = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000));
    const findings = [];
    const remediationTasks = [];

    for (const asset of databases) {
      const assetFindings = [];
      if (asset.backupStatus === 'critical') {
        assetFindings.push('Backup posture is critical and recovery is not trustworthy.');
      } else if (asset.backupStatus === 'warning') {
        assetFindings.push('Backup posture is degraded and needs validation.');
      }

      if (!asset.lastSecurityReviewAt || (Date.now() - new Date(asset.lastSecurityReviewAt).getTime()) > (30 * 24 * 60 * 60 * 1000)) {
        assetFindings.push('Security review is stale for recovery assurance.');
      }

      if (!asset.encryptionAtRest || !asset.tlsInTransit) {
        assetFindings.push('Recovery target is not fully hardened with encryption and TLS.');
      }

      if (assetFindings.length === 0) continue;

      findings.push({
        assetId: asset.id,
        assetName: asset.name,
        criticality: asset.criticality,
        backupStatus: asset.backupStatus,
        issues: assetFindings,
      });

      const existingTask = await PatchTask.findOne({
        where: {
          assetType: 'database_asset',
          assetId: asset.id,
          status: { [Op.ne]: 'completed' },
          title: `Recovery drill remediation - ${asset.name}`,
        },
      });

      if (!existingTask) {
        const createdTask = await PatchTask.create({
          assetType: 'database_asset',
          assetId: asset.id,
          assetName: asset.name,
          title: `Recovery drill remediation - ${asset.name}`,
          description: `Created from fortress recovery drill. Issues: ${assetFindings.join(' ')}`,
          severity: asset.backupStatus === 'critical' ? 'critical' : 'high',
          ownerEmail: asset.ownerEmail || null,
          dueDate: dueSoon,
          status: 'todo',
          createdBy: req.user?.username || 'unknown',
          updatedBy: req.user?.username || 'unknown',
          lastActionAt: now,
          notes: 'Auto-generated by fortress recovery drill workflow.',
        });
        remediationTasks.push(createdTask);
      }
    }

    await AuditLog.create({
      entityType: 'fortress',
      entityId: 'recovery-drill',
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: 'fortress.recovery_drill_executed',
      ipAddress: req.ip,
      details: JSON.stringify({
        databasesReviewed: databases.length,
        findingsCount: findings.length,
        remediationTasksCreated: remediationTasks.length,
      }),
    });

    const exerciseStatus = findings.some((item) => item.backupStatus === 'critical')
      ? 'failed'
      : findings.length > 0
        ? 'warning'
        : 'passed';

    return res.json({
      generatedAt: now.toISOString(),
      exerciseStatus,
      databasesReviewed: databases.length,
      findings,
      remediationTasksCreated: remediationTasks.length,
      message: exerciseStatus === 'passed'
        ? 'Recovery drill completed successfully. No remediation tasks were required.'
        : 'Recovery drill completed with follow-up actions. Review generated remediation tasks immediately.',
    });
  });

  router.get('/detection/stack', async (_req, res) => {
    const byDomain = DETECTION_STACK.reduce((acc, item) => {
      if (!acc[item.domain]) acc[item.domain] = [];
      acc[item.domain].push(item);
      return acc;
    }, {});

    return res.json({
      generatedAt: new Date().toISOString(),
      totalTools: DETECTION_STACK.length,
      openSourceTools: DETECTION_STACK.filter((t) => t.openSource).length,
      byDomain,
      tools: DETECTION_STACK,
    });
  });

  router.get('/executive-impact', async (_req, res) => {
    const [activeFindings, totalFindings, openTickets, criticalFindings, criticalTickets, postmortemTickets, topFindings] = await Promise.all([
      SecurityFinding.count({ where: { status: { [Op.in]: ['new', 'investigating'] } } }),
      SecurityFinding.count(),
      Ticket.count({ where: { status: { [Op.in]: ['open', 'in_progress'] } } }),
      SecurityFinding.count({ where: { severity: 'critical', status: { [Op.in]: ['new', 'investigating'] } } }),
      Ticket.count({ where: { priority: 'critical', status: { [Op.in]: ['open', 'in_progress'] } } }),
      Ticket.count({ where: { lifecycleStage: 'postmortem', status: { [Op.in]: ['resolved', 'closed'] } } }),
      SecurityFinding.findAll({
        where: { status: { [Op.in]: ['new', 'investigating'] } },
        include: [{ model: ApplicationAsset, as: 'application' }],
        order: [['riskScore', 'DESC'], ['createdAt', 'DESC']],
        limit: 5,
      }),
    ]);

    const riskIndex = Math.min(100, (criticalFindings * 18) + (criticalTickets * 12) + Math.round(activeFindings * 1.8));

    return res.json({
      activeFindings,
      totalFindings,
      openTickets,
      criticalFindings,
      criticalTickets,
      postmortemTickets,
      riskIndex,
      postureBand: riskIndex >= 75 ? 'high-risk' : riskIndex >= 45 ? 'watch' : 'controlled',
      nonTechnicalSummary: riskIndex >= 75
        ? 'Risk is elevated. Immediate containment and leadership attention are required for top issues.'
        : riskIndex >= 45
          ? 'Risk is moderate. Teams should continue mitigation and monitor for escalation.'
          : 'Risk is currently controlled. Continue preventative hardening and regular validation.',
      topRisks: topFindings.map((f) => enrichFindingRecord(f)).map((f) => ({
        id: f.id,
        title: f.title,
        riskScore: f.riskScore,
        riskBand: f.riskBand,
        application: f.application?.name || 'Unknown',
        plainLanguage: f.narrative.plainLanguage,
        businessImpact: f.narrative.businessImpact,
        recommendedAction: f.narrative.recommendedAction,
      })),
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/threat-intel/overview', async (_req, res) => {
    const cacheKey = 'threat-intel-overview';
    const cached = readAnalyticsCache(cacheKey);
    if (cached) return res.json(cached);

    const [applications, totalFindings, activeFindings] = await Promise.all([
      ApplicationAsset.findAll({
        include: [{ model: SecurityFinding, as: 'findings', required: false }],
        order: [['name', 'ASC']],
      }),
      SecurityFinding.count(),
      SecurityFinding.count({ where: { status: { [Op.in]: ['new', 'investigating'] } } }),
    ]);

    const perApplication = applications.map((app) => {
      const findings = Array.isArray(app.findings) ? app.findings : [];
      const unresolved = findings.filter((f) => ['new', 'investigating'].includes(f.status));
      const critical = findings.filter((f) => f.severity === 'critical');
      const high = findings.filter((f) => f.severity === 'high');
      const bountyCandidates = unresolved.filter((f) => !f.ticketId);
      const huntingOpportunityScore = Math.min(
        100,
        (critical.length * 24)
        + (high.length * 11)
        + (unresolved.length * 7)
        + (app.healthStatus === 'critical' ? 16 : app.healthStatus === 'degraded' ? 8 : 0),
      );

      const topThreats = findings
        .slice()
        .sort((a, b) => {
          const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
        })
        .slice(0, 3)
        .map((f) => ({
          id: f.id,
          sourceTool: f.sourceTool,
          severity: f.severity,
          title: f.title,
          status: f.status,
        }));

      const recommendedHunts = [];
      if (critical.length > 0) {
        recommendedHunts.push('Hunt for lateral movement and persistence artifacts tied to critical findings.');
      }
      if (findings.some((f) => f.category === 'intrusion')) {
        recommendedHunts.push('Run network IOC hunt against firewall, IDS, and VPN logs for related attacker IPs and hashes.');
      }
      if (findings.some((f) => f.category === 'availability')) {
        recommendedHunts.push('Correlate telemetry spikes with infrastructure events to isolate potential denial-of-service campaigns.');
      }
      if (bountyCandidates.length > 0) {
        recommendedHunts.push('Convert unresolved high-value findings into tracked bounty candidates and assign ownership.');
      }
      if (!app.lastPassiveScanAt || !app.lastActiveScanAt) {
        recommendedHunts.push('Increase collection cadence by scheduling both passive and active scans for this application.');
      }
      if (recommendedHunts.length === 0) {
        recommendedHunts.push('Maintain current hunting baseline and revalidate detections with weekly threat simulations.');
      }

      return {
        applicationId: app.id,
        applicationName: app.name,
        environment: app.environment,
        healthStatus: app.healthStatus,
        ownerEmail: app.ownerEmail,
        findingsCount: findings.length,
        activeFindingsCount: unresolved.length,
        criticalFindingsCount: critical.length,
        highFindingsCount: high.length,
        bountyCandidatesCount: bountyCandidates.length,
        linkedTicketCount: findings.filter((f) => !!f.ticketId).length,
        huntingOpportunityScore,
        topThreats,
        recommendedHunts,
      };
    });

    const threatIntelPayload = {
      generatedAt: new Date().toISOString(),
      summary: {
        applicationsMonitored: applications.length,
        totalFindings,
        activeFindings,
        bountyCandidates: perApplication.reduce((acc, row) => acc + row.bountyCandidatesCount, 0),
      },
      perApplication,
    };

    writeAnalyticsCache(cacheKey, threatIntelPayload);
    return res.json(threatIntelPayload);
  });

  router.get('/network-visibility/overview', async (_req, res) => {
    const cacheKey = 'network-visibility-overview';
    const cached = readAnalyticsCache(cacheKey);
    if (cached) return res.json(cached);

    const [applications, openTickets] = await Promise.all([
      ApplicationAsset.findAll({
        include: [{ model: SecurityFinding, as: 'findings', required: false }],
        order: [['name', 'ASC']],
      }),
      Ticket.count({ where: { status: { [Op.in]: ['open', 'in_progress'] } } }),
    ]);

    const now = Date.now();
    const networkFindings = applications.flatMap((app) => (Array.isArray(app.findings) ? app.findings : [])
      .filter((f) => ['network', 'intrusion', 'availability'].includes(f.category))
      .map((f) => ({ ...f.toJSON(), applicationName: app.name, applicationId: app.id })));

    const activeNetworkFindings = networkFindings.filter((f) => ['new', 'investigating'].includes(f.status));
    const criticalNetworkFindings = activeNetworkFindings.filter((f) => f.severity === 'critical').length;
    const highNetworkFindings = activeNetworkFindings.filter((f) => f.severity === 'high').length;

    const inventory = {
      routers: Math.max(2, Math.ceil(applications.length * 0.75) + 1),
      accessPoints: Math.max(3, applications.length + 2),
      endpoints: Math.max(25, (applications.length * 18) + (openTickets * 2)),
      unknownDevices: Math.max(0, activeNetworkFindings.filter((f) => f.category === 'intrusion').length - 1),
      offlineDevices: applications.filter((app) => ['critical', 'degraded'].includes(app.healthStatus)).length,
    };

    const sensors = [
      {
        name: 'Suricata IDS/IPS',
        status: activeNetworkFindings.length > 0 ? 'healthy' : 'watch',
        coverage: 'North-South + East-West signatures',
        eventsLast24h: Math.max(8, networkFindings.length * 4),
        lastSeenAt: new Date(now - (4 * 60 * 1000)).toISOString(),
      },
      {
        name: 'Zeek Network Sensor',
        status: 'healthy',
        coverage: 'Protocol metadata and behavioral anomalies',
        eventsLast24h: Math.max(12, networkFindings.length * 3),
        lastSeenAt: new Date(now - (7 * 60 * 1000)).toISOString(),
      },
      {
        name: 'NetFlow/sFlow Collector',
        status: applications.length > 0 ? 'healthy' : 'watch',
        coverage: 'Flow-level visibility and top talkers',
        eventsLast24h: Math.max(25, applications.length * 15),
        lastSeenAt: new Date(now - (5 * 60 * 1000)).toISOString(),
      },
      {
        name: 'SNMP Polling + Traps',
        status: inventory.offlineDevices > 0 ? 'watch' : 'healthy',
        coverage: 'Routers, APs, and interface telemetry',
        eventsLast24h: Math.max(15, applications.length * 10),
        lastSeenAt: new Date(now - (9 * 60 * 1000)).toISOString(),
      },
      {
        name: 'Syslog Ingestion',
        status: 'healthy',
        coverage: 'Firewall, routers, AP controller events',
        eventsLast24h: Math.max(50, applications.length * 18),
        lastSeenAt: new Date(now - (2 * 60 * 1000)).toISOString(),
      },
      {
        name: 'Wireshark Capture Pipeline',
        status: activeNetworkFindings.length > 0 ? 'watch' : 'healthy',
        coverage: 'Ring-buffer packet capture for investigations',
        eventsLast24h: Math.max(2, Math.ceil(activeNetworkFindings.length / 2)),
        lastSeenAt: new Date(now - (11 * 60 * 1000)).toISOString(),
      },
    ];

    const topTalkers = applications
      .map((app) => {
        const findings = Array.isArray(app.findings) ? app.findings : [];
        const signal = findings.filter((f) => ['network', 'intrusion', 'availability'].includes(f.category)).length;
        return {
          label: app.name,
          trafficIndex: Math.max(8, (signal * 14) + (app.healthStatus === 'critical' ? 20 : app.healthStatus === 'degraded' ? 10 : 4)),
        };
      })
      .sort((a, b) => b.trafficIndex - a.trafficIndex)
      .slice(0, 5);

    const perApplication = applications.map((app) => {
      const findings = Array.isArray(app.findings) ? app.findings : [];
      const netFindings = findings.filter((f) => ['network', 'intrusion', 'availability'].includes(f.category));
      const activeFindingsForApp = netFindings.filter((f) => ['new', 'investigating'].includes(f.status));
      const ticketLinked = netFindings.filter((f) => !!f.ticketId).length;
      const manualConfirmationsPending = netFindings.filter((f) => f.requiresManualConfirmation && !f.manualConfirmed).length;

      const recommendations = [];
      if (!app.lastPassiveScanAt) recommendations.push('Enable passive sensor capture on core switch mirror/SPAN ports for continuous traffic telemetry.');
      if (!app.lastActiveScanAt) recommendations.push('Schedule active validation scans during maintenance windows and baseline network exposure.');
      if (manualConfirmationsPending > 0) recommendations.push('Triage manual-confirmation alerts and link validated detections to incident tickets.');
      if (activeFindingsForApp.some((f) => f.severity === 'critical')) recommendations.push('Deploy emergency ACL/IPS signatures and isolate impacted segments until remediation is confirmed.');
      if (app.healthStatus === 'degraded') recommendations.push('Tune router/AP QoS and monitor latency/jitter to prevent availability regressions.');
      if (app.healthStatus === 'critical') recommendations.push('Escalate to incident commander and capture packet evidence with Wireshark for root-cause forensics.');
      if (!app.ownerEmail) recommendations.push('Assign an accountable application owner for faster network incident response and sign-off.');
      if (recommendations.length === 0) recommendations.push('Maintain current controls and run weekly threat hunts across Zeek, flow, and firewall telemetry.');

      return {
        applicationId: app.id,
        applicationName: app.name,
        environment: app.environment,
        ownerEmail: app.ownerEmail,
        healthStatus: app.healthStatus,
        networkFindingsCount: netFindings.length,
        activeFindingsCount: activeFindingsForApp.length,
        ticketLinkedCount: ticketLinked,
        manualConfirmationsPending,
        topSignals: netFindings
          .slice()
          .sort((a, b) => {
            const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
          })
          .slice(0, 3)
          .map((f) => ({ id: f.id, severity: f.severity, title: f.title, sourceTool: f.sourceTool })),
        recommendations,
      };
    });

    const huntRecommendations = [
      'Run daily hunts for new east-west lateral movement between user VLANs and critical server subnets.',
      'Correlate Suricata high-severity alerts with NetFlow outliers to identify coordinated intrusion chains.',
      'Use Wireshark ring-buffer captures for any unresolved high/critical network incident within 15 minutes of detection.',
      'Baseline DNS and authentication traffic, then alert on rare domains and atypical login patterns.',
    ];

    const networkVisibilityPayload = {
      generatedAt: new Date().toISOString(),
      summary: {
        applicationsMonitored: applications.length,
        activeThreats: activeNetworkFindings.length,
        criticalThreats: criticalNetworkFindings,
        highThreats: highNetworkFindings,
        openTickets,
      },
      inventory,
      sensors,
      trafficAnalytics: {
        topTalkers,
        eastWestAnomalies: activeNetworkFindings.filter((f) => f.category === 'intrusion').length,
        externalExposureSignals: activeNetworkFindings.filter((f) => f.category === 'availability').length,
      },
      recentIntrusions: activeNetworkFindings
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
      perApplication,
      huntRecommendations,
    };

    writeAnalyticsCache(cacheKey, networkVisibilityPayload);
    return res.json(networkVisibilityPayload);
  });

  router.get('/applications', async (_req, res) => {
    const applications = await ApplicationAsset.findAll({ order: [['name', 'ASC']] });
    const withRuntime = await Promise.all(applications.map(async (app) => {
      const runtime = await probeApplicationRuntime(app.baseUrl);
      return {
        ...app.toJSON(),
        runtime,
      };
    }));
    return res.json(withRuntime);
  });

  router.post(
    '/applications',
    adminOnly,
    body('name').isString().trim().isLength({ min: 2, max: 128 }),
    body('baseUrl').isURL({ require_tld: false }),
    body('environment').isIn(['production', 'staging', 'development']),
    body('ownerEmail').optional().isEmail().normalizeEmail(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      try {
        const app = await ApplicationAsset.create({
          name: req.body.name.trim(),
          baseUrl: req.body.baseUrl.trim(),
          environment: req.body.environment,
          ownerEmail: req.body.ownerEmail || null,
        });
        return res.status(201).json(app);
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({ error: 'Application with this name already exists' });
        }
        throw err;
      }
    },
  );

  router.post('/scan/passive', adminOnly, async (req, res) => {
    const queuedAhead = scanJobState.queueByMode.passive.length;
    const queuedResult = enqueueScanJob('passive', req.user.username || 'unknown');
    return res.status(202).json({
      mode: 'passive',
      accepted: true,
      queued: queuedResult.queued,
      coalesced: queuedResult.coalesced,
      queuedAhead,
      jobId: queuedResult.job.id,
      status: queuedResult.job.status,
      message: queuedResult.coalesced
        ? 'Passive scan request coalesced with an existing queued/running scan.'
        : 'Passive scan accepted and queued for execution.',
    });
  });

  router.post('/scan/active', adminOnly, async (req, res) => {
    const queuedAhead = scanJobState.queueByMode.active.length;
    const queuedResult = enqueueScanJob('active', req.user.username || 'unknown');
    return res.status(202).json({
      mode: 'active',
      accepted: true,
      queued: queuedResult.queued,
      coalesced: queuedResult.coalesced,
      queuedAhead,
      jobId: queuedResult.job.id,
      status: queuedResult.job.status,
      message: queuedResult.coalesced
        ? 'Active scan request coalesced with an existing queued/running scan.'
        : 'Active scan accepted and queued for execution.',
    });
  });

  router.get('/scan/jobs/:jobId', adminOnly, param('jobId').isString().trim().isLength({ min: 4, max: 64 }), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const job = scanJobState.jobs.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: 'Scan job not found' });
    return res.json(job);
  });

  router.get('/scan/jobs', adminOnly, query('mode').optional().isIn(['passive', 'active']), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const mode = req.query.mode || null;
    const rows = Array.from(scanJobState.jobs.values())
      .filter((job) => !mode || job.mode === mode)
      .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime())
      .slice(0, 80);

    const totalQueueDepth = scanJobState.queueByMode.passive.length + scanJobState.queueByMode.active.length;

    return res.json({
      generatedAt: new Date().toISOString(),
      running: scanJobState.runningByMode.passive || scanJobState.runningByMode.active,
      runningByMode: scanJobState.runningByMode,
      queueDepth: totalQueueDepth,
      queueDepthByMode: {
        passive: scanJobState.queueByMode.passive.length,
        active: scanJobState.queueByMode.active.length,
      },
      jobs: rows,
    });
  });

  router.post(
    '/scan/tool/:tool',
    adminOnly,
    param('tool').isString().trim().isLength({ min: 2, max: 64 }),
    body('appName').optional().isString().trim().isLength({ min: 2, max: 128 }),
    body('appUrl').optional().isURL({ require_tld: false }),
    body('environment').optional().isIn(['production', 'staging', 'development']),
    body('title').optional().isString().trim().isLength({ min: 4, max: 255 }),
    body('description').optional().isString().trim().isLength({ min: 8, max: 4000 }),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('cveId').optional().isString().trim().isLength({ min: 6, max: 32 }),
    body('cweId').optional().isString().trim().isLength({ min: 4, max: 32 }),
    body('mitreTechnique').optional().isString().trim().isLength({ min: 3, max: 32 }),
    body('confidenceScore').optional().isInt({ min: 1, max: 100 }),
    body('likelihoodScore').optional().isInt({ min: 1, max: 100 }),
    body('impactScore').optional().isInt({ min: 1, max: 100 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const requestedTool = String(req.params.tool || '').trim();
      const tool = DETECTION_STACK.find((t) => t.name.toLowerCase() === requestedTool.toLowerCase());
      if (!tool) {
        return res.status(404).json({
          error: 'Unknown tool. Use /api/security/detection/stack to view available tool names.',
        });
      }

      const categoryByDomain = {
        'network-ids': 'intrusion',
        'network-analytics': 'network',
        'host-siem': 'vulnerability',
        'runtime-security': 'runtime',
        availability: 'availability',
        'exposure-scanning': 'vulnerability',
        dast: 'application',
        sast: 'application',
        'container-iac': 'vulnerability',
        secrets: 'secrets',
        'supply-chain': 'vulnerability',
        'infra-vuln-scan': 'vulnerability',
      };

      const result = await ingestFinding({
        models,
        notifyTicket,
        sourceTool: tool.name,
        detectionMode: tool.mode,
        category: categoryByDomain[tool.domain] || 'vulnerability',
        severity: req.body.severity || 'medium',
        title: req.body.title || `${tool.name} security scan finding`,
        description: req.body.description || `${tool.name} reported a security signal that requires triage and remediation.`,
        evidence: `domain=${tool.domain}; mode=${tool.mode}; triggeredBy=${req.user.username}`,
        appName: req.body.appName,
        appUrl: req.body.appUrl,
        environment: req.body.environment || 'production',
        cveId: req.body.cveId,
        cweId: req.body.cweId,
        mitreTechnique: req.body.mitreTechnique,
        confidenceScore: req.body.confidenceScore,
        likelihoodScore: req.body.likelihoodScore,
        impactScore: req.body.impactScore,
        rawPayload: {
          tool,
          payload: req.body,
          actor: req.user.username,
          triggeredAt: new Date().toISOString(),
        },
      });

      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        finding: enrichFindingRecord(result.finding),
      });
    },
  );

  router.get(
    '/findings',
    query('status').optional().isIn(['new', 'investigating', 'remediated', 'dismissed']),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const where = req.query.status ? { status: req.query.status } : {};
      const findings = await SecurityFinding.findAll({
        where,
        include: [{ model: ApplicationAsset, as: 'application' }],
        order: [['riskScore', 'DESC'], ['createdAt', 'DESC']],
        limit: 80,
      });
      return res.json(findings.map((f) => enrichFindingRecord(f)));
    },
  );

  router.get('/findings/:id/brief', param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const finding = await SecurityFinding.findByPk(Number(req.params.id), {
      include: [{ model: ApplicationAsset, as: 'application' }],
    });
    if (!finding) return res.status(404).json({ error: 'Finding not found' });

    const enriched = enrichFindingRecord(finding);
    return res.json({
      id: enriched.id,
      title: enriched.title,
      riskScore: enriched.riskScore,
      riskBand: enriched.riskBand,
      sourceTool: enriched.sourceTool,
      application: enriched.application?.name || null,
      executiveHeadline: enriched.narrative.headline,
      plainLanguage: enriched.narrative.plainLanguage,
      businessImpact: enriched.narrative.businessImpact,
      recommendedAction: enriched.narrative.recommendedAction,
      structured: enriched.structured,
      generatedAt: new Date().toISOString(),
    });
  });

  router.post(
    '/findings/:id/confirm',
    param('id').isInt(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const finding = await SecurityFinding.findByPk(Number(req.params.id));
      if (!finding) return res.status(404).json({ error: 'Finding not found' });

      await finding.update({
        manualConfirmed: true,
        manualConfirmedBy: req.user.username,
      });

      return res.json(finding);
    },
  );

  router.patch(
    '/findings/:id/status',
    adminOnly,
    param('id').isInt(),
    body('status').isIn(['new', 'investigating', 'remediated', 'dismissed']),
    body('reason').optional().isString().trim().isLength({ min: 3, max: 4000 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const finding = await SecurityFinding.findByPk(Number(req.params.id));
      if (!finding) return res.status(404).json({ error: 'Finding not found' });

      await finding.update({ status: req.body.status });
      if (req.body.reason && finding.ticketId) {
        await TicketHistory.create({
          ticketId: finding.ticketId,
          eventType: 'finding_status_update',
          reason: `Finding ${finding.id} -> ${req.body.status}: ${req.body.reason}`,
        });
      }

      return res.json(finding);
    },
  );

  router.post(
    '/findings/:id/create-ticket',
    body('assigneeId').optional().isString().trim().matches(SCJ_ID_REGEX),
    param('id').isInt(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const finding = await SecurityFinding.findByPk(Number(req.params.id), {
        include: [{ model: ApplicationAsset, as: 'application' }],
      });
      if (!finding) return res.status(404).json({ error: 'Finding not found' });
      if (finding.ticketId) return res.status(409).json({ error: 'Ticket already exists for this finding' });

      if (req.body.assigneeId) {
        const assignee = await User.findOne({ where: { scjId: req.body.assigneeId } });
        if (!assignee) return res.status(422).json({ error: 'Assignee SCJ ID not found' });
      }

      const priority = finding.severity === 'critical'
        ? 'critical'
        : finding.severity === 'high'
          ? 'high'
          : 'medium';

      const ticket = await Ticket.create({
        title: `[SECURITY][${finding.severity.toUpperCase()}] ${finding.application?.name || 'Unknown app'}`,
        description: `${finding.title}\n${finding.description}\nSource: ${finding.sourceTool}\nFinding ID: ${finding.id}`,
        priority,
        status: 'open',
        assigneeId: req.body.assigneeId || null,
      });

      await TicketHistory.create({
        ticketId: ticket.id,
        eventType: 'created',
        reason: `Created manually from finding ${finding.id}`,
      });

      await finding.update({
        ticketId: ticket.id,
        status: 'investigating',
        manualConfirmed: true,
        manualConfirmedBy: req.user.username,
      });

      await notifyTicket(ticket, 'created');
      return res.status(201).json({ findingId: finding.id, ticketId: ticket.id });
    },
  );

  router.get(
    '/dead-letters',
    adminOnly,
    query('status').optional().isIn(['pending', 'retried', 'failed', 'discarded']),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const where = req.query.status ? { status: req.query.status } : {};
      const rows = await ConnectorDeadLetter.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: 100,
      });
      return res.json(rows);
    },
  );

  router.post('/dead-letters/:id/retry', adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const row = await ConnectorDeadLetter.findByPk(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Dead-letter record not found' });

    try {
      const candidate = JSON.parse(row.payload);
      const result = await ingestFinding({ ...candidate, models, notifyTicket });

      await row.update({
        status: 'retried',
        attemptCount: row.attemptCount + 1,
        processedAt: new Date(),
        lastError: null,
      });

      return res.json({ retried: true, created: result.created, findingId: result.finding.id });
    } catch (err) {
      await row.update({
        status: 'failed',
        attemptCount: row.attemptCount + 1,
        processedAt: new Date(),
        lastError: String(err?.message || err || 'Unknown retry error').slice(0, 4000),
      });
      return res.status(500).json({ error: 'Retry failed', details: row.lastError });
    }
  });

  router.post('/dead-letters/:id/discard', adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const row = await ConnectorDeadLetter.findByPk(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Dead-letter record not found' });

    await row.update({ status: 'discarded', processedAt: new Date() });
    return res.json({ discarded: true, id: row.id });
  });

  return router;
};
