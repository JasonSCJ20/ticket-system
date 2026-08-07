import http from 'http';
import https from 'https';
import { createAgentCore } from './core.js';
import { inspectRequest } from './rules.js';

// Builds a minimal shim that inspectRequest() already knows how to read
// (path/query/body) from a raw Node http.IncomingMessage — a reverse proxy
// has no Express request object to reuse. Query string is always
// inspectable; the body is deliberately NOT buffered/parsed here (unlike
// the embedded middleware, which can piggyback on the host app's own
// body-parser) — buffering the full body before forwarding would add
// latency and memory pressure to every proxied request. Path/query-based
// detection (the majority of the existing SQLi/XSS/path-traversal patterns)
// still applies; body-based detection is a real, documented scope limit of
// this mode, not a silent gap.
// Node's raw sockets report a loopback/IPv4 peer as an IPv4-mapped IPv6
// address (e.g. "::ffff:127.0.0.1") when listening on a dual-stack
// interface — the same normalization already applied in
// routes/securityConnectors.js's normalizeIp(), needed here for the same
// reason: an operator queuing a block for "127.0.0.1" must actually match.
function normalizeIp(ip) {
  return String(ip || '').replace('::ffff:', '');
}

function toInspectable(rawReq, parsedUrl) {
  const query = {};
  for (const [key, value] of parsedUrl.searchParams) query[key] = value;
  return { path: parsedUrl.pathname, url: rawReq.url, query, body: undefined };
}

/**
 * Reverse-proxy mode for pre-built systems you don't have code access to,
 * but that you (or the client) can still put a process in front of on the
 * same server — no Cloudflare, no source changes to the target app. Same
 * real heartbeat/canary/command-poll/detection logic as shield(), just
 * fronting traffic instead of being installed inside the app's own
 * middleware chain.
 *
 * @param {object} options
 * @param {string} options.assetId
 * @param {string} options.agentKey
 * @param {string} options.commandCentreUrl
 * @param {string} options.target - the real app's own address, e.g. http://127.0.0.1:3000
 * @param {number} [options.port] - port this proxy listens on (defaults to 8080)
 * @param {(req) => string|null} [options.getSessionId] - optional cookie/header-based session extractor.
 */
export function createReverseProxy(options) {
  const { target, port = 8080, getSessionId = () => null } = options;
  if (!target) throw new Error('createReverseProxy() requires a target (the real app\'s own address).');

  const targetUrl = new URL(target);
  const targetClient = targetUrl.protocol === 'https:' ? https : http;
  const core = createAgentCore(options);

  const server = http.createServer((req, res) => {
    const canaryNonce = req.headers['x-commandcentre-canary'];
    if (canaryNonce) {
      core.client.reportCanary(canaryNonce).catch((err) => {
        console.error('[commandcentre-agent] canary report failed:', err.message);
      });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Blocked by CommandCentre agent (verification probe)' }));
      return;
    }

    const sourceIp = normalizeIp(req.socket.remoteAddress) || 'unknown';
    const sessionId = getSessionId(req);

    if (core.isIpBlocked(sourceIp) || core.isSessionBlocked(sessionId)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Blocked by CommandCentre agent' }));
      return;
    }

    const parsedUrl = new URL(req.url, 'http://placeholder');
    const match = inspectRequest(toInspectable(req, parsedUrl));
    if (match) {
      const wouldBlock = core.getMode() !== 'active';
      core.client
        .reportFinding({ ...match, wouldBlock, sourceIp, requestPath: parsedUrl.pathname })
        .catch((err) => console.error('[commandcentre-agent] finding report failed:', err.message));

      if (core.getMode() === 'active') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Blocked by CommandCentre agent' }));
        return;
      }
    }

    res.on('finish', () => {
      core.recordVisit({
        ipAddress: sourceIp,
        userAgent: req.headers['user-agent'] || null,
        path: parsedUrl.pathname,
        method: req.method,
        statusCode: res.statusCode,
        visitedAt: new Date().toISOString(),
      });
    });

    const proxyReq = targetClient.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      console.error('[commandcentre-agent] upstream request failed:', err.message);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream application unreachable' }));
    });

    req.pipe(proxyReq);
  });

  server.listen(port, () => {
    console.log(`[commandcentre-agent] reverse proxy listening on :${port}, forwarding to ${target}`);
  });

  server.stop = () => {
    core.stop();
    server.close();
  };
  server.getCommandLog = core.getCommandLog;

  return server;
}
