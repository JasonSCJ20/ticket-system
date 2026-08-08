import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileP = promisify(execFileCb);

const SEVERITY_MAP = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };

// Explicit, curated security-focused registry packs — all free/public,
// resolved over the network with no login required (Semgrep's Pro rules
// within these packs are skipped, not erred on, when unauthenticated).
// Replaces the old --config auto, which pulls a generic, general-purpose
// ruleset tuned for code quality rather than security specifically —
// these packs are purpose-built for exactly what a SOC platform's own
// self-scan should be checking for.
const SEMGREP_CONFIGS = [
  'p/security-audit',
  'p/owasp-top-ten',
  'p/secrets',
  'p/javascript',
  'p/typescript',
  'p/dockerfile',
];

// Real static-analysis scanning via the actual semgrep binary, run against
// the platform's own source trees. Replaces the old dice-roll "Insecure
// code pattern identified" canned finding in securityEngine.js.
export function createSemgrepScanner({
  run = execFileP,
  readReportFile = (p) => readFile(p, 'utf8'),
  cleanupReportFile = (p) => unlink(p).catch(() => {}),
  configs = SEMGREP_CONFIGS,
} = {}) {
  async function scan(sourcePath) {
    const reportPath = path.join(tmpdir(), `semgrep-report-${crypto.randomBytes(8).toString('hex')}.json`);
    try {
      await run('semgrep', [
        'scan',
        ...configs.flatMap((config) => ['--config', config]),
        '--json',
        '--output', reportPath,
        '--exclude', 'node_modules',
        '--metrics', 'off',
        sourcePath,
      ]);
      const raw = await readReportFile(reportPath);
      const report = raw.trim() ? JSON.parse(raw) : {};
      return (report.results || []).map((result) => ({
        ruleId: result.check_id,
        file: result.path,
        line: result.start?.line,
        severity: SEVERITY_MAP[result.extra?.severity] || 'medium',
        message: result.extra?.message,
        // Semgrep's cwe metadata is a full descriptive string (e.g.
        // "CWE-79: Improper Neutralization of Input During Web Page
        // Generation ('Cross-site Scripting')"), not a bare id — extract
        // just the "CWE-NNN" prefix, since SecurityFindings.cweId is
        // STRING(32) and every real Semgrep finding was silently failing
        // to save with a Postgres "value too long" error otherwise.
        cweId: result.extra?.metadata?.cwe?.[0]?.match(/^CWE-\d+/)?.[0] || null,
      }));
    } finally {
      await cleanupReportFile(reportPath);
    }
  }

  return { scan };
}
