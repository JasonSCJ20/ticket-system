import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

// Every rule this module creates carries this comment so listBlockedIps()
// only ever reports (and unblockIp() only ever removes) rules CommandCentre
// itself put there — never touches a firewall rule it didn't create.
const RULE_COMMENT = 'commandcentre-sentinel';

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function assertValidIp(ip) {
  if (!IPV4_RE.test(ip) || ip.split('.').some((octet) => Number(octet) > 255)) {
    throw new Error(`Refusing to touch the firewall for an invalid IP: ${ip}`);
  }
}

// execFile (not exec) with an argument array — the shell never sees a
// concatenated string, so there is no command-injection surface here even
// before the IP-format check above. The check is defense in depth, not the
// only thing standing between a bad input and a shell.
export function createFirewall({ run = execFile } = {}) {
  async function blockIp(ip) {
    assertValidIp(ip);
    await run('iptables', ['-I', 'INPUT', '-s', ip, '-m', 'comment', '--comment', RULE_COMMENT, '-j', 'DROP']);
  }

  async function unblockIp(ip) {
    assertValidIp(ip);
    // -D removes a matching rule; if none exists this throws (iptables exits
    // non-zero for "no such rule") — callers treat that as "already clear"
    // rather than a hard failure, since the end state is what they wanted.
    try {
      await run('iptables', ['-D', 'INPUT', '-s', ip, '-m', 'comment', '--comment', RULE_COMMENT, '-j', 'DROP']);
    } catch (err) {
      if (!/No chain\/target\/match|Bad rule/i.test(err.stderr || err.message || '')) throw err;
    }
  }

  async function listBlockedIps() {
    const { stdout } = await run('iptables', ['-S', 'INPUT']);
    const ips = [];
    for (const line of stdout.split('\n')) {
      if (!line.includes(RULE_COMMENT)) continue;
      const match = line.match(/-s (\d{1,3}(?:\.\d{1,3}){3})/);
      if (match) ips.push(match[1]);
    }
    return ips;
  }

  // Same idea as blockIp/unblockIp but on the OUTPUT chain, matching by
  // destination (-d) instead of source (-s) — for isolating a confirmed
  // outbound C2/beaconing destination rather than an inbound attacker.
  async function blockOutboundIp(ip) {
    assertValidIp(ip);
    await run('iptables', ['-I', 'OUTPUT', '-d', ip, '-m', 'comment', '--comment', RULE_COMMENT, '-j', 'DROP']);
  }

  async function unblockOutboundIp(ip) {
    assertValidIp(ip);
    try {
      await run('iptables', ['-D', 'OUTPUT', '-d', ip, '-m', 'comment', '--comment', RULE_COMMENT, '-j', 'DROP']);
    } catch (err) {
      if (!/No chain\/target\/match|Bad rule/i.test(err.stderr || err.message || '')) throw err;
    }
  }

  async function listBlockedOutboundIps() {
    const { stdout } = await run('iptables', ['-S', 'OUTPUT']);
    const ips = [];
    for (const line of stdout.split('\n')) {
      if (!line.includes(RULE_COMMENT)) continue;
      const match = line.match(/-d (\d{1,3}(?:\.\d{1,3}){3})/);
      if (match) ips.push(match[1]);
    }
    return ips;
  }

  return { blockIp, unblockIp, listBlockedIps, blockOutboundIp, unblockOutboundIp, listBlockedOutboundIps };
}
