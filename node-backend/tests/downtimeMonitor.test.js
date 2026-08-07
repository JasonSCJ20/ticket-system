import { jest } from '@jest/globals';
import { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runDowntimeSweep } from '../src/services/downtimeMonitor.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';

// Real integration test: a real Sequelize backend and real SecurityFinding
// rows (so the existing afterCreate → Telegram/email notification hook
// really fires), with only the network probes faked — no real HTTP/TCP
// calls in a test environment.
const models = () => ({
  ApplicationAsset: sequelize.models.ApplicationAsset,
  NetworkDevice: sequelize.models.NetworkDevice,
  DatabaseAsset: sequelize.models.DatabaseAsset,
  SecurityFinding: sequelize.models.SecurityFinding,
  Ticket: sequelize.models.Ticket,
  TicketHistory: sequelize.models.TicketHistory,
  TicketAsset: sequelize.models.TicketAsset,
});
const notifyTicket = async () => {};
let defaultOrgId;

beforeAll(async () => {
  await ready;
  const org = await runAsPlatformAdmin(() => sequelize.models.Organization.findOne({ where: { slug: 'scratch-solid-solutions' } }));
  defaultOrgId = org.id;
});

afterAll(async () => {
  await sequelize.close();
});

describe('runDowntimeSweep (real orchestration, faked network probes)', () => {
  it('creates a critical finding with the real probe reason when an application stops responding, and remediates it once it recovers', async () => runWithOrganization(defaultOrgId, async () => {
    await sequelize.models.SecurityFinding.destroy({ where: {} });
    const app = await sequelize.models.ApplicationAsset.create({
      name: `downtime-app-${Date.now()}`,
      baseUrl: 'https://example-downtime-target.test',
      environment: 'production',
      enabled: true,
    });

    const downProbe = jest.fn().mockResolvedValue({
      runtimeState: 'down',
      runtimeReason: 'ECONNREFUSED (simulated)',
      checkedAt: new Date().toISOString(),
    });
    const probes = {
      application: downProbe,
      device: jest.fn().mockResolvedValue({ reachable: true, reason: '' }),
      database: jest.fn().mockResolvedValue({ reachable: true, reason: '' }),
    };

    const first = await runDowntimeSweep({ models: models(), notifyTicket, probes });
    expect(first.newlyDown).toBe(1);

    const finding = await sequelize.models.SecurityFinding.findOne({ where: { applicationAssetId: app.id, category: 'availability' } });
    expect(finding).toBeTruthy();
    expect(finding.severity).toBe('critical');
    // Critical + no manual confirmation required means ingestFinding's
    // autoCreateTicketForFinding path fires immediately, moving status to
    // investigating — the same real behavior any other critical finding gets.
    expect(finding.status).toBe('investigating');
    expect(finding.ticketId).toBeTruthy();
    expect(finding.description).toContain('ECONNREFUSED (simulated)');

    // Still down on the next sweep — must not create a second finding for
    // the same ongoing incident (fingerprint dedup via ingestFinding).
    const second = await runDowntimeSweep({ models: models(), notifyTicket, probes });
    expect(second.newlyDown).toBe(0);
    const stillOne = await sequelize.models.SecurityFinding.count({ where: { applicationAssetId: app.id, category: 'availability' } });
    expect(stillOne).toBe(1);

    // Recovers — the open finding gets marked remediated, not duplicated.
    probes.application = jest.fn().mockResolvedValue({ runtimeState: 'running', runtimeReason: 'ok', checkedAt: new Date().toISOString() });
    const third = await runDowntimeSweep({ models: models(), notifyTicket, probes });
    expect(third.recovered).toBe(1);
    await finding.reload();
    expect(finding.status).toBe('remediated');
  }));

  it('creates a direct finding for a network device with no ApplicationAsset, referencing it by name', async () => runWithOrganization(defaultOrgId, async () => {
    await sequelize.models.SecurityFinding.destroy({ where: {} });
    const device = await sequelize.models.NetworkDevice.create({
      name: `downtime-device-${Date.now()}`,
      deviceType: 'router',
      ipAddress: '10.0.0.99',
      monitoringEnabled: true,
      state: 'online',
    });

    const probes = {
      application: jest.fn().mockResolvedValue({ runtimeState: 'running', runtimeReason: 'ok', checkedAt: new Date().toISOString() }),
      device: jest.fn().mockResolvedValue({ reachable: false, reason: 'No common ports responded within the probe window' }),
      database: jest.fn().mockResolvedValue({ reachable: true, reason: '' }),
    };

    const result = await runDowntimeSweep({ models: models(), notifyTicket, probes });
    expect(result.newlyDown).toBe(1);

    const finding = await sequelize.models.SecurityFinding.findOne({ where: { affectedAssetType: 'network_device', affectedAssetRef: device.name } });
    expect(finding).toBeTruthy();
    expect(finding.severity).toBe('critical');
    expect(finding.description).toContain('No common ports responded');

    await device.reload();
    expect(device.state).toBe('offline');
  }));

  it('creates a direct finding for a database with no ApplicationAsset, referencing it by name', async () => runWithOrganization(defaultOrgId, async () => {
    await sequelize.models.SecurityFinding.destroy({ where: {} });
    const db = await sequelize.models.DatabaseAsset.create({
      name: `downtime-db-${Date.now()}`,
      engine: 'postgresql',
      environment: 'cloud',
      host: 'db.example-downtime.test',
      port: 5432,
      monitoringEnabled: true,
      state: 'online',
    });

    const probes = {
      application: jest.fn().mockResolvedValue({ runtimeState: 'running', runtimeReason: 'ok', checkedAt: new Date().toISOString() }),
      device: jest.fn().mockResolvedValue({ reachable: true, reason: '' }),
      database: jest.fn().mockResolvedValue({ reachable: false, reason: 'Port 5432 did not respond within the probe window' }),
    };

    const result = await runDowntimeSweep({ models: models(), notifyTicket, probes });
    expect(result.newlyDown).toBe(1);

    const finding = await sequelize.models.SecurityFinding.findOne({ where: { affectedAssetType: 'database_asset', affectedAssetRef: db.name } });
    expect(finding).toBeTruthy();
    expect(finding.severity).toBe('critical');

    await db.reload();
    expect(db.state).toBe('offline');
  }));
});
