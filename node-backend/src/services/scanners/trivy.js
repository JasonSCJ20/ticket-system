import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileP = promisify(execFileCb);

const SEVERITY_MAP = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'low' };

// Real dependency-vulnerability scanning via the actual trivy binary,
// scanning the platform's own package trees — the same class of check the
// CI audit gate already does with `npm audit`, but continuous and backed by
// trivy's broader vulnerability database rather than npm's advisory feed
// alone. Replaces the old dice-roll "Critical dependency CVE exposure
// detected" canned finding in securityEngine.js.
export function createTrivyScanner({
  run = execFileP,
  readReportFile = (p) => readFile(p, 'utf8'),
  cleanupReportFile = (p) => unlink(p).catch(() => {}),
} = {}) {
  async function scan(sourcePath) {
    const reportPath = path.join(tmpdir(), `trivy-report-${crypto.randomBytes(8).toString('hex')}.json`);
    try {
      await run('trivy', [
        'fs',
        '--format', 'json',
        '--output', reportPath,
        '--severity', 'MEDIUM,HIGH,CRITICAL',
        '--skip-dirs', 'node_modules',
        sourcePath,
      ]);
      const raw = await readReportFile(reportPath);
      const report = raw.trim() ? JSON.parse(raw) : {};
      const findings = [];
      for (const result of report.Results || []) {
        for (const vuln of result.Vulnerabilities || []) {
          findings.push({
            cveId: vuln.VulnerabilityID,
            package: vuln.PkgName,
            installedVersion: vuln.InstalledVersion,
            fixedVersion: vuln.FixedVersion || null,
            severity: SEVERITY_MAP[vuln.Severity] || 'medium',
            title: vuln.Title || vuln.VulnerabilityID,
            target: result.Target,
            url: vuln.PrimaryURL || null,
          });
        }
      }
      return findings;
    } finally {
      await cleanupReportFile(reportPath);
    }
  }

  // Real IaC misconfiguration scanning (`trivy config`) — a genuinely
  // different check from `scan` above (dependency CVEs): this parses the
  // Dockerfile itself for real misconfigurations (missing USER directive
  // running as root, secrets baked into ENV, `:latest` base image tags,
  // etc.), a capability that existed in this binary from day one but was
  // never invoked.
  async function scanConfig(sourcePath) {
    const reportPath = path.join(tmpdir(), `trivy-config-report-${crypto.randomBytes(8).toString('hex')}.json`);
    try {
      await run('trivy', [
        'config',
        '--format', 'json',
        '--output', reportPath,
        '--severity', 'MEDIUM,HIGH,CRITICAL',
        sourcePath,
      ]);
      const raw = await readReportFile(reportPath);
      const report = raw.trim() ? JSON.parse(raw) : {};
      const findings = [];
      for (const result of report.Results || []) {
        for (const misconfig of result.Misconfigurations || []) {
          findings.push({
            checkId: misconfig.ID,
            title: misconfig.Title,
            description: misconfig.Message || misconfig.Description,
            resolution: misconfig.Resolution || null,
            severity: SEVERITY_MAP[misconfig.Severity] || 'medium',
            target: result.Target,
            url: misconfig.PrimaryURL || null,
          });
        }
      }
      return findings;
    } finally {
      await cleanupReportFile(reportPath);
    }
  }

  return { scan, scanConfig };
}
