// Real edge enforcement for the "pre-built client system" model — CommandCentre
// acts directly against the client's own edge/WAF provider (Cloudflare) using a
// narrowly-scoped, client-granted API token, rather than relying on an agent the
// client would need to install. There is no agent to poll here, so every action
// below happens synchronously in the same request that requested it — the
// caller finds out immediately whether the block actually took effect.
//
// Cloudflare only, for now — edgeCredentialMeta is expected to carry
// { zoneId }. If another edge provider is ever added, branch on a `provider`
// field in that same meta object instead of guessing from the token shape.

const DEFAULT_API_BASE_URL = 'https://api.cloudflare.com/client/v4';

function apiBaseUrl() {
  return process.env.CLOUDFLARE_EDGE_API_BASE_URL || DEFAULT_API_BASE_URL;
}

async function cloudflareRequest(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok && payload?.success !== false, status: response.status, payload };
}

// The edge equivalent of the embedded agent's canary probe: instead of firing
// a probe and waiting to be told it was seen, we can just ask Cloudflare
// directly whether this exact token actually controls this exact zone — a
// live, synchronous proof of control, not "credential saved".
export async function verifyEdgeCredential(token, zoneId) {
  if (!zoneId) return { verified: false, reason: 'No zone ID configured for this credential.' };
  const { ok, status, payload } = await cloudflareRequest(token, `/zones/${zoneId}`);
  if (!ok) {
    const message = payload?.errors?.[0]?.message || `Cloudflare rejected this token for zone ${zoneId} (HTTP ${status}).`;
    return { verified: false, reason: message };
  }
  return { verified: true, zoneName: payload?.result?.name || null };
}

export async function pushIpBlockRule(token, zoneId, ip, notes) {
  const { ok, status, payload } = await cloudflareRequest(token, `/zones/${zoneId}/firewall/access_rules/rules`, {
    method: 'POST',
    body: {
      mode: 'block',
      configuration: { target: 'ip', value: ip },
      notes: notes || 'Blocked by CommandCentre',
    },
  });
  if (!ok) {
    const message = payload?.errors?.[0]?.message || `Cloudflare rejected the block rule (HTTP ${status}).`;
    throw new Error(message);
  }
  return payload.result.id;
}

export async function removeIpBlockRule(token, zoneId, ruleId) {
  const { ok, status, payload } = await cloudflareRequest(token, `/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`, {
    method: 'DELETE',
  });
  if (!ok) {
    const message = payload?.errors?.[0]?.message || `Cloudflare rejected removing the block rule (HTTP ${status}).`;
    throw new Error(message);
  }
}
