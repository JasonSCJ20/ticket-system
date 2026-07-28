import { createClient } from './client.js';
import { inspectRequest } from './rules.js';

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_COMMAND_POLL_MS = 15_000;

/**
 * Embedded Express middleware for a CommandCentre-registered application.
 *
 * @param {object} options
 * @param {string} options.assetId - the ApplicationAsset id this app was registered as.
 * @param {string} options.agentKey - the key issued by CommandCentre for this asset.
 * @param {string} options.commandCentreUrl - base API URL, e.g. https://soc-api.example.org/api
 * @param {number} [options.heartbeatIntervalMs]
 * @param {number} [options.commandPollIntervalMs]
 * @param {(req) => string|null} [options.getSessionId] - optional extractor for
 *   session-scoped blocking (defaults to no session tracking — IP blocking
 *   still works without this).
 */
export function shield(options) {
  const {
    assetId,
    agentKey,
    commandCentreUrl,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    commandPollIntervalMs = DEFAULT_COMMAND_POLL_MS,
    getSessionId = () => null,
  } = options;

  if (!assetId || !agentKey || !commandCentreUrl) {
    throw new Error('shield() requires assetId, agentKey, and commandCentreUrl.');
  }

  const client = createClient({ commandCentreUrl, assetId, agentKey });

  // Local state, refreshed by the background loops below. The middleware
  // itself never blocks on a network call — it only reads these caches.
  let currentMode = 'shadow';
  const blockedIps = new Set();
  const blockedSessions = new Set();

  async function runHeartbeat() {
    try {
      const result = await client.heartbeat();
      if (result?.mode) currentMode = result.mode;
    } catch (err) {
      console.error('[commandcentre-agent] heartbeat failed:', err.message);
    }
  }

  async function runCommandPoll() {
    try {
      const commands = await client.fetchPendingCommands();
      for (const command of commands || []) {
        if (command.action === 'block_ip') blockedIps.add(command.target);
        if (command.action === 'unblock_ip') blockedIps.delete(command.target);
        if (command.action === 'block_session') blockedSessions.add(command.target);
        await client.ackCommand(command.id).catch(() => {});
      }
    } catch (err) {
      console.error('[commandcentre-agent] command poll failed:', err.message);
    }
  }

  const heartbeatTimer = setInterval(runHeartbeat, heartbeatIntervalMs);
  const commandPollTimer = setInterval(runCommandPoll, commandPollIntervalMs);
  heartbeatTimer.unref?.();
  commandPollTimer.unref?.();
  runHeartbeat();
  runCommandPoll();

  function middleware(req, res, next) {
    const canaryNonce = req.headers['x-commandcentre-canary'];
    if (canaryNonce) {
      // The canary probe is the verification mechanism itself — always
      // "blocked" here regardless of shadow/active mode, and reported
      // immediately so the operator's verification check resolves fast.
      client.reportCanary(canaryNonce).catch((err) => {
        console.error('[commandcentre-agent] canary report failed:', err.message);
      });
      res.status(403).json({ error: 'Blocked by CommandCentre agent (verification probe)' });
      return;
    }

    const sourceIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const sessionId = getSessionId(req);

    if (blockedIps.has(sourceIp) || (sessionId && blockedSessions.has(sessionId))) {
      res.status(403).json({ error: 'Blocked by CommandCentre agent' });
      return;
    }

    const match = inspectRequest(req);
    if (match) {
      const wouldBlock = currentMode !== 'active';
      client
        .reportFinding({ ...match, wouldBlock, sourceIp, requestPath: req.path })
        .catch((err) => console.error('[commandcentre-agent] finding report failed:', err.message));

      if (currentMode === 'active') {
        res.status(403).json({ error: 'Blocked by CommandCentre agent' });
        return;
      }
      // Shadow mode: report and let it through — never touch real traffic
      // until the operator has reviewed the false-positive rate and
      // explicitly promoted this asset to active enforcement.
    }

    next();
  }

  middleware.stop = () => {
    clearInterval(heartbeatTimer);
    clearInterval(commandPollTimer);
  };

  return middleware;
}
