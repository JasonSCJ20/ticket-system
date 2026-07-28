// Thin wrapper around fetch for talking to CommandCentre. Every call is
// best-effort: a network failure here must never take down the host app, so
// callers catch and log rather than throw.
export function createClient({ commandCentreUrl, assetId, agentKey }) {
  const base = `${commandCentreUrl.replace(/\/$/, '')}/security/applications/${assetId}`;

  async function call(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': agentKey,
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
    heartbeat: () => call('/agent-heartbeat', { method: 'POST' }),
    reportCanary: (nonce) => call('/agent-report', { method: 'POST', body: { type: 'canary_seen', nonce } }),
    reportFinding: (finding) => call('/agent-report', { method: 'POST', body: { type: 'finding', ...finding } }),
    fetchPendingCommands: () => call('/commands/pending'),
    ackCommand: (commandId) => call(`/commands/${commandId}/ack`, { method: 'POST' }),
  };
}
