import { jest } from '@jest/globals';
import { ready } from '../src/app.js';
import { sequelize } from '../src/models/index.js';
import { runSecuritySweep } from '../src/services/securityEngine.js';
import { runAsPlatformAdmin, runWithOrganization } from '../src/services/tenantContext.js';

// Real integration test for the rewritten runSecuritySweep: a real Sequelize
// backend (same pattern as tests/api.test.js), real ingestFinding/ticket
// pipeline, with only the scanners themselves faked (no gitleaks/trivy/
// semgrep/nuclei binaries in this test environment) — asserts the sweep
// creates findings ONLY from what a scanner actually reports, never from
// dice-rolling a canned pattern, and that unimplemented tools are recorded
// as skipped rather than fabricated.
const models = () => ({
  ApplicationAsset: sequelize.models.ApplicationAsset,
  SecurityFinding: sequelize.models.SecurityFinding,
  Ticket: sequelize.models.Ticket,
  TicketHistory: sequelize.models.TicketHistory,
  ScanRunRecord: sequelize.models.ScanRunRecord,
  AuditLog: sequelize.models.AuditLog,
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

describe('runSecuritySweep (real orchestration, faked scanner processes)', () => {
  it('active mode: creates findings only from what the injected scanners actually report', async () => runWithOrganization(defaultOrgId, async () => {
    await sequelize.models.SecurityFinding.destroy({ where: {} });
    const app = await sequelize.models.ApplicationAsset.create({
      name: `sweep-app-${Date.now()}`,
      baseUrl: 'https://example-target.test',
      environment: 'production',
      enabled: true,
    });

    const scanners = {
      gitleaks: { scan: jest.fn().mockResolvedValue([{ ruleId: 'aws-key', file: 'src/x.js', line: 5, description: 'AWS key', fingerprint: 'fp-1' }]) },
      trivy: { scan: jest.fn().mockResolvedValue([]) },
      semgrep: { scan: jest.fn().mockResolvedValue([]) },
      nuclei: { scan: jest.fn().mockResolvedValue([{ templateId: 'exposed-panel', name: 'Exposed panel', severity: 'high', matchedAt: `${app.baseUrl}/admin` }]) },
    };

    const created = await runSecuritySweep({ mode: 'active', actor: 'scheduler', models: models(), notifyTicket, scanners });

    const gitleaksFinding = created.find((f) => f.sourceTool === 'Gitleaks');
    const nucleiFinding = created.find((f) => f.sourceTool === 'Nuclei');
    expect(gitleaksFinding).toBeTruthy();
    expect(gitleaksFinding.category).toBe('secrets');
    expect(nucleiFinding).toBeTruthy();
    expect(nucleiFinding.title).toContain(app.name);

    // Nuclei was actually invoked with this app's real baseUrl — not a
    // fabricated target.
    expect(scanners.nuclei.scan).toHaveBeenCalledWith(app.baseUrl);

    // Gitleaks/Trivy/Semgrep ran once for the whole sweep (self-scan), not
    // once per registered application asset.
    expect(scanners.gitleaks.scan).toHaveBeenCalledTimes(1);
  }));

  it('active mode: records unimplemented tools (OWASP ZAP, Dependency-Track) as skipped, never fabricated', async () => runWithOrganization(defaultOrgId, async () => {
    const app = await sequelize.models.ApplicationAsset.create({
      name: `sweep-app-skip-${Date.now()}`,
      baseUrl: 'https://example-target-2.test',
      environment: 'production',
      enabled: true,
    });
    const scanners = {
      gitleaks: { scan: jest.fn().mockResolvedValue([]) },
      trivy: { scan: jest.fn().mockResolvedValue([]) },
      semgrep: { scan: jest.fn().mockResolvedValue([]) },
      nuclei: { scan: jest.fn().mockResolvedValue([]) },
    };

    await runSecuritySweep({ mode: 'active', actor: 'scheduler', models: models(), notifyTicket, scanners });

    const runs = await sequelize.models.ScanRunRecord.findAll({ where: { assetId: app.id } });
    const zapRun = runs.find((r) => r.toolName === 'OWASP ZAP');
    expect(zapRun).toBeTruthy();
    expect(zapRun.status).toBe('skipped');
    expect(zapRun.detail).toMatch(/no real execution path/i);
  }));

  it('passive mode: never creates a SecurityFinding, only skip-records every passive tool', async () => runWithOrganization(defaultOrgId, async () => {
    await sequelize.models.SecurityFinding.destroy({ where: {} });
    const app = await sequelize.models.ApplicationAsset.create({
      name: `sweep-app-passive-${Date.now()}`,
      baseUrl: 'https://example-target-3.test',
      environment: 'production',
      enabled: true,
    });

    const created = await runSecuritySweep({ mode: 'passive', actor: 'scheduler', models: models(), notifyTicket });

    expect(created).toEqual([]);
    const totalFindings = await sequelize.models.SecurityFinding.count();
    expect(totalFindings).toBe(0);

    const runs = await sequelize.models.ScanRunRecord.findAll({ where: { assetId: app.id, mode: 'passive' } });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.status === 'skipped')).toBe(true);
  }));

  it('active mode: a scanner throwing is recorded as failed, not silently swallowed into a fake finding', async () => runWithOrganization(defaultOrgId, async () => {
    const app = await sequelize.models.ApplicationAsset.create({
      name: `sweep-app-fail-${Date.now()}`,
      baseUrl: 'https://example-target-4.test',
      environment: 'production',
      enabled: true,
    });
    const scanners = {
      gitleaks: { scan: jest.fn().mockResolvedValue([]) },
      trivy: { scan: jest.fn().mockResolvedValue([]) },
      semgrep: { scan: jest.fn().mockResolvedValue([]) },
      nuclei: { scan: jest.fn().mockRejectedValue(new Error('nuclei binary not found')) },
    };

    await runSecuritySweep({ mode: 'active', actor: 'scheduler', models: models(), notifyTicket, scanners });

    const runs = await sequelize.models.ScanRunRecord.findAll({ where: { assetId: app.id, toolName: 'Nuclei' } });
    expect(runs[0].status).toBe('failed');
    expect(runs[0].detail).toContain('nuclei binary not found');
  }));
});
