import { describe, it, expect, vi } from 'vitest';
import { createFirewall } from '../src/firewall.js';

// The real iptables binary isn't available (or safe to invoke) in a test
// environment — this injects a fake executor and asserts on the *exact*
// command/args that would have been run for real, which is what actually
// matters: that the command-construction logic is correct, not that this
// specific machine has root and a firewall.
describe('createFirewall', () => {
  it('blockIp runs iptables -I INPUT with a comment tag identifying our own rules', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const firewall = createFirewall({ run });

    await firewall.blockIp('203.0.113.9');

    expect(run).toHaveBeenCalledWith('iptables', [
      '-I', 'INPUT', '-s', '203.0.113.9', '-m', 'comment', '--comment', 'commandcentre-sentinel', '-j', 'DROP',
    ]);
  });

  it('unblockIp runs the matching -D removal', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const firewall = createFirewall({ run });

    await firewall.unblockIp('203.0.113.9');

    expect(run).toHaveBeenCalledWith('iptables', [
      '-D', 'INPUT', '-s', '203.0.113.9', '-m', 'comment', '--comment', 'commandcentre-sentinel', '-j', 'DROP',
    ]);
  });

  it('unblockIp treats "no such rule" as success, not an error', async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('iptables: Bad rule (does a matching rule exist in that chain?).'), { stderr: 'Bad rule' }));
    const firewall = createFirewall({ run });

    await expect(firewall.unblockIp('203.0.113.9')).resolves.toBeUndefined();
  });

  it('refuses to touch the firewall for a malformed IP, without ever calling the executor', async () => {
    const run = vi.fn();
    const firewall = createFirewall({ run });

    await expect(firewall.blockIp('not-an-ip; rm -rf /')).rejects.toThrow(/invalid IP/);
    await expect(firewall.blockIp('999.999.999.999')).rejects.toThrow(/invalid IP/);
    expect(run).not.toHaveBeenCalled();
  });

  it('listBlockedIps parses only rules carrying our own comment tag out of -S output', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: [
        '-P INPUT ACCEPT',
        '-A INPUT -s 203.0.113.9/32 -m comment --comment commandcentre-sentinel -j DROP',
        '-A INPUT -s 198.51.100.4/32 -j DROP', // some unrelated rule this module must not claim
      ].join('\n'),
      stderr: '',
    });
    const firewall = createFirewall({ run });

    const blocked = await firewall.listBlockedIps();
    expect(blocked).toEqual(['203.0.113.9']);
  });

  it('blockOutboundIp runs iptables -I OUTPUT matching by destination', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const firewall = createFirewall({ run });

    await firewall.blockOutboundIp('198.51.100.77');

    expect(run).toHaveBeenCalledWith('iptables', [
      '-I', 'OUTPUT', '-d', '198.51.100.77', '-m', 'comment', '--comment', 'commandcentre-sentinel', '-j', 'DROP',
    ]);
  });

  it('unblockOutboundIp runs the matching -D removal on OUTPUT', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const firewall = createFirewall({ run });

    await firewall.unblockOutboundIp('198.51.100.77');

    expect(run).toHaveBeenCalledWith('iptables', [
      '-D', 'OUTPUT', '-d', '198.51.100.77', '-m', 'comment', '--comment', 'commandcentre-sentinel', '-j', 'DROP',
    ]);
  });

  it('listBlockedOutboundIps parses only our tagged rules out of OUTPUT -S output', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: [
        '-P OUTPUT ACCEPT',
        '-A OUTPUT -d 198.51.100.77/32 -m comment --comment commandcentre-sentinel -j DROP',
        '-A OUTPUT -d 203.0.113.1/32 -j DROP',
      ].join('\n'),
      stderr: '',
    });
    const firewall = createFirewall({ run });

    expect(await firewall.listBlockedOutboundIps()).toEqual(['198.51.100.77']);
  });
});
