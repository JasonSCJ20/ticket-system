import { ingestFinding, recomputeAssetHealth } from './securityEngine.js';
import { probeApplicationRuntime, probeTcpReachability, probeDeviceReachability } from './livenessProbe.js';

const DOWNTIME_CATEGORY = 'availability';
const OPEN_STATUSES = ['new', 'investigating'];

// Real implementations by default; tests inject fakes here instead of
// hitting real network sockets, same DI shape as runSecuritySweep's
// `scanners` parameter in securityEngine.js.
export const DEFAULT_PROBES = {
  application: probeApplicationRuntime,
  device: probeDeviceReachability,
  database: probeTcpReachability,
};

// A device/database has no ApplicationAsset to resolve — created directly
// rather than through ingestFinding (which always resolves/creates an
// ApplicationAsset via appName/appUrl, the wrong shape for these). Still
// fires the exact same SecurityFinding afterCreate hook that fans out to
// Telegram/email for every admin/TJN/GJN/operational-team match, since that
// hook runs on any row creation regardless of how it was created.
async function createDirectDowntimeFinding({ SecurityFinding, affectedAssetType, affectedAssetRef, title, description }) {
  return SecurityFinding.create({
    sourceTool: 'CommandCentre Liveness Monitor',
    detectionMode: 'active',
    category: DOWNTIME_CATEGORY,
    severity: 'critical',
    affectedAssetType,
    affectedAssetRef,
    title,
    description,
    executiveSummary: description,
    businessImpact: `${affectedAssetRef} is unreachable — anything depending on it is likely affected right now.`,
    remediationRecommendation: 'Check the device/database directly (power, network path, service status) and confirm it is back online.',
    detectedAt: new Date(),
    manualConfirmed: true,
    requiresManualConfirmation: false,
  });
}

async function findOpenDowntimeFinding(SecurityFinding, where) {
  return SecurityFinding.findOne({ where: { ...where, category: DOWNTIME_CATEGORY, status: OPEN_STATUSES } });
}

async function markRecovered(finding, note) {
  await finding.update({ status: 'remediated', description: `${finding.description}\n\nRecovered: ${note}` });
}

// One sweep, called on a schedule (see app.js) — every registered asset
// with a real address to check gets a live probe every cycle, rather than
// trusting other cron jobs' side-effect timestamps (which run on different
// cadences and would otherwise cause false "down" reads between their own
// check intervals).
export async function runDowntimeSweep({ models, notifyTicket, probes = DEFAULT_PROBES }) {
  const { ApplicationAsset, NetworkDevice, DatabaseAsset, SecurityFinding } = models;
  const results = { checked: 0, newlyDown: 0, recovered: 0 };

  // enabled: true only — excludes bookkeeping-only rows (e.g. the internal
  // self-scan asset securityEngine.js creates with a placeholder baseUrl)
  // from live probing, matching the same filter runSecuritySweep already
  // uses. Without this, a disabled row with no real address to check still
  // gets probed every 5 minutes and can never recover, sitting "critical"
  // forever.
  const apps = await ApplicationAsset.findAll({ where: { enabled: true } });
  for (const app of apps) {
    if (!app.baseUrl) continue;
    results.checked += 1;
    const probe = await probes.application(app.baseUrl);
    const openFinding = await findOpenDowntimeFinding(SecurityFinding, { applicationAssetId: app.id });

    if (probe.runtimeState === 'down') {
      if (!openFinding) {
        await ingestFinding({
          models,
          notifyTicket,
          sourceTool: 'CommandCentre Liveness Monitor',
          detectionMode: 'active',
          category: DOWNTIME_CATEGORY,
          severity: 'critical',
          title: `${app.name} is not responding`,
          description: `${app.name} (${app.baseUrl}) failed a liveness check. Reason: ${probe.runtimeReason}. Checked at ${probe.checkedAt}.`,
          appName: app.name,
          appUrl: app.baseUrl,
          environment: app.environment,
          requiresManualConfirmation: false,
        });
        results.newlyDown += 1;
      }
    } else if (openFinding) {
      await markRecovered(openFinding, `${app.name} responded normally again at ${probe.checkedAt}.`);
      await recomputeAssetHealth(app.id, { ApplicationAsset, SecurityFinding });
      results.recovered += 1;
    }
  }

  const devices = await NetworkDevice.findAll({ where: { monitoringEnabled: true } });
  for (const device of devices) {
    if (!device.ipAddress) continue;
    results.checked += 1;
    const probe = await probes.device(device.ipAddress);
    const openFinding = await findOpenDowntimeFinding(SecurityFinding, { affectedAssetType: 'network_device', affectedAssetRef: device.name });

    if (!probe.reachable) {
      await device.update({ state: 'offline' });
      if (!openFinding) {
        await createDirectDowntimeFinding({
          SecurityFinding,
          affectedAssetType: 'network_device',
          affectedAssetRef: device.name,
          title: `${device.name} is unreachable`,
          description: `${device.name} (${device.ipAddress}) failed a reachability check. Reason: ${probe.reason}. Checked at ${new Date().toISOString()}.`,
        });
        results.newlyDown += 1;
      }
    } else {
      if (device.state === 'offline') await device.update({ state: 'online' });
      if (openFinding) {
        await markRecovered(openFinding, `${device.name} responded again at ${new Date().toISOString()}.`);
        results.recovered += 1;
      }
    }
  }

  const databases = await DatabaseAsset.findAll({ where: { monitoringEnabled: true } });
  for (const db of databases) {
    if (!db.host || !db.port) continue;
    results.checked += 1;
    const probe = await probes.database(db.host, db.port);
    const openFinding = await findOpenDowntimeFinding(SecurityFinding, { affectedAssetType: 'database_asset', affectedAssetRef: db.name });

    if (!probe.reachable) {
      await db.update({ state: 'offline' });
      if (!openFinding) {
        await createDirectDowntimeFinding({
          SecurityFinding,
          affectedAssetType: 'database_asset',
          affectedAssetRef: db.name,
          title: `${db.name} is unreachable`,
          description: `${db.name} (${db.host}:${db.port}) failed a connection check. Reason: ${probe.reason}. Checked at ${new Date().toISOString()}.`,
        });
        results.newlyDown += 1;
      }
    } else {
      if (db.state === 'offline') await db.update({ state: 'online' });
      if (openFinding) {
        await markRecovered(openFinding, `${db.name} accepted a connection again at ${new Date().toISOString()}.`);
        results.recovered += 1;
      }
    }
  }

  return results;
}
