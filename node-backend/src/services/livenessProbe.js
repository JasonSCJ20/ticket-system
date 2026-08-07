import { createDeviceProbe } from './scanners/deviceProbe.js';

// Real HTTP reachability check against an application's own base URL —
// moved here (from routes/security.js, which still imports it for the
// Assets page's live "runtime" column) so the downtime monitor can share
// the exact same probe rather than reimplementing it. The runtimeReason
// string is the actual HTTP status or connection error, deliberately kept
// verbatim (truncated) rather than paraphrased, since that's the real "why"
// an operator needs when an alert fires.
export async function probeApplicationRuntime(baseUrl) {
  if (!baseUrl) {
    return {
      powerState: 'unknown',
      runtimeState: 'unknown',
      runtimeReason: 'No base URL configured',
      httpStatus: null,
      checkedAt: new Date().toISOString(),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });

    const ok = response.status < 500;
    return {
      powerState: ok ? 'on' : 'off',
      runtimeState: ok ? 'running' : 'down',
      runtimeReason: ok ? 'Application endpoint responded' : `Endpoint returned status ${response.status}`,
      httpStatus: response.status,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = String(err?.message || err || 'Unknown runtime probe failure');
    return {
      powerState: 'off',
      runtimeState: 'down',
      runtimeReason: message.slice(0, 220),
      httpStatus: null,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// A database has no HTTP endpoint to poll and only one port that matters —
// reachability means "is that exact port still open", reusing the same real
// TCP-connect probe already built for device risk scanning.
export async function probeTcpReachability(ip, port) {
  if (!ip || !port) {
    return { reachable: false, reason: 'No IP address/port configured to check' };
  }
  const { probe } = createDeviceProbe({ ports: [port] });
  const result = await probe(ip);
  return {
    reachable: result.reachable,
    reason: result.reachable ? `Port ${port} open` : `Port ${port} did not respond within the probe window`,
  };
}

// A network device's actual service port isn't known in general (router,
// switch, access point, firewall...) — checks the same common-port set
// already used for device risk scanning; reachable on any of them is a
// reasonable "something is answering" signal.
export async function probeDeviceReachability(ip) {
  if (!ip) return { reachable: false, reason: 'No IP address configured to check' };
  const { probe } = createDeviceProbe();
  const result = await probe(ip);
  return {
    reachable: result.reachable,
    reason: result.reachable ? `Responded on port(s) ${result.openPorts.join(', ')}` : 'No common ports responded within the probe window',
  };
}
