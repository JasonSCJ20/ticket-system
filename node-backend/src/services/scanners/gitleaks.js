import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileP = promisify(execFileCb);

// Real secret scanning via the actual gitleaks binary — replaces the old
// "Gitleaks" entry in securityEngine.js, which never ran gitleaks at all,
// just rolled dice and picked a canned "Exposed credential material found"
// finding regardless of whether anything was actually leaked.
//
// --exit-code 0 forces a clean process exit even when leaks ARE found
// (gitleaks' own default exit code for "leaks found" is 1, which execFile
// would otherwise treat as a failure) — the report file, not the exit code,
// is the source of truth here.
export function createGitleaksScanner({
  run = execFileP,
  readReportFile = (p) => readFile(p, 'utf8'),
  cleanupReportFile = (p) => unlink(p).catch(() => {}),
} = {}) {
  async function scan(sourcePath) {
    const reportPath = path.join(tmpdir(), `gitleaks-report-${crypto.randomBytes(8).toString('hex')}.json`);
    try {
      await run('gitleaks', [
        'detect',
        '--source', sourcePath,
        '--report-format', 'json',
        '--report-path', reportPath,
        '--exit-code', '0',
        '--no-banner',
      ]);
      const raw = await readReportFile(reportPath);
      const leaks = raw.trim() ? JSON.parse(raw) : [];
      return leaks.map((leak) => ({
        ruleId: leak.RuleID,
        file: leak.File,
        line: leak.StartLine,
        description: leak.Description,
        fingerprint: leak.Fingerprint,
        // Deliberately NOT forwarding leak.Secret / leak.Match — the whole
        // point of this scan is to catch a leaked credential, so echoing
        // the actual secret value into a finding that then gets emailed,
        // Telegrammed, or shown on a dashboard would leak it a second time.
      }));
    } finally {
      await cleanupReportFile(reportPath);
    }
  }

  return { scan };
}
