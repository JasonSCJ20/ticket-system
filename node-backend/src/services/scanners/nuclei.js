import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileP = promisify(execFileCb);

function assertValidTarget(url) {
  if (!/^https?:\/\/\S+$/.test(url)) {
    throw new Error(`Refusing to scan a non-http(s) target: ${url}`);
  }
}

// Real active web-vulnerability scanning via the actual nuclei binary,
// targeting a specific registered application asset's live baseUrl —
// replaces the old dice-roll "Potential exposed admin endpoint" canned
// finding in securityEngine.js. This sends real HTTP requests using
// nuclei's community template set and only reports what it actually found.
//
// execFile with an argument array (not a shell string) means there's no
// command-injection surface even before the URL-format check below — same
// defense-in-depth reasoning as sentinel's firewall.js.
export function createNucleiScanner({
  run = execFileP,
  readReportFile = (p) => readFile(p, 'utf8'),
  cleanupReportFile = (p) => unlink(p).catch(() => {}),
} = {}) {
  async function scan(targetUrl) {
    assertValidTarget(targetUrl);
    const reportPath = path.join(tmpdir(), `nuclei-report-${crypto.randomBytes(8).toString('hex')}.jsonl`);
    try {
      await run('nuclei', [
        '-u', targetUrl,
        '-jsonl',
        '-o', reportPath,
        '-severity', 'medium,high,critical',
        // These targets are real, live, paying-client production sites —
        // exclude template categories that are disruptive-by-design (DoS,
        // fuzzing, generally "intrusive") rather than simply informational.
        // A false-positive vulnerability finding is an inconvenience; a
        // scan that knocks over a client's site is a real incident.
        '-etags', 'dos,fuzz,intrusive',
        // Politeness limit — the nuclei default (150 rps) is tuned for a
        // test lab, not someone else's small production server.
        '-rate-limit', '50',
        '-silent',
      ]);
      // nuclei doesn't always create the output file if nothing matched.
      const raw = await readReportFile(reportPath).catch(() => '');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((hit) => ({
          templateId: hit['template-id'],
          name: hit.info?.name,
          severity: hit.info?.severity || 'medium',
          description: hit.info?.description || null,
          matchedAt: hit['matched-at'] || hit.host,
          tags: hit.info?.tags || [],
        }));
    } finally {
      await cleanupReportFile(reportPath);
    }
  }

  // The Dockerfile only ever ran this once, at image-build time — template
  // (and therefore CVE) coverage was silently freezing at whatever existed
  // on the day of the last image build, with no way to notice it going
  // stale. Called on a recurring schedule (see app.js) so real coverage
  // keeps up with newly published templates without needing a rebuild.
  async function updateTemplates() {
    await run('nuclei', ['-update-templates', '-silent']);
  }

  return { scan, updateTemplates };
}
