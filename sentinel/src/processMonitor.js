import fs from 'fs';

// Command-line patterns diagnostic of a reverse shell or common
// post-exploitation tooling — the same techniques MITRE ATT&CK catalogs
// under Command and Scripting Interpreter / Ingress Tool Transfer. This is
// necessarily a signature list, not exhaustive (a determined attacker can
// obfuscate around it), but it catches the overwhelmingly common,
// off-the-shelf one-liners actually used in the wild.
const SUSPICIOUS_PATTERNS = [
  /nc\s+.*-e\s/, // netcat with -e (execute shell on connect)
  /\/dev\/tcp\//, // bash's built-in /dev/tcp reverse shell
  /\bbash\s+-i\s/, // interactive bash piped to/from a socket
  /\bsh\s+-i\s/,
  /python[0-9.]*\s+-c\s+.*socket/i, // python one-liner reverse shell
  /perl\s+-e\s+.*socket/i,
  /mkfifo\s+.*\|\s*nc\s/, // classic mkfifo+nc reverse shell chain
  /base64\s+-d.*\|\s*(ba)?sh/, // base64-encoded payload piped straight to a shell
];

// A process running out of a world-writable scratch directory is itself a
// red flag independent of what command it's running — legitimate long-lived
// services don't execute out of /tmp, /dev/shm, or /var/tmp.
const SUSPICIOUS_PATH_PREFIXES = ['/tmp/', '/dev/shm/', '/var/tmp/'];

export function isSuspiciousProcess({ cmdline = '', exePath = '' } = {}) {
  if (SUSPICIOUS_PATTERNS.some((re) => re.test(cmdline))) return true;
  if (exePath && SUSPICIOUS_PATH_PREFIXES.some((prefix) => exePath.startsWith(prefix))) return true;
  return false;
}

function readProcessList(readdir, readFileText, readlink) {
  let pids;
  try {
    pids = readdir('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return []; // not Linux / no /proc access — degrade to no visibility
  }

  const processes = [];
  for (const pid of pids) {
    try {
      const cmdlineRaw = readFileText(`/proc/${pid}/cmdline`);
      const cmdline = cmdlineRaw.split('\0').filter(Boolean).join(' ');
      let exePath = '';
      try {
        exePath = readlink(`/proc/${pid}/exe`);
      } catch {
        // permission denied reading another user's /exe symlink — fine,
        // exePath just stays empty and the pattern check falls back to
        // cmdline alone.
      }
      processes.push({ pid: Number(pid), cmdline, exePath });
    } catch {
      // process exited between listing and reading it — a normal race,
      // just skip it rather than treating it as an error.
    }
  }
  return processes;
}

// Real process/behavior monitoring: snapshots the live process table each
// poll and flags any BRAND NEW process (one that wasn't running at the
// previous check) whose command line or executable path matches a known
// suspicious pattern. Ordinary process churn — every shell command, every
// cron job — is deliberately NOT flagged; only new processes that also
// look suspicious are, or this would fire constantly and be worthless.
//
// Scope note: a suspicious process already running before the sentinel's
// first check is baselined silently, same as file-integrity's first-sight
// behavior — there's no "new" to detect for something that was already
// there. Catching an already-resident threat is what the auth-log,
// port-scan, and outbound-beacon detectors are for.
export function createProcessMonitor({
  readdir = fs.readdirSync,
  readFileText = (p) => fs.readFileSync(p, 'utf8'),
  readlink = fs.readlinkSync,
} = {}) {
  let knownPids = null; // null = no baseline established yet

  function check() {
    const current = readProcessList(readdir, readFileText, readlink);
    const currentPids = new Set(current.map((p) => p.pid));

    if (knownPids === null) {
      knownPids = currentPids;
      return [];
    }

    const flagged = [];
    for (const proc of current) {
      if (knownPids.has(proc.pid)) continue; // already seen, not new
      if (isSuspiciousProcess(proc)) flagged.push(proc);
    }
    knownPids = currentPids;
    return flagged;
  }

  return { check };
}
