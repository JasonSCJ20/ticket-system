import { createClient } from './client.js';

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_COMMAND_POLL_MS = 15_000;
const MAX_COMMAND_LOG = 500;
const MAX_VISIT_BUFFER = 200;

// Shared heartbeat/command-poll/block-state logic used by both the embedded
// Express middleware (shield, in-process) and the reverse-proxy mode
// (proxy.js, for pre-built systems with no code access) — the two modes
// differ only in how they intercept traffic, not in how they talk to
// CommandCentre or track what they've been told to do.
export function createAgentCore({ assetId, agentKey, commandCentreUrl, heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS, commandPollIntervalMs = DEFAULT_COMMAND_POLL_MS }) {
  if (!assetId || !agentKey || !commandCentreUrl) {
    throw new Error('assetId, agentKey, and commandCentreUrl are required.');
  }

  const client = createClient({ commandCentreUrl, assetId, agentKey });

  let currentMode = 'shadow';
  const blockedIps = new Set();
  const blockedSessions = new Set();

  // A real local audit trail of every command this agent has actually
  // executed — so whoever runs this asset has independent visibility into
  // what CommandCentre has told it to do, rather than having to trust the
  // server's own records. Capped so a compromised/misbehaving server
  // pushing a flood of commands can't grow this unbounded.
  const commandLog = [];
  function recordExecutedCommand(command) {
    const entry = { id: command.id, action: command.action, target: command.target, reason: command.reason || null, executedAt: new Date().toISOString() };
    commandLog.push(entry);
    if (commandLog.length > MAX_COMMAND_LOG) commandLog.shift();
    console.log('[commandcentre-agent] EXECUTED command', JSON.stringify(entry));
  }

  // Benign-traffic visits, buffered here and flushed as one batch on every
  // heartbeat tick — piggybacking on the existing timer rather than adding a
  // second one, and never sending one HTTP call per real request (which
  // would double the agent's own network overhead). Capped so a very busy
  // asset can't grow this unbounded between flushes; oldest entries drop
  // first since recent traffic is more useful than a complete history here.
  const visitBuffer = [];
  function recordVisit(entry) {
    visitBuffer.push(entry);
    if (visitBuffer.length > MAX_VISIT_BUFFER) visitBuffer.shift();
  }

  function flushVisits() {
    if (visitBuffer.length === 0) return;
    const batch = visitBuffer.splice(0, visitBuffer.length);
    client.reportVisits(batch).catch((err) => {
      console.error('[commandcentre-agent] visit report failed:', err.message);
    });
  }

  async function runHeartbeat() {
    try {
      const result = await client.heartbeat();
      if (result?.mode) currentMode = result.mode;
    } catch (err) {
      console.error('[commandcentre-agent] heartbeat failed:', err.message);
    }
    flushVisits();
  }

  async function runCommandPoll() {
    try {
      const commands = await client.fetchPendingCommands();
      for (const command of commands || []) {
        if (command.action === 'block_ip') blockedIps.add(command.target);
        if (command.action === 'unblock_ip') blockedIps.delete(command.target);
        if (command.action === 'block_session') blockedSessions.add(command.target);
        recordExecutedCommand(command);
        await client.ackCommand(command.id).catch(() => {});
      }
    } catch (err) {
      console.error('[commandcentre-agent] command poll failed:', err.message);
    }
  }

  // blockedIps/blockedSessions only ever grew from still-pending commands —
  // once a command was acked, a restarted process had no way to learn it
  // was ever issued, silently un-blocking an IP that was still supposed to
  // be blocked. Called once at startup, before the normal poll loop takes
  // over: replays the asset's full command history (not just pending) to
  // reconstruct the real current state.
  async function resyncActiveBlocks() {
    try {
      const active = await client.fetchActiveBlocks();
      for (const ip of active?.blockedIps || []) blockedIps.add(ip);
      for (const sessionId of active?.blockedSessions || []) blockedSessions.add(sessionId);
    } catch (err) {
      console.error('[commandcentre-agent] active-block resync failed:', err.message);
    }
  }

  const heartbeatTimer = setInterval(runHeartbeat, heartbeatIntervalMs);
  const commandPollTimer = setInterval(runCommandPoll, commandPollIntervalMs);
  heartbeatTimer.unref?.();
  commandPollTimer.unref?.();
  runHeartbeat();
  resyncActiveBlocks().then(runCommandPoll);

  return {
    client,
    isIpBlocked: (ip) => blockedIps.has(ip),
    isSessionBlocked: (sessionId) => Boolean(sessionId) && blockedSessions.has(sessionId),
    getMode: () => currentMode,
    getCommandLog: () => commandLog.slice(),
    recordVisit,
    stop: () => {
      clearInterval(heartbeatTimer);
      clearInterval(commandPollTimer);
    },
  };
}
