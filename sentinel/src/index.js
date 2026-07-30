import { createClient } from './client.js';
import { readTcpTables, listListeningPorts, listActiveConnections, listOutboundConnections } from './portInventory.js';
import { createConnectionTracker } from './connectionTracker.js';
import { createFirewall } from './firewall.js';
import { createAuthLogReader, parseAuthLines } from './authLog.js';
import { createAuthAttemptTracker } from './authTracker.js';
import { createOutboundTracker } from './outboundTracker.js';
import { createFileIntegrityMonitor } from './fileIntegrity.js';
import { createProcessMonitor } from './processMonitor.js';

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_COMMAND_POLL_MS = 15_000;
const DEFAULT_SCAN_CHECK_MS = 10_000;
const DEFAULT_AUTH_LOG_CHECK_MS = 20_000;
const DEFAULT_AUTH_WINDOW_MS = 5 * 60_000;
const DEFAULT_AUTH_FAILURE_THRESHOLD = 5;
const DEFAULT_OUTBOUND_CHECK_MS = 15_000;
const DEFAULT_OUTBOUND_WINDOW_MS = 5 * 60_000;
const DEFAULT_FIM_CHECK_MS = 60_000;
const DEFAULT_PROCESS_CHECK_MS = 10_000;

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
 * @param {number} [options.authLogCheckIntervalMs]
 * @param {number} [options.authWindowMs]
 * @param {number} [options.authFailureThreshold]
 * @param {number} [options.outboundCheckIntervalMs]
 * @param {number} [options.outboundWindowMs]
 * @param {number} [options.fimCheckIntervalMs]
 * @param {string[]} [options.watchedPaths] - files to hash and monitor for change; sensible Linux defaults
 * @param {object} [options.firewall] - injectable, defaults to a real iptables-backed one
 * @param {() => number[]} [options.readOpenPorts] - injectable, defaults to reading real /proc/net/tcp
 * @param {() => object[]} [options.readConnections] - injectable, defaults to reading real /proc/net/tcp
 * @param {() => Promise<string[]>} [options.readAuthLines] - injectable, defaults to journalctl/auth.log
 * @param {() => object[]} [options.readOutboundConnections] - injectable, defaults to reading real /proc/net/tcp
 * @param {(path: string) => Buffer} [options.readWatchedFile] - injectable, defaults to reading real files
 * @param {number} [options.processCheckIntervalMs]
 * @param {object} [options.processReaders] - injectable {readdir, readFileText, readlink}, defaults to reading real /proc
 */
export function sentinel(options) {
  const {
    assetId,
    sentinelKey,
    commandCentreUrl,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    commandPollIntervalMs = DEFAULT_COMMAND_POLL_MS,
    scanCheckIntervalMs = DEFAULT_SCAN_CHECK_MS,
    authLogCheckIntervalMs = DEFAULT_AUTH_LOG_CHECK_MS,
    authWindowMs = DEFAULT_AUTH_WINDOW_MS,
    authFailureThreshold = DEFAULT_AUTH_FAILURE_THRESHOLD,
    outboundCheckIntervalMs = DEFAULT_OUTBOUND_CHECK_MS,
    outboundWindowMs = DEFAULT_OUTBOUND_WINDOW_MS,
    fimCheckIntervalMs = DEFAULT_FIM_CHECK_MS,
    watchedPaths,
    processCheckIntervalMs = DEFAULT_PROCESS_CHECK_MS,
    processReaders,
    firewall = createFirewall(),
    readOpenPorts = () => listListeningPorts(readTcpTables()),
    readConnections = () => listActiveConnections(readTcpTables()),
    readAuthLines = createAuthLogReader(),
    readOutboundConnections = () => {
      const rows = readTcpTables();
      return listOutboundConnections(rows, listListeningPorts(rows));
    },
    readWatchedFile,
  } = options;

  if (!assetId || !sentinelKey || !commandCentreUrl) {
    throw new Error('sentinel() requires assetId, sentinelKey, and commandCentreUrl.');
  }

  const client = createClient({ commandCentreUrl, assetId, sentinelKey });
  const tracker = createConnectionTracker();
  const authTracker = createAuthAttemptTracker({ windowMs: authWindowMs, failureThreshold: authFailureThreshold });
  const outboundTracker = createOutboundTracker({ windowMs: outboundWindowMs });
  const fileIntegrityMonitor = createFileIntegrityMonitor({
    ...(watchedPaths ? { watchedPaths } : {}),
    ...(readWatchedFile ? { readFile: readWatchedFile } : {}),
  });
  const processMonitor = createProcessMonitor(processReaders || {});

  let currentMode = 'shadow';
  const locallyBlockedIps = new Set();
  const locallyBlockedOutboundIps = new Set();

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

  async function runAuthLogCheck() {
    try {
      const lines = await readAuthLines();
      if (lines.length === 0) return;
      const events = parseAuthLines(lines);
      authTracker.record(events);

      for (const event of events) {
        if (event.type !== 'auth_success') continue;
        const compromise = authTracker.checkSuccessAfterFailures(event);
        if (!compromise) continue;
        await client
          .reportFinding({
            category: 'ssh_compromise_suspected',
            severity: 'critical',
            title: `SSH login succeeded for ${compromise.user} from ${compromise.sourceIp} after ${compromise.priorFailedAttempts} failed attempt(s)`,
            description: `${compromise.sourceIp} failed to authenticate ${compromise.priorFailedAttempts} time(s) before succeeding as ${compromise.user}. This may indicate a successful brute-force or credential-stuffing attack — verify this login was expected.`,
            sourceIp: compromise.sourceIp,
            blocked: false,
            evidence: JSON.stringify(compromise),
          })
          .catch((err) => console.error('[commandcentre-sentinel] compromise report failed:', err.message));
      }

      const flagged = authTracker.detectBruteForce();
      for (const brute of flagged) {
        if (locallyBlockedIps.has(brute.sourceIp)) continue; // already handled

        const willBlock = currentMode === 'active';
        if (willBlock) {
          try {
            await firewall.blockIp(brute.sourceIp);
            locallyBlockedIps.add(brute.sourceIp);
          } catch (err) {
            console.error('[commandcentre-sentinel] firewall block failed:', err.message);
          }
        }

        await client
          .reportFinding({
            category: 'brute_force_ssh',
            severity: brute.attemptCount >= 15 ? 'critical' : 'high',
            title: `SSH brute-force attempt from ${brute.sourceIp}`,
            description: `${brute.sourceIp} made ${brute.attemptCount} failed SSH login attempt(s) in the last ${Math.round(authWindowMs / 60_000)} minute(s), targeting user(s): ${brute.users.join(', ')}.`,
            sourceIp: brute.sourceIp,
            blocked: willBlock,
            evidence: JSON.stringify(brute),
          })
          .catch((err) => console.error('[commandcentre-sentinel] brute-force report failed:', err.message));
      }
    } catch (err) {
      console.error('[commandcentre-sentinel] auth log check failed:', err.message);
    }
  }

  async function runOutboundCheck() {
    try {
      outboundTracker.record(readOutboundConnections());

      const fanOut = outboundTracker.detectFanOut();
      if (fanOut) {
        await client
          .reportFinding({
            category: 'outbound_fanout',
            severity: fanOut.destinationCount >= 100 ? 'critical' : 'high',
            title: `Unusual outbound connection fan-out (${fanOut.destinationCount} distinct destinations)`,
            description: `This host opened outbound connections to ${fanOut.destinationCount} distinct destination IPs within the last ${Math.round(outboundWindowMs / 60_000)} minute(s) — a pattern consistent with bulk data exfiltration or a compromised host probing for C2 infrastructure. Not auto-blocked: too many destinations to isolate individually without risking legitimate traffic — review manually.`,
            blocked: false,
            evidence: JSON.stringify(fanOut),
          })
          .catch((err) => console.error('[commandcentre-sentinel] outbound fan-out report failed:', err.message));
      }

      const beacons = outboundTracker.detectBeacons();
      for (const beacon of beacons) {
        if (locallyBlockedOutboundIps.has(beacon.remoteIp)) continue;

        const willBlock = currentMode === 'active';
        if (willBlock) {
          try {
            await firewall.blockOutboundIp(beacon.remoteIp);
            locallyBlockedOutboundIps.add(beacon.remoteIp);
          } catch (err) {
            console.error('[commandcentre-sentinel] outbound firewall block failed:', err.message);
          }
        }

        await client
          .reportFinding({
            category: 'outbound_beaconing',
            severity: 'high',
            title: `Possible C2 beaconing to ${beacon.remoteIp}:${beacon.remotePort}`,
            description: `This host connected to ${beacon.remoteIp}:${beacon.remotePort} ${beacon.occurrences} times at a suspiciously regular ~${Math.round(beacon.intervalMs / 1000)}s interval — a pattern typical of scripted command-and-control check-ins rather than normal application traffic.`,
            sourceIp: beacon.remoteIp,
            blocked: willBlock,
            evidence: JSON.stringify(beacon),
          })
          .catch((err) => console.error('[commandcentre-sentinel] beacon report failed:', err.message));
      }
    } catch (err) {
      console.error('[commandcentre-sentinel] outbound check failed:', err.message);
    }
  }

  async function runFimCheck() {
    try {
      const changes = fileIntegrityMonitor.check();
      for (const change of changes) {
        const verb = change.type === 'modified' ? 'Modified' : change.type === 'deleted' ? 'Deleted' : 'Created';
        await client
          .reportFinding({
            category: 'file_integrity_violation',
            severity: change.type === 'deleted' ? 'critical' : 'high',
            title: `${verb} sensitive file: ${change.path}`,
            description: `${change.path} was ${change.type} since it was last checked. Changes to this file can indicate a persistence mechanism, privilege escalation, or unauthorized configuration change — verify this was expected.`,
            blocked: false,
            evidence: JSON.stringify(change),
          })
          .catch((err) => console.error('[commandcentre-sentinel] file integrity report failed:', err.message));
      }
    } catch (err) {
      console.error('[commandcentre-sentinel] file integrity check failed:', err.message);
    }
  }

  async function runProcessCheck() {
    try {
      const flagged = processMonitor.check();
      for (const proc of flagged) {
        await client
          .reportFinding({
            category: 'suspicious_process',
            severity: 'critical',
            title: `Suspicious new process (pid ${proc.pid}): ${proc.cmdline.slice(0, 80)}`,
            description: `A newly-started process on this host matches a known reverse-shell or post-exploitation pattern.${proc.exePath ? ` Executable: ${proc.exePath}.` : ''} Command line: ${proc.cmdline}`,
            blocked: false,
            evidence: JSON.stringify(proc),
          })
          .catch((err) => console.error('[commandcentre-sentinel] process report failed:', err.message));
      }
    } catch (err) {
      console.error('[commandcentre-sentinel] process check failed:', err.message);
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
  const authLogCheckTimer = setInterval(runAuthLogCheck, authLogCheckIntervalMs);
  const outboundCheckTimer = setInterval(runOutboundCheck, outboundCheckIntervalMs);
  const fimCheckTimer = setInterval(runFimCheck, fimCheckIntervalMs);
  const processCheckTimer = setInterval(runProcessCheck, processCheckIntervalMs);
  const commandPollTimer = setInterval(runCommandPoll, commandPollIntervalMs);
  heartbeatTimer.unref?.();
  scanCheckTimer.unref?.();
  authLogCheckTimer.unref?.();
  outboundCheckTimer.unref?.();
  fimCheckTimer.unref?.();
  processCheckTimer.unref?.();
  commandPollTimer.unref?.();

  // The very first scan/auth-log/outbound check must not race ahead of the
  // very first heartbeat — otherwise it always evaluates against the
  // default 'shadow' value and a freshly-active asset's first detection
  // would go unblocked until the next tick. Subsequent ticks run
  // independently on their own intervals, since currentMode is already
  // established by then. FIM has no block/shadow distinction (it never
  // auto-remediates), so its first run isn't part of this ordering
  // constraint, but it still runs once immediately rather than waiting a
  // full interval to establish its baseline.
  runHeartbeat().then(() => {
    runScanCheck();
    runAuthLogCheck();
    runOutboundCheck();
    runFimCheck();
    runProcessCheck();
    runCommandPoll();
  });

  return {
    stop: () => {
      clearInterval(heartbeatTimer);
      clearInterval(scanCheckTimer);
      clearInterval(authLogCheckTimer);
      clearInterval(outboundCheckTimer);
      clearInterval(fimCheckTimer);
      clearInterval(processCheckTimer);
      clearInterval(commandPollTimer);
    },
  };
}
