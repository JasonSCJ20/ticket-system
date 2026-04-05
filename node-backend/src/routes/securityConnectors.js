import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { Op } from 'sequelize';
import { body, validationResult } from 'express-validator';
import { CONFIG } from '../config.js';
import { ingestFinding } from '../services/securityEngine.js';

const router = express.Router();

function hasValidConnectorSecret(secretHeader) {
  if (!CONFIG.CONNECTOR_SHARED_SECRET) return false;
  const received = Buffer.from(String(secretHeader || ''), 'utf8');
  const expected = Buffer.from(CONFIG.CONNECTOR_SHARED_SECRET, 'utf8');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

function normalizeIp(ip) {
  if (!ip) return '';
  return String(ip).replace('::ffff:', '');
}

function parseAllowedIps() {
  return CONFIG.CONNECTOR_ALLOWED_IPS
    .split(',')
    .map((s) => normalizeIp(s.trim()))
    .filter(Boolean);
}

function hasValidConnectorSignature(req) {
  const timestamp = req.header('x-connector-timestamp');
  const signature = req.header('x-connector-signature');
  if (!timestamp || !signature || !CONFIG.CONNECTOR_SHARED_SECRET) return false;

  const tsNum = Number(timestamp);
  if (Number.isNaN(tsNum)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > CONFIG.CONNECTOR_MAX_SKEW_SECONDS) return false;

  const body = req.rawBody || JSON.stringify(req.body || {});
  const message = `${timestamp}.${body}`;
  const expected = crypto.createHmac('sha256', CONFIG.CONNECTOR_SHARED_SECRET).update(message).digest('hex');

  const received = Buffer.from(String(signature), 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (received.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(received, expectedBuf);
}

function connectorAuth(req, res, next) {
  const secret = req.header('x-connector-secret');
  const validSecret = hasValidConnectorSecret(secret);
  const validSignature = hasValidConnectorSignature(req);
  if (CONFIG.CONNECTOR_ENFORCE_SIGNATURE && !validSignature) {
    return res.status(401).json({ error: 'Invalid connector signature' });
  }
  if (!CONFIG.CONNECTOR_ENFORCE_SIGNATURE && !validSecret && !validSignature) {
    return res.status(401).json({ error: 'Invalid connector secret' });
  }

  const allowedIps = parseAllowedIps();
  if (allowedIps.length > 0) {
    const incomingIp = normalizeIp(req.ip);
    if (!allowedIps.includes(incomingIp)) {
      return res.status(403).json({ error: 'Connector source IP not allowed' });
    }
  }

  return next();
}

function requestDedupeKey(req) {
  const signature = req.header('x-connector-signature') || '';
  const timestamp = req.header('x-connector-timestamp') || '';
  const body = req.rawBody || JSON.stringify(req.body || {});
  return crypto.createHash('sha256').update(`${signature}|${timestamp}|${body}`).digest('hex');
}

function mapWazuhSeverity(level) {
  const n = Number(level);
  if (Number.isNaN(n)) return 'medium';
  if (n >= 13) return 'critical';
  if (n >= 10) return 'high';
  if (n >= 7) return 'medium';
  return 'low';
}

function mapPrometheusSeverity(raw) {
  const val = String(raw || '').toLowerCase();
  if (['critical', 'high', 'medium', 'low'].includes(val)) return val;
  if (val === 'warning') return 'medium';
  if (val === 'info') return 'low';
  return 'medium';
}

export default ({ models, notifyTicket }) => {
  const { ConnectorDeadLetter, ConnectorReceipt } = models;
  const MAX_BATCH = 500;

  const connectorWindowMs = 60 * 1000;
  const wazuhLimiter = rateLimit({
    windowMs: connectorWindowMs,
    max: CONFIG.CONNECTOR_WAZUH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const suricataLimiter = rateLimit({
    windowMs: connectorWindowMs,
    max: CONFIG.CONNECTOR_SURICATA_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const prometheusLimiter = rateLimit({
    windowMs: connectorWindowMs,
    max: CONFIG.CONNECTOR_PROMETHEUS_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const toDeadLetter = async ({ connectorName, externalEventId, candidate, error }) => {
    await ConnectorDeadLetter.create({
      connectorName,
      externalEventId: externalEventId || null,
      status: 'pending',
      payload: JSON.stringify(candidate).slice(0, 10000),
      attemptCount: 1,
      lastError: String(error?.message || error || 'Unknown ingest error').slice(0, 4000),
    });
  };

  const preflight = async (req, res, connectorName) => {
    if (CONFIG.CONNECTOR_REQUIRE_CONTENT_TYPE_JSON && !req.is('application/json')) {
      return { blocked: true, response: res.status(415).json({ error: 'Content-Type must be application/json' }) };
    }

    if ((req.rawBody || '').length > CONFIG.CONNECTOR_MAX_PAYLOAD_BYTES) {
      return { blocked: true, response: res.status(413).json({ error: 'Connector payload too large' }) };
    }

    const dedupeKey = requestDedupeKey(req);
    const existing = await ConnectorReceipt.findOne({ where: { dedupeKey } });
    if (existing) {
      return { blocked: true, response: res.status(409).json({ error: 'Replay detected' }) };
    }

    await ConnectorReceipt.create({
      connectorName,
      dedupeKey,
      sourceIp: normalizeIp(req.ip),
      seenAt: new Date(),
    });

    const ttlMillis = CONFIG.CONNECTOR_REPLAY_TTL_SECONDS * 1000;
    await ConnectorReceipt.destroy({ where: { seenAt: { [Op.lt]: new Date(Date.now() - ttlMillis) } } });

    return { blocked: false };
  };

  router.post('/wazuh/pull', wazuhLimiter, connectorAuth, async (_req, res) => {
    const gate = await preflight(_req, res, 'wazuh');
    if (gate.blocked) return gate.response;

    if (!CONFIG.WAZUH_API_URL || !CONFIG.WAZUH_API_USERNAME || !CONFIG.WAZUH_API_PASSWORD) {
      return res.status(400).json({ error: 'Wazuh connector not configured' });
    }

    const authResponse = await fetch(`${CONFIG.WAZUH_API_URL}/security/user/authenticate?raw=true`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${CONFIG.WAZUH_API_USERNAME}:${CONFIG.WAZUH_API_PASSWORD}`).toString('base64')}`,
      },
    });

    if (!authResponse.ok) {
      return res.status(502).json({ error: 'Failed to authenticate with Wazuh API' });
    }

    const token = (await authResponse.text()).replace(/^"|"$/g, '');

    const alertsResponse = await fetch(`${CONFIG.WAZUH_API_URL}${CONFIG.WAZUH_ALERTS_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!alertsResponse.ok) {
      return res.status(502).json({ error: 'Failed to fetch Wazuh alerts' });
    }

    const payload = await alertsResponse.json();
    const candidates = payload?.data?.affected_items || payload?.affected_items || payload?.alerts || [];
    const alerts = Array.isArray(candidates) ? candidates.slice(0, MAX_BATCH) : [];

    let created = 0;
    for (const alert of alerts) {
      const appName = alert?.agent?.name || alert?.manager?.name || 'Unmapped Application';
      const title = alert?.rule?.description || 'Wazuh alert detected';
      const candidate = {
        models,
        notifyTicket,
        sourceTool: 'Wazuh',
        detectionMode: 'passive',
        category: 'vulnerability',
        severity: mapWazuhSeverity(alert?.rule?.level),
        title,
        description: `Wazuh reported: ${title}`,
        evidence: `rule.id=${alert?.rule?.id || 'n/a'}; location=${alert?.location || 'n/a'}`,
        appName,
        externalEventId: String(alert?.id || alert?._id || ''),
        rawPayload: alert,
      };

      try {
        const result = await ingestFinding(candidate);
        if (result.created) created += 1;
      } catch (err) {
        await toDeadLetter({
          connectorName: 'wazuh',
          externalEventId: candidate.externalEventId,
          candidate,
          error: err,
        });
      }
    }

    return res.status(202).json({ ingested: alerts.length, created });
  });

  router.post('/suricata/eve', suricataLimiter, connectorAuth, body('events').optional().isArray(), async (req, res) => {
    const gate = await preflight(req, res, 'suricata');
    if (gate.blocked) return gate.response;

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const events = Array.isArray(req.body.events)
      ? req.body.events
      : Array.isArray(req.body)
        ? req.body
        : [req.body];

    const batch = events.slice(0, MAX_BATCH);
    let created = 0;

    for (const event of batch) {
      const appName = event?.app_name || event?.app || event?.dest_service || 'Unmapped Application';
      const signature = event?.alert?.signature || event?.event_type || 'Suricata event';
      const severityMap = { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low' };
      const severity = severityMap[event?.alert?.severity] || 'medium';
      const candidate = {
        models,
        notifyTicket,
        sourceTool: 'Suricata',
        detectionMode: 'passive',
        category: 'intrusion',
        severity,
        title: signature,
        description: `Network IDS event for ${appName}`,
        evidence: `src=${event?.src_ip || 'n/a'}:${event?.src_port || 'n/a'} dst=${event?.dest_ip || 'n/a'}:${event?.dest_port || 'n/a'}`,
        appName,
        externalEventId: String(event?.flow_id || event?.event_id || ''),
        rawPayload: event,
      };

      try {
        const result = await ingestFinding(candidate);
        if (result.created) created += 1;
      } catch (err) {
        await toDeadLetter({
          connectorName: 'suricata',
          externalEventId: candidate.externalEventId,
          candidate,
          error: err,
        });
      }
    }

    return res.status(202).json({ ingested: batch.length, created });
  });

  router.post('/prometheus/alerts', prometheusLimiter, connectorAuth, async (req, res) => {
    const gate = await preflight(req, res, 'prometheus');
    if (gate.blocked) return gate.response;

    const alerts = Array.isArray(req.body?.alerts) ? req.body.alerts.slice(0, MAX_BATCH) : [];
    let created = 0;

    for (const alert of alerts) {
      const labels = alert?.labels || {};
      const annotations = alert?.annotations || {};
      const appName = labels.application || labels.app || labels.job || 'Unmapped Application';
      const title = annotations.summary || labels.alertname || 'Prometheus alert';

      const candidate = {
        models,
        notifyTicket,
        sourceTool: 'Prometheus',
        detectionMode: 'passive',
        category: 'availability',
        severity: mapPrometheusSeverity(labels.severity),
        title,
        description: annotations.description || `Prometheus alert ${title}`,
        evidence: `generatorURL=${alert?.generatorURL || 'n/a'}; status=${alert?.status || 'n/a'}`,
        appName,
        externalEventId: String(labels.fingerprint || alert?.fingerprint || ''),
        rawPayload: alert,
      };

      try {
        const result = await ingestFinding(candidate);
        if (result.created) created += 1;
      } catch (err) {
        await toDeadLetter({
          connectorName: 'prometheus',
          externalEventId: candidate.externalEventId,
          candidate,
          error: err,
        });
      }
    }

    return res.status(202).json({ ingested: alerts.length, created });
  });

  return router;
};
