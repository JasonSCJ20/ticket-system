import { createAgentCore } from './core.js';
import { inspectRequest } from './rules.js';

/**
 * Embedded Express middleware for a CommandCentre-registered application —
 * for when you have code access to the app itself. For pre-built systems
 * you don't have code access to but can still put a process in front of
 * (server/SSH access, no Cloudflare), see proxy.js instead — same
 * detection/heartbeat/command logic, different traffic-interception model.
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
  const { getSessionId = () => null } = options;
  const core = createAgentCore(options);

  function middleware(req, res, next) {
    const canaryNonce = req.headers['x-commandcentre-canary'];
    if (canaryNonce) {
      // The canary probe is the verification mechanism itself — always
      // "blocked" here regardless of shadow/active mode, and reported
      // immediately so the operator's verification check resolves fast.
      core.client.reportCanary(canaryNonce).catch((err) => {
        console.error('[commandcentre-agent] canary report failed:', err.message);
      });
      res.status(403).json({ error: 'Blocked by CommandCentre agent (verification probe)' });
      return;
    }

    const sourceIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const sessionId = getSessionId(req);

    if (core.isIpBlocked(sourceIp) || core.isSessionBlocked(sessionId)) {
      res.status(403).json({ error: 'Blocked by CommandCentre agent' });
      return;
    }

    const match = inspectRequest(req);
    if (match) {
      const wouldBlock = core.getMode() !== 'active';
      core.client
        .reportFinding({ ...match, wouldBlock, sourceIp, requestPath: req.path })
        .catch((err) => console.error('[commandcentre-agent] finding report failed:', err.message));

      if (core.getMode() === 'active') {
        res.status(403).json({ error: 'Blocked by CommandCentre agent' });
        return;
      }
      // Shadow mode: report and let it through — never touch real traffic
      // until the operator has reviewed the false-positive rate and
      // explicitly promoted this asset to active enforcement.
    }

    // Only legitimate, allowed-through traffic is recorded as a "visit" —
    // blocked/attack requests are already covered by reportFinding above,
    // and canary probes above this point never reach here at all.
    res.on('finish', () => {
      core.recordVisit({
        ipAddress: sourceIp,
        userAgent: req.headers['user-agent'] || null,
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        visitedAt: new Date().toISOString(),
      });
    });

    next();
  }

  middleware.stop = core.stop;
  // Real local audit trail — whoever runs this asset can inspect exactly
  // what CommandCentre has told it to do, independent of the server's own
  // records.
  middleware.getCommandLog = core.getCommandLog;

  return middleware;
}

export { createReverseProxy } from './proxy.js';
