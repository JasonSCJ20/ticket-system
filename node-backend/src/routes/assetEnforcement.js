import express from 'express';
import crypto from 'crypto';
import { param, body, validationResult } from 'express-validator';
import { generateAgentKey, hashAgentKey, verifyAgentKey, encryptAssetCredential } from '../services/assetSecrets.js';
import { ingestFinding } from '../services/securityEngine.js';

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
  const { ApplicationAsset, AuditLog, AgentCommand, SecurityFinding } = models;

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
    const asset = await ApplicationAsset.findByPk(assetId);
    if (!asset || !asset.agentKeyHash || !verifyAgentKey(presentedKey, asset.agentKeyHash)) {
      return res.status(401).json({ error: 'Invalid agent key' });
    }
    req.asset = asset;
    next();
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

  router.post('/:id/edge-credential', authMiddleware, adminOnly, param('id').isInt(), body('token').isString().trim().isLength({ min: 8, max: 2000 }), body('meta').optional().isObject(), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const asset = await ApplicationAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    await asset.update({
      enforcementModel: 'edge',
      enforcementMode: 'shadow',
      verificationStatus: 'pending',
      edgeCredentialSecret: encryptAssetCredential(req.body.token),
      edgeCredentialMeta: req.body.meta || null,
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
    if (asset.enforcementModel !== 'agent') {
      return res.status(400).json({ error: 'Live canary verification is only implemented for the embedded-agent model right now.' });
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
        models: { ApplicationAsset, SecurityFinding },
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

      const command = await AgentCommand.create({
        applicationAssetId: asset.id,
        action: req.body.action,
        target: req.body.target,
        reason: req.body.reason || null,
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

      return res.status(201).json(command);
    },
  );

  router.get('/:id/commands/pending', agentAuth, async (req, res) => {
    const commands = await AgentCommand.findAll({
      where: { applicationAssetId: req.asset.id, status: 'pending' },
      order: [['createdAt', 'ASC']],
    });
    return res.json(commands);
  });

  router.post('/:id/commands/:commandId/ack', agentAuth, param('commandId').isInt(), async (req, res) => {
    const command = await AgentCommand.findOne({ where: { id: req.params.commandId, applicationAssetId: req.asset.id } });
    if (!command) return res.status(404).json({ error: 'Command not found' });
    await command.update({ status: 'acknowledged', acknowledgedAt: new Date() });
    return res.json({ acknowledged: true });
  });

  return router;
};
