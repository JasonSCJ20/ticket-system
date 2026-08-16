// Same shape as @commandcentre/agent's client — a thin fetch wrapper, every
// call best-effort so a network blip never crashes the daemon.
export function createClient({ commandCentreUrl, assetId, sentinelKey }) {
  const base = `${commandCentreUrl.replace(/\/$/, '')}/security/applications/${assetId}`;

  async function call(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': sentinelKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`CommandCentre request failed: ${method} ${path} -> ${response.status} ${text}`.slice(0, 300));
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    heartbeat: (openPorts) => call('/sentinel-heartbeat', { method: 'POST', body: { openPorts } }),
    reportFinding: (finding) => call('/sentinel-report', { method: 'POST', body: finding }),
    fetchPendingCommands: () => call('/commands/pending'),
    fetchActiveBlocks: () => call('/commands/active-blocks'),
    ackCommand: (commandId) => call(`/commands/${commandId}/ack`, { method: 'POST' }),
  };
}
