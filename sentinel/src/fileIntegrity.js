import { createHash } from 'crypto';
import { readFileSync } from 'fs';

// A small, deliberately conservative default watch-list: paths whose
// modification is a classic signal of persistence, privilege escalation, or
// unauthorized configuration change (a new SSH authorized key, a sudoers
// tweak, a cron backdoor). Not a general-purpose file-change scanner —
// hashing arbitrary large trees on a timer doesn't scale and isn't what a
// syscheck-style monitor is for.
const DEFAULT_WATCHED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/ssh/sshd_config',
  '/etc/hosts',
  '/etc/crontab',
];

function hashFile(readFile, path) {
  try {
    return createHash('sha256').update(readFile(path)).digest('hex');
  } catch {
    return null; // missing or unreadable
  }
}

// Real syscheck-style file integrity monitoring: hashes each watched path
// and flags any change against the previously observed hash. First sight of
// a path only establishes its baseline — there's no "before" to compare
// against on a freshly started sentinel, so nothing is flagged until a
// SECOND check sees an actual change.
export function createFileIntegrityMonitor({ watchedPaths = DEFAULT_WATCHED_PATHS, readFile = (p) => readFileSync(p) } = {}) {
  const baseline = new Map(); // path -> hash | null (null = didn't exist at last check)

  function check() {
    const changes = [];
    for (const path of watchedPaths) {
      const hash = hashFile(readFile, path);
      if (!baseline.has(path)) {
        baseline.set(path, hash);
        continue;
      }
      const previous = baseline.get(path);
      if (previous === hash) continue;

      if (previous !== null && hash === null) {
        changes.push({ path, type: 'deleted' });
      } else if (previous === null && hash !== null) {
        changes.push({ path, type: 'created' });
      } else {
        changes.push({ path, type: 'modified' });
      }
      baseline.set(path, hash);
    }
    return changes;
  }

  return { check };
}

export { DEFAULT_WATCHED_PATHS };
