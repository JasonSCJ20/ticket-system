import { jest } from '@jest/globals';
import { createGitleaksScanner } from '../src/services/scanners/gitleaks.js';
import { createTrivyScanner } from '../src/services/scanners/trivy.js';
import { createSemgrepScanner } from '../src/services/scanners/semgrep.js';
import { createNucleiScanner } from '../src/services/scanners/nuclei.js';

// Real gitleaks/trivy/semgrep/nuclei binaries aren't available in CI or on a
// dev machine by default — these tests inject a fake executor and fixture
// report content shaped exactly like each tool's real JSON output, and
// assert the parsing/mapping logic is correct. The same dependency-injection
// pattern already proven in sentinel/src/firewall.js's tests.

describe('createGitleaksScanner', () => {
  it('parses real gitleaks JSON report format and never forwards the secret value', async () => {
    const fixture = JSON.stringify([
      {
        RuleID: 'generic-api-key',
        File: 'src/config.js',
        StartLine: 12,
        Description: 'Generic API Key',
        Secret: 'AKIAABCD1234EFGH5678',
        Match: 'api_key = "AKIAABCD1234EFGH5678"',
        Fingerprint: 'abc123:src/config.js:generic-api-key:12',
      },
    ]);
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue(fixture);
    const cleanupReportFile = jest.fn().mockResolvedValue(undefined);
    const scanner = createGitleaksScanner({ run, readReportFile, cleanupReportFile });

    const findings = await scanner.scan('/repo');

    expect(run).toHaveBeenCalledWith('gitleaks', expect.arrayContaining(['detect', '--source', '/repo', '--exit-code', '0']));
    expect(findings).toEqual([
      { ruleId: 'generic-api-key', file: 'src/config.js', line: 12, description: 'Generic API Key', fingerprint: 'abc123:src/config.js:generic-api-key:12' },
    ]);
    expect(JSON.stringify(findings)).not.toContain('AKIAABCD1234EFGH5678');
    expect(cleanupReportFile).toHaveBeenCalled();
  });

  it('returns an empty array when the report is empty (no leaks found)', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue('');
    const scanner = createGitleaksScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    expect(await scanner.scan('/repo')).toEqual([]);
  });

  it('cleans up the report file even if the scan itself throws', async () => {
    const run = jest.fn().mockRejectedValue(new Error('gitleaks: binary not found'));
    const cleanupReportFile = jest.fn().mockResolvedValue(undefined);
    const scanner = createGitleaksScanner({ run, readReportFile: jest.fn(), cleanupReportFile });

    await expect(scanner.scan('/repo')).rejects.toThrow('binary not found');
    expect(cleanupReportFile).toHaveBeenCalled();
  });
});

describe('createTrivyScanner', () => {
  it('parses real trivy filesystem-scan JSON and maps severities to lowercase', async () => {
    const fixture = JSON.stringify({
      Results: [
        {
          Target: 'package-lock.json',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2023-12345',
              PkgName: 'lodash',
              InstalledVersion: '4.17.15',
              FixedVersion: '4.17.21',
              Severity: 'HIGH',
              Title: 'Prototype pollution in lodash',
              PrimaryURL: 'https://nvd.nist.gov/vuln/detail/CVE-2023-12345',
            },
          ],
        },
        { Target: 'some-other-file.json' }, // no Vulnerabilities key at all — must not throw
      ],
    });
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue(fixture);
    const scanner = createTrivyScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    const findings = await scanner.scan('/repo');

    expect(findings).toEqual([
      {
        cveId: 'CVE-2023-12345',
        package: 'lodash',
        installedVersion: '4.17.15',
        fixedVersion: '4.17.21',
        severity: 'high',
        title: 'Prototype pollution in lodash',
        target: 'package-lock.json',
        url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-12345',
      },
    ]);
  });

  it('returns an empty array when there are no Results at all', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue('{}');
    const scanner = createTrivyScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    expect(await scanner.scan('/repo')).toEqual([]);
  });

  it('scanConfig parses real trivy IaC misconfiguration JSON via the config subcommand', async () => {
    const fixture = JSON.stringify({
      Results: [
        {
          Target: 'Dockerfile',
          Misconfigurations: [
            {
              ID: 'DS002',
              Title: 'Image user should not be root',
              Message: 'Specify at least 1 USER command in Dockerfile',
              Resolution: 'Add USER statement',
              Severity: 'HIGH',
              PrimaryURL: 'https://avd.aquasec.com/misconfig/ds002',
            },
          ],
        },
      ],
    });
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue(fixture);
    const scanner = createTrivyScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    const findings = await scanner.scanConfig('/repo');

    expect(run).toHaveBeenCalledWith('trivy', expect.arrayContaining(['config', '/repo']));
    expect(findings).toEqual([
      {
        checkId: 'DS002',
        title: 'Image user should not be root',
        description: 'Specify at least 1 USER command in Dockerfile',
        resolution: 'Add USER statement',
        severity: 'high',
        target: 'Dockerfile',
        url: 'https://avd.aquasec.com/misconfig/ds002',
      },
    ]);
  });
});

describe('createSemgrepScanner', () => {
  it('parses real semgrep JSON output and maps ERROR/WARNING/INFO to severities', async () => {
    const fixture = JSON.stringify({
      results: [
        {
          check_id: 'javascript.express.security.audit.xss.direct-response-write',
          path: 'src/routes/foo.js',
          start: { line: 42 },
          extra: { severity: 'ERROR', message: 'Potential XSS', metadata: { cwe: ['CWE-79'] } },
        },
      ],
    });
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue(fixture);
    const scanner = createSemgrepScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    const findings = await scanner.scan('/repo');

    expect(findings).toEqual([
      {
        ruleId: 'javascript.express.security.audit.xss.direct-response-write',
        file: 'src/routes/foo.js',
        line: 42,
        severity: 'high',
        message: 'Potential XSS',
        cweId: 'CWE-79',
      },
    ]);
  });
});

describe('createNucleiScanner', () => {
  it('parses real nuclei JSONL output (one JSON object per line)', async () => {
    const fixtureLines = [
      JSON.stringify({
        'template-id': 'exposed-panels/generic-admin-panel',
        info: { name: 'Generic Admin Panel', severity: 'medium', description: 'Admin panel exposed', tags: ['panel'] },
        host: 'https://example.com',
        'matched-at': 'https://example.com/admin',
      }),
    ].join('\n');
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockResolvedValue(fixtureLines);
    const scanner = createNucleiScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    const findings = await scanner.scan('https://example.com');

    expect(run).toHaveBeenCalledWith('nuclei', expect.arrayContaining(['-u', 'https://example.com']));
    expect(findings).toEqual([
      {
        templateId: 'exposed-panels/generic-admin-panel',
        name: 'Generic Admin Panel',
        severity: 'medium',
        description: 'Admin panel exposed',
        matchedAt: 'https://example.com/admin',
        tags: ['panel'],
      },
    ]);
  });

  it('returns an empty array when nuclei creates no report file (nothing matched)', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const readReportFile = jest.fn().mockRejectedValue(new Error('ENOENT'));
    const scanner = createNucleiScanner({ run, readReportFile, cleanupReportFile: jest.fn() });

    expect(await scanner.scan('https://example.com')).toEqual([]);
  });

  it('refuses to scan a non-http(s) target without ever invoking the executor', async () => {
    const run = jest.fn();
    const scanner = createNucleiScanner({ run });

    await expect(scanner.scan('ftp://example.com')).rejects.toThrow(/non-http/);
    await expect(scanner.scan('rm -rf / ; https://example.com')).rejects.toThrow(/non-http/);
    expect(run).not.toHaveBeenCalled();
  });
});
