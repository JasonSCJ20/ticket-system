import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

const execFileP = promisify(execFileCb);

const FAILED_RE = /Failed password for (invalid user )?(\S+) from ([\d.]+) port (\d+)/;
const ACCEPTED_RE = /Accepted (password|publickey) for (\S+) from ([\d.]+) port (\d+)/;

// Source-agnostic: works the same whether the line came from journalctl -o
// cat (no syslog prefix) or a raw /var/log/auth.log line (has one) — the
// regexes search anywhere in the string rather than anchoring at the start.
export function parseAuthLine(line) {
  const failed = FAILED_RE.exec(line);
  if (failed) {
    return { type: 'auth_failure', invalidUser: Boolean(failed[1]), user: failed[2], ip: failed[3] };
  }
  const accepted = ACCEPTED_RE.exec(line);
  if (accepted) {
    return { type: 'auth_success', method: accepted[1], user: accepted[2], ip: accepted[3] };
  }
  return null;
}

export function parseAuthLines(lines) {
  return lines.map(parseAuthLine).filter(Boolean);
}

const AUTH_LOG_PATHS = ['/var/log/auth.log', '/var/log/secure'];

// Real, source-agnostic reader: prefers the systemd journal (works
// regardless of which flat file — or none — the distro logs sshd to),
// falls back to tailing known flat-file paths by byte offset, and degrades
// to nothing if neither is available (containers/macOS/no permissions) —
// same graceful-empty philosophy as portInventory.js's readTcpTables.
//
// Returns a readNewLines() function holding its own cursor state (journal
// "--since" timestamp, or per-file byte offsets) so each poll only sees
// events since the previous poll, never reprocessing the same line twice.
export function createAuthLogReader({ run = execFileP, readFileBuffer = (p) => readFileSync(p) } = {}) {
  let sinceMs = Date.now();
  const fileOffsets = new Map();

  async function readJournal() {
    const sinceIso = new Date(sinceMs).toISOString();
    const { stdout } = await run('journalctl', ['-u', 'ssh', '-u', 'sshd', '--since', sinceIso, '-o', 'cat', '--no-pager']);
    return stdout.split('\n').filter(Boolean);
  }

  function readFlatFiles() {
    const lines = [];
    for (const path of AUTH_LOG_PATHS) {
      try {
        const buf = readFileBuffer(path);
        const size = buf.length;
        // First time seeing this file: skip the existing backlog, only
        // report lines written after the sentinel started watching.
        const lastOffset = fileOffsets.has(path) ? fileOffsets.get(path) : size;
        const offset = size < lastOffset ? 0 : lastOffset; // shrank -> rotated, restart from 0
        if (size > offset) {
          lines.push(...buf.slice(offset).toString('utf8').split('\n').filter(Boolean));
        }
        fileOffsets.set(path, size);
      } catch {
        // missing file / no read permission — skip silently, same as the
        // non-Linux degrade-to-empty behavior elsewhere in this package.
      }
    }
    return lines;
  }

  return async function readNewLines() {
    const now = Date.now();
    try {
      const lines = await readJournal();
      sinceMs = now;
      return lines;
    } catch {
      // journalctl missing or failed (non-systemd host) — fall back.
      return readFlatFiles();
    }
  };
}
