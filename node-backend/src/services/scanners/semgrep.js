import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileP = promisify(execFileCb);

const SEVERITY_MAP = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };

// Real static-analysis scanning via the actual semgrep binary, run against
// the platform's own source trees with its community-maintained "auto"
// ruleset (JS/TS/Node-relevant security rules resolved automatically).
// Replaces the old dice-roll "Insecure code pattern identified" canned
// finding in securityEngine.js.
export function createSemgrepScanner({
  run = execFileP,
  readReportFile = (p) => readFile(p, 'utf8'),
  cleanupReportFile = (p) => unlink(p).catch(() => {}),
} = {}) {
  async function scan(sourcePath) {
    const reportPath = path.join(tmpdir(), `semgrep-report-${crypto.randomBytes(8).toString('hex')}.json`);
    try {
      await run('semgrep', [
        'scan',
        '--config', 'auto',
        '--json',
        '--output', reportPath,
        '--exclude', 'node_modules',
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
        cweId: result.extra?.metadata?.cwe?.[0] || null,
      }));
    } finally {
      await cleanupReportFile(reportPath);
    }
  }

  return { scan };
}
