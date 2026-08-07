import express from 'express';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { param, body, validationResult } from 'express-validator';
import { generateAgentKey, hashAgentKey, verifyAgentKey, encryptAssetCredential, decryptAssetCredential } from '../services/assetSecrets.js';
import { ingestFinding } from '../services/securityEngine.js';
import { verifyEdgeCredential, pushIpBlockRule, removeIpBlockRule } from '../services/edgeEnforcement.js';
import { runAsPlatformAdmin, runWithOrganization } from '../services/tenantContext.js';

const router = express.Router();

// In-memory canary registry: nonce -> { assetId, seenAt }. Process-local is
// fine for a single-instance deployment (this one) — a verification attempt
// only needs to survive the ~15s round trip of one operator click, not a
// server restart.
const pendingCanaries = new Map();
const CANARY_TTL_MS = 60_000;

function pruneCanaries() {
  const now = Date.now();
  for (const [nonce, entry] of pendingCanaries) {
    if (now - entry.createdAt > CANARY_TTL_MS) pendingCanaries.delete(nonce);
  }
}

export default ({ models, authMiddleware, notifyTicket }) => {
  const { ApplicationAsset, AuditLog, AgentCommand, SecurityFinding, Ticket, TicketHistory, TicketAsset, VisitorEvent } = models;

  const adminOnly = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };

  // Authenticates the embedded agent itself — not a logged-in user, so this
  // checks the per-asset agent key instead of a JWT.
  async function agentAuth(req, res, next) {
    const assetId = Number(req.params.id);
    const presentedKey = req.headers['x-agent-key'];
    if (!Number.isInteger(assetId) || !presentedKey) {
      return res.status(401).json({ error: 'Missing agent credentials' });
    }
    // Not a JWT — this daemon authenticates with its own per-asset key, so
    // there's no organization known yet. Looking the asset up is
    // inherently a cross-tenant operation until the key itself proves
    // which asset (and therefore which organization) it belongs to.
    const asset = await runAsPlatformAdmin(() => ApplicationAsset.findByPk(assetId));
    if (!asset || !asset.agentKeyHash || !verifyAgentKey(presentedKey, asset.agentKeyHash)) {
      return res.status(401).json({ error: 'Invalid agent key' });
    }
    req.asset = asset;
    runWithOrganization(asset.organizationId, next);
  }

  // Same shape as agentAuth, but for the host-level sentinel's own key —
  // a separate credential from the app-layer agent's, since a sentinel can
  // run on an asset that has no embedded agent at all (a router, a bare
  // server) and the two are issued/rotated independently.
  async function sentinelAuth(req, res, next) {
    const assetId = Number(req.params.id);
    const presentedKey = req.headers['x-agent-key'];
    if (!Number.isInteger(assetId) || !presentedKey) {
      return res.status(401).json({ error: 'Missing sentinel credentials' });
    }
    const asset = await runAsPlatformAdmin(() => ApplicationAsset.findByPk(assetId));
    if (!asset || !asset.sentinelKeyHash || !verifyAgentKey(presentedKey, asset.sentinelKeyHash)) {
      return res.status(401).json({ error: 'Invalid sentinel key' });
    }
    req.asset = asset;
    runWithOrganization(asset.organizationId, next);
  }

  // The command queue (poll/ack) is shared: either the app-layer agent or the
  // host-level sentinel might be the one carrying out a given kill-command,
  // so either credential is accepted here — whichever one presents a key
  // that actually matches this asset.
  async function eitherKeyAuth(req, res, next) {
    const assetId = Number(req.params.id);
    const presentedKey = req.headers['x-agent-key'];
    if (!Number.isInteger(assetId) || !presentedKey) {
      return res.status(401).json({ error: 'Missing credentials' });
    }
    const asset = await runAsPlatformAdmin(() => ApplicationAsset.findByPk(assetId));
    if (!asset) return res.status(401).json({ error: 'Invalid key' });
    const matchesAgent = asset.agentKeyHash && verifyAgentKey(presentedKey, asset.agentKeyHash);
    const matchesSentinel = asset.sentinelKeyHash && verifyAgentKey(presentedKey, asset.sentinelKeyHash);
    if (!matchesAgent && !matchesSentinel) {
      return res.status(401).json({ error: 'Invalid key' });
    }
    req.asset = asset;
    runWithOrganization(asset.organizationId, next);
  }

  // --- Operator-facing (JWT admin auth) ---

  router.post('/:id/agent-key', authMiddleware, adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const rawKey = generateAgentKey();
    await asset.update({
      enforcementModel: 'agent',
      enforcementMode: 'shadow',
      verificationStatus: 'pending',
      agentKeyHash: hashAgentKey(rawKey),
      lastVerifiedAt: null,
      lastHeartbeatAt: null,
    });

    await AuditLog.create({
      entityType: 'application_asset',
      entityId: String(asset.id),
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: 'asset.agent_key_issued',
      ipAddress: req.ip,
      details: JSON.stringify({ assetId: asset.id }),
    });

    // Shown once — the backend only ever stores a hash from here on.
    return res.status(201).json({ agentKey: rawKey, warning: 'This key will not be shown again. Store it securely.' });
  });

  router.post('/:id/sentinel-key', authMiddleware, adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const rawKey = generateAgentKey();
    await asset.update({
      sentinelMode: 'shadow',
      sentinelKeyHash: hashAgentKey(rawKey),
      lastSentinelHeartbeatAt: null,
    });

    await AuditLog.create({
      entityType: 'application_asset',
      entityId: String(asset.id),
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: 'asset.sentinel_key_issued',
      ipAddress: req.ip,
      details: JSON.stringify({ assetId: asset.id }),
    });

    return res.status(201).json({ sentinelKey: rawKey, warning: 'This key will not be shown again. Store it securely.' });
  });

  router.patch('/:id/sentinel-mode', authMiddleware, adminOnly, param('id').isInt(), body('mode').isIn(['shadow', 'active']), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!asset.sentinelKeyHash) return res.status(409).json({ error: 'No sentinel installed on this asset yet.' });
    if (req.body.mode === 'active' && !asset.lastSentinelHeartbeatAt) {
      return res.status(409).json({ error: 'No sentinel heartbeat received yet. Confirm the sentinel is installed and running before promoting to active.' });
    }

    await asset.update({ sentinelMode: req.body.mode });
    await AuditLog.create({
      entityType: 'application_asset',
      entityId: String(asset.id),
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: `asset.sentinel_mode_set_${req.body.mode}`,
      ipAddress: req.ip,
      details: JSON.stringify({ assetId: asset.id }),
    });

    return res.json({ sentinelMode: asset.sentinelMode });
  });

  router.post(
    '/:id/edge-credential',
    authMiddleware,
    adminOnly,
    param('id').isInt(),
    body('token').isString().trim().isLength({ min: 8, max: 2000 }),
    body('meta').isObject().withMessage('meta is required'),
    body('meta.zoneId').isString().trim().isLength({ min: 1 }).withMessage('meta.zoneId is required to know which Cloudflare zone this credential controls'),
    async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    await asset.update({
      enforcementModel: 'edge',
      enforcementMode: 'shadow',
      verificationStatus: 'pending',
      edgeCredentialSecret: encryptAssetCredential(req.body.token),
      edgeCredentialMeta: req.body.meta,
      lastVerifiedAt: null,
    });

    await AuditLog.create({
      entityType: 'application_asset',
      entityId: String(asset.id),
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: 'asset.edge_credential_set',
      ipAddress: req.ip,
      details: JSON.stringify({ assetId: asset.id }),
    });

    return res.status(201).json({ accepted: true });
  });

  router.post('/:id/verify', authMiddleware, adminOnly, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (asset.enforcementModel === 'edge') {
      // No agent to fire a probe and wait for — we can just ask Cloudflare
      // directly whether this token actually controls this zone, so the
      // result is known synchronously instead of needing a poll.
      if (!asset.edgeCredentialSecret || !asset.edgeCredentialMeta?.zoneId) {
        return res.status(409).json({ error: 'No edge credential configured for this asset yet.' });
      }
      const token = decryptAssetCredential(asset.edgeCredentialSecret);
      const result = await verifyEdgeCredential(token, asset.edgeCredentialMeta.zoneId);

      if (!result.verified) {
        await asset.update({ verificationStatus: 'failed' });
        await AuditLog.create({
          entityType: 'application_asset',
          entityId: String(asset.id),
          actor: req.user?.username || 'unknown',
          actorRole: req.user?.role || null,
          action: 'asset.verification_failed',
          ipAddress: req.ip,
          details: JSON.stringify({ assetId: asset.id, reason: result.reason }),
        });
        return res.status(200).json({ status: 'failed', reason: result.reason });
      }

      await asset.update({ verificationStatus: 'verified', lastVerifiedAt: new Date() });
      await AuditLog.create({
        entityType: 'application_asset',
        entityId: String(asset.id),
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: 'asset.verification_succeeded',
        ipAddress: req.ip,
        details: JSON.stringify({ assetId: asset.id, zoneName: result.zoneName }),
      });
      return res.status(200).json({ status: 'verified', verifiedAt: asset.lastVerifiedAt });
    }

    if (asset.enforcementModel !== 'agent') {
      return res.status(400).json({ error: 'Asset has no enforcement model configured yet — issue an agent key or set an edge credential first.' });
    }
    if (!asset.baseUrl) {
      return res.status(409).json({ error: 'This asset has no base URL — the embedded-agent canary probe needs a real HTTP endpoint to reach. Assets without one (routers, bare servers) should use the sentinel model instead.' });
    }
    if (!asset.lastHeartbeatAt) {
      return res.status(409).json({ error: 'No agent heartbeat received yet. Confirm the agent is installed and running before verifying.' });
    }

    pruneCanaries();
    const nonce = crypto.randomBytes(16).toString('hex');
    pendingCanaries.set(nonce, { assetId: asset.id, createdAt: Date.now(), seen: false });

    // Fire the probe in the background — the operator's UI polls the status
    // endpoint below rather than blocking this request on the round trip.
    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(asset.baseUrl, {
          method: 'GET',
          headers: { 'x-commandcentre-canary': nonce },
          signal: controller.signal,
        });
      } catch {
        // A network failure here just means the canary won't be seen — the
        // status endpoint will report it as unverified with a clear reason.
      } finally {
        clearTimeout(timeout);
      }
    })();

    return res.status(202).json({ verificationId: nonce, status: 'pending', expiresInMs: CANARY_TTL_MS });
  });

  router.get('/:id/verify/:nonce', authMiddleware, adminOnly, param('id').isInt(), async (req, res) => {
    pruneCanaries();
    const entry = pendingCanaries.get(req.params.nonce);
    if (!entry || entry.assetId !== Number(req.params.id)) {
      return res.status(404).json({ status: 'unknown', message: 'Verification attempt not found or expired.' });
    }
    if (!entry.seen) {
      return res.json({ status: 'pending' });
    }

    const asset = await ApplicationAsset.findByPk(req.params.id);
    await asset.update({ verificationStatus: 'verified', lastVerifiedAt: new Date() });
    pendingCanaries.delete(req.params.nonce);

    await AuditLog.create({
      entityType: 'application_asset',
      entityId: String(asset.id),
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: 'asset.verification_succeeded',
      ipAddress: req.ip,
      details: JSON.stringify({ assetId: asset.id }),
    });

    return res.json({ status: 'verified', verifiedAt: asset.lastVerifiedAt });
  });

  router.patch('/:id/mode', authMiddleware, adminOnly, param('id').isInt(), body('mode').isIn(['shadow', 'active']), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (req.body.mode === 'active' && asset.verificationStatus !== 'verified') {
      return res.status(409).json({ error: 'Cannot promote to active enforcement until verification succeeds.' });
    }

    await asset.update({ enforcementMode: req.body.mode });
    await AuditLog.create({
      entityType: 'application_asset',
      entityId: String(asset.id),
      actor: req.user?.username || 'unknown',
      actorRole: req.user?.role || null,
      action: `asset.mode_set_${req.body.mode}`,
      ipAddress: req.ip,
      details: JSON.stringify({ assetId: asset.id }),
    });

    return res.json({ mode: asset.enforcementMode });
  });

  router.get('/:id/enforcement-status', authMiddleware, param('id').isInt(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    return res.json({
      enforcementModel: asset.enforcementModel,
      enforcementMode: asset.enforcementMode,
      verificationStatus: asset.verificationStatus,
      lastVerifiedAt: asset.lastVerifiedAt,
      lastHeartbeatAt: asset.lastHeartbeatAt,
      hasSentinelKey: Boolean(asset.sentinelKeyHash),
      sentinelMode: asset.sentinelMode,
      lastSentinelHeartbeatAt: asset.lastSentinelHeartbeatAt,
      lastKnownOpenPorts: asset.lastKnownOpenPorts,
    });
  });

  // --- Agent-facing (agent-key auth, not JWT) ---

  router.post('/:id/agent-heartbeat', agentAuth, async (req, res) => {
    await req.asset.update({ lastHeartbeatAt: new Date() });
    // Returned alongside the heartbeat ack (rather than a separate poll) so
    // the agent always has an up-to-date shadow/active mode without an extra
    // round trip — mode changes take effect on the agent's next heartbeat.
    return res.json({ acknowledged: true, mode: req.asset.enforcementMode });
  });

  // --- Sentinel-facing (sentinel-key auth, not JWT) ---

  router.post(
    '/:id/sentinel-heartbeat',
    sentinelAuth,
    body('openPorts').optional().isArray(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const updates = { lastSentinelHeartbeatAt: new Date() };
      if (Array.isArray(req.body.openPorts)) updates.lastKnownOpenPorts = req.body.openPorts;
      await req.asset.update(updates);

      return res.json({ acknowledged: true, mode: req.asset.sentinelMode });
    },
  );

  router.post(
    '/:id/sentinel-report',
    sentinelAuth,
    body('category').isString().trim().isLength({ min: 1, max: 64 }),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('title').optional().isString().trim().isLength({ max: 255 }),
    body('description').optional().isString().trim().isLength({ max: 5000 }),
    body('sourceIp').optional().isString().trim().isLength({ max: 64 }),
    body('blocked').optional().isBoolean(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      // Real network-layer findings from the sentinel's own port/connection
      // monitoring — routed through the same ingestion pipeline as every
      // other detector (embedded agent, Wazuh/Suricata/Prometheus connectors),
      // so dedup/scoring/auto-ticketing all apply consistently.
      const { category, severity, title, description, evidence, sourceIp, blocked } = req.body;

      const result = await ingestFinding({
        models: { ApplicationAsset, SecurityFinding, Ticket, TicketHistory, TicketAsset },
        notifyTicket,
        sourceTool: 'commandcentre-sentinel',
        detectionMode: 'active',
        category,
        severity: severity || 'medium',
        title: title || `Network-layer threat on ${req.asset.name}`,
        description: description || `Sentinel flagged network activity${blocked ? ' and isolated the source at the firewall.' : ' (shadow mode — not isolated).'}`,
        evidence: evidence || JSON.stringify({ sourceIp }),
        appName: req.asset.name,
        appUrl: req.asset.baseUrl,
        environment: req.asset.environment,
        // ingestFinding defaults affectedAssetRef to the app's baseUrl, which
        // is null for a router/server/computer — always give it something
        // real to point at instead.
        affectedAssetRef: req.asset.baseUrl || req.asset.ipAddress || String(req.asset.id),
        affectedAssetType: req.asset.assetType,
        requiresManualConfirmation: !blocked,
      });

      return res.status(201).json({ acknowledged: true, findingId: result?.finding?.id || null });
    },
  );

  router.post(
    '/:id/agent-report',
    agentAuth,
    body('type').isIn(['canary_seen', 'finding']),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      if (req.body.type === 'canary_seen') {
        const entry = pendingCanaries.get(req.body.nonce);
        if (entry && entry.assetId === req.asset.id) entry.seen = true;
        return res.json({ acknowledged: true });
      }

      // Real findings from the embedded agent's own request inspection —
      // routed through the same ingestion pipeline the Wazuh/Suricata/
      // Prometheus connectors use, so dedup/scoring/auto-ticketing all apply
      // consistently regardless of which detector produced the finding.
      const {
        category, severity, title, description, evidence,
        wouldBlock, sourceIp, requestPath,
      } = req.body;

      const result = await ingestFinding({
        models: { ApplicationAsset, SecurityFinding, Ticket, TicketHistory, TicketAsset },
        notifyTicket,
        sourceTool: 'commandcentre-agent',
        detectionMode: 'active',
        category: category || 'intrusion_attempt',
        severity: severity || 'medium',
        title: title || `Suspicious request on ${req.asset.name}`,
        description: description || `Agent flagged a request${wouldBlock ? ' (shadow mode — not blocked)' : ' and blocked it'}.`,
        evidence: evidence || JSON.stringify({ sourceIp, requestPath }),
        appName: req.asset.name,
        appUrl: req.asset.baseUrl,
        environment: req.asset.environment,
        requiresManualConfirmation: !!wouldBlock,
      });

      return res.status(201).json({ acknowledged: true, findingId: result?.finding?.id || null });
    },
  );

  // Benign traffic, reported in a batch on the agent's existing heartbeat
  // cadence (see agent/src/core.js) rather than one HTTP call per real
  // request — that would double the agent's own network overhead on every
  // proxied/shielded request. Capped at 200 per call, matching the agent's
  // own in-memory buffer cap, so a misbehaving/compromised agent can't push
  // an unbounded payload in one request.
  router.post(
    '/:id/visit-report',
    agentAuth,
    body('visits').isArray({ min: 1, max: 200 }),
    body('visits.*.ipAddress').isString().trim().isLength({ min: 1, max: 64 }),
    body('visits.*.userAgent').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
    body('visits.*.path').optional({ nullable: true }).isString().trim().isLength({ max: 512 }),
    body('visits.*.method').optional({ nullable: true }).isString().trim().isLength({ max: 10 }),
    body('visits.*.statusCode').optional({ nullable: true }).isInt(),
    body('visits.*.visitedAt').optional({ nullable: true }).isISO8601(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      await VisitorEvent.bulkCreate(req.body.visits.map((v) => ({
        applicationAssetId: req.asset.id,
        ipAddress: v.ipAddress,
        userAgent: v.userAgent || null,
        path: v.path || null,
        method: v.method || null,
        statusCode: v.statusCode ?? null,
        visitedAt: v.visitedAt ? new Date(v.visitedAt) : new Date(),
      })));

      return res.status(201).json({ acknowledged: true, recorded: req.body.visits.length });
    },
  );

  // --- Command queue: CommandCentre -> agent (the "kill" half of the loop) ---

  router.post(
    '/:id/commands',
    authMiddleware,
    adminOnly,
    param('id').isInt(),
    body('action').isIn(['block_ip', 'block_session', 'unblock_ip']),
    body('target').isString().trim().isLength({ min: 1, max: 255 }),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const asset = await ApplicationAsset.findByPk(req.params.id);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });

      if (asset.enforcementModel === 'edge' && req.body.action === 'block_session') {
        return res.status(400).json({
          error: 'Session-level blocking is not available for edge enforcement — Cloudflare acts on IP/network traffic, not application sessions. Use the embedded agent model for session-level blocks.',
        });
      }

      const command = await AgentCommand.create({
        applicationAssetId: asset.id,
        action: req.body.action,
        target: req.body.target,
        reason: req.body.reason || null,
        // Bounds how long a stolen/leaked agent key could leverage a queued
        // command that never gets picked up — 10 minutes is generous for a
        // real polling agent (default poll interval is 15s) but short
        // enough to matter if the key is compromised.
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      await AuditLog.create({
        entityType: 'application_asset',
        entityId: String(asset.id),
        actor: req.user?.username || 'unknown',
        actorRole: req.user?.role || null,
        action: `asset.command_queued.${req.body.action}`,
        ipAddress: req.ip,
        details: JSON.stringify({ target: req.body.target, reason: req.body.reason || null }),
      });

      // Edge-model assets have no agent polling for commands, so execute
      // right here, synchronously, against the real Cloudflare API — the
      // caller learns immediately whether the block actually took effect,
      // rather than a command silently sitting in 'pending' forever.
      if (asset.enforcementModel === 'edge') {
        if (!asset.edgeCredentialSecret || !asset.edgeCredentialMeta?.zoneId) {
          await command.update({ status: 'failed', failureReason: 'No edge credential configured for this asset.' });
          return res.status(409).json(command);
        }

        const token = decryptAssetCredential(asset.edgeCredentialSecret);
        const zoneId = asset.edgeCredentialMeta.zoneId;

        try {
          if (req.body.action === 'block_ip') {
            const ruleId = await pushIpBlockRule(token, zoneId, req.body.target, req.body.reason);
            await command.update({ status: 'acknowledged', acknowledgedAt: new Date(), externalRef: ruleId });
          } else if (req.body.action === 'unblock_ip') {
            const blockCommand = await AgentCommand.findOne({
              where: { applicationAssetId: asset.id, action: 'block_ip', target: req.body.target, status: 'acknowledged' },
              order: [['createdAt', 'DESC']],
            });
            if (!blockCommand?.externalRef) {
              await command.update({ status: 'failed', failureReason: `No active block found for ${req.body.target} to remove.` });
              return res.status(409).json(command);
            }
            await removeIpBlockRule(token, zoneId, blockCommand.externalRef);
            await command.update({ status: 'acknowledged', acknowledgedAt: new Date(), externalRef: blockCommand.externalRef });
          }
        } catch (err) {
          await command.update({ status: 'failed', failureReason: err.message });
          return res.status(502).json(command);
        }
      }

      return res.status(201).json(command);
    },
  );

  router.get('/:id/commands/pending', eitherKeyAuth, async (req, res) => {
    // Lazy cleanup: anything that expired before an agent ever polled for
    // it is dead, not delivered late — fail it out rather than let a
    // long-overdue block/unblock surprise-execute on the next poll.
    await AgentCommand.update(
      { status: 'failed', failureReason: 'Expired before being picked up.' },
      { where: { applicationAssetId: req.asset.id, status: 'pending', expiresAt: { [Op.lt]: new Date() } } },
    );

    const commands = await AgentCommand.findAll({
      where: {
        applicationAssetId: req.asset.id,
        status: 'pending',
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: new Date() } }],
      },
      order: [['createdAt', 'ASC']],
    });
    return res.json(commands);
  });

  router.post('/:id/commands/:commandId/ack', eitherKeyAuth, param('commandId').isInt(), async (req, res) => {
    const command = await AgentCommand.findOne({ where: { id: req.params.commandId, applicationAssetId: req.asset.id } });
    if (!command) return res.status(404).json({ error: 'Command not found' });
    await command.update({ status: 'acknowledged', acknowledgedAt: new Date() });
    return res.json({ acknowledged: true });
  });

  return router;
};
