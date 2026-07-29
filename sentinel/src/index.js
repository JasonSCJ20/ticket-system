import { createClient } from './client.js';
import { readTcpTables, listListeningPorts, listActiveConnections } from './portInventory.js';
import { createConnectionTracker } from './connectionTracker.js';
import { createFirewall } from './firewall.js';

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_COMMAND_POLL_MS = 15_000;
const DEFAULT_SCAN_CHECK_MS = 10_000;

/**
 * Host-level IDS/IPS daemon. Unlike @commandcentre/agent (an Express
 * middleware embedded in the protected app's own process), this is meant to
 * run as its own standalone process — a systemd service or container
 * sidecar — with elevated network capabilities (CAP_NET_ADMIN, and
 * CAP_NET_RAW if later extended to raw packet capture). Keeping it out of
 * the app's process means a vulnerability in the app itself never hands an
 * attacker firewall control for free.
 *
 * Scope note: port-scan detection here is connection-rate based (see
 * connectionTracker.js) — real, but it won't catch a slow scan spread over
 * hours or a stealth SYN scan that never completes a connection. Those need
 * raw packet capture, which needs root and native bindings; deliberately
 * out of scope for this version in favor of staying lightweight and
 * portable.
 *
 * @param {object} options
 * @param {string} options.assetId
 * @param {string} options.sentinelKey
 * @param {string} options.commandCentreUrl
 * @param {number} [options.heartbeatIntervalMs]
 * @param {number} [options.commandPollIntervalMs]
 * @param {number} [options.scanCheckIntervalMs]
 * @param {object} [options.firewall] - injectable, defaults to a real iptables-backed one
 * @param {() => number[]} [options.readOpenPorts] - injectable, defaults to reading real /proc/net/tcp
 * @param {() => object[]} [options.readConnections] - injectable, defaults to reading real /proc/net/tcp
 */
export function sentinel(options) {
  const {
    assetId,
    sentinelKey,
    commandCentreUrl,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    commandPollIntervalMs = DEFAULT_COMMAND_POLL_MS,
    scanCheckIntervalMs = DEFAULT_SCAN_CHECK_MS,
    firewall = createFirewall(),
    readOpenPorts = () => listListeningPorts(readTcpTables()),
    readConnections = () => listActiveConnections(readTcpTables()),
  } = options;

  if (!assetId || !sentinelKey || !commandCentreUrl) {
    throw new Error('sentinel() requires assetId, sentinelKey, and commandCentreUrl.');
  }

  const client = createClient({ commandCentreUrl, assetId, sentinelKey });
  const tracker = createConnectionTracker();

  let currentMode = 'shadow';
  const locallyBlockedIps = new Set();

  async function runHeartbeat() {
    try {
      const openPorts = readOpenPorts();
      const result = await client.heartbeat(openPorts);
      if (result?.mode) currentMode = result.mode;
    } catch (err) {
      console.error('[commandcentre-sentinel] heartbeat failed:', err.message);
    }
  }

  async function runScanCheck() {
    try {
      tracker.record(readConnections());
      const flagged = tracker.detectScans();

      for (const scan of flagged) {
        if (locallyBlockedIps.has(scan.sourceIp)) continue; // already handled

        const willBlock = currentMode === 'active';
        if (willBlock) {
          try {
            await firewall.blockIp(scan.sourceIp);
            locallyBlockedIps.add(scan.sourceIp);
          } catch (err) {
            console.error('[commandcentre-sentinel] firewall block failed:', err.message);
          }
        }

        await client
          .reportFinding({
            category: 'port_scan',
            severity: scan.portCount >= 50 ? 'critical' : 'high',
            title: `Port scan detected from ${scan.sourceIp}`,
            description: `${scan.sourceIp} touched ${scan.portCount} distinct local ports in the last minute (${scan.ports.slice(0, 10).join(', ')}${scan.ports.length > 10 ? ', …' : ''}).`,
            sourceIp: scan.sourceIp,
            blocked: willBlock,
            evidence: JSON.stringify(scan),
          })
          .catch((err) => console.error('[commandcentre-sentinel] scan report failed:', err.message));
      }
    } catch (err) {
      console.error('[commandcentre-sentinel] scan check failed:', err.message);
    }
  }

  async function runCommandPoll() {
    try {
      const commands = await client.fetchPendingCommands();
      for (const command of commands || []) {
        try {
          if (command.action === 'block_ip') {
            await firewall.blockIp(command.target);
            locallyBlockedIps.add(command.target);
          } else if (command.action === 'unblock_ip') {
            await firewall.unblockIp(command.target);
            locallyBlockedIps.delete(command.target);
          }
          // block_session has no meaning at the network layer — silently
          // not-applicable here (the embedded agent handles that action).
          await client.ackCommand(command.id);
        } catch (err) {
          console.error(`[commandcentre-sentinel] failed to execute command ${command.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[commandcentre-sentinel] command poll failed:', err.message);
    }
  }

  const heartbeatTimer = setInterval(runHeartbeat, heartbeatIntervalMs);
  const scanCheckTimer = setInterval(runScanCheck, scanCheckIntervalMs);
  const commandPollTimer = setInterval(runCommandPoll, commandPollIntervalMs);
  heartbeatTimer.unref?.();
  scanCheckTimer.unref?.();
  commandPollTimer.unref?.();

  // The very first scan check must not race ahead of the very first
  // heartbeat — otherwise it always evaluates against the default 'shadow'
  // value and a freshly-active asset's first scan would go unblocked until
  // the next tick. Subsequent ticks run independently on their own
  // intervals, since currentMode is already established by then.
  runHeartbeat().then(() => {
    runScanCheck();
    runCommandPoll();
  });

  return {
    stop: () => {
      clearInterval(heartbeatTimer);
      clearInterval(scanCheckTimer);
      clearInterval(commandPollTimer);
    },
  };
}
