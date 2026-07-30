import { describe, it, expect } from 'vitest';
import { parseAuthLine, parseAuthLines, createAuthLogReader } from '../src/authLog.js';

describe('parseAuthLine', () => {
  it('parses a failed password attempt for an invalid user', () => {
    const line = 'Jul 29 10:15:00 host sshd[1234]: Failed password for invalid user admin from 203.0.113.5 port 51234 ssh2';
    expect(parseAuthLine(line)).toEqual({ type: 'auth_failure', invalidUser: true, user: 'admin', ip: '203.0.113.5' });
  });

  it('parses a failed password attempt for a real user', () => {
    const line = 'sshd[1234]: Failed password for root from 203.0.113.5 port 51234 ssh2';
    expect(parseAuthLine(line)).toEqual({ type: 'auth_failure', invalidUser: false, user: 'root', ip: '203.0.113.5' });
  });

  it('parses an accepted password login', () => {
    const line = 'sshd[1234]: Accepted password for deploy from 10.0.0.2 port 51234 ssh2';
    expect(parseAuthLine(line)).toEqual({ type: 'auth_success', method: 'password', user: 'deploy', ip: '10.0.0.2' });
  });

  it('parses an accepted publickey login', () => {
    const line = 'sshd[1234]: Accepted publickey for deploy from 10.0.0.2 port 51234 ssh2: RSA SHA256:abc';
    expect(parseAuthLine(line)).toEqual({ type: 'auth_success', method: 'publickey', user: 'deploy', ip: '10.0.0.2' });
  });

  it('returns null for unrelated log lines', () => {
    expect(parseAuthLine('sshd[1234]: Server listening on 0.0.0.0 port 22.')).toBeNull();
  });
});

describe('parseAuthLines', () => {
  it('filters out unrelated lines and keeps parsed events in order', () => {
    const events = parseAuthLines([
      'sshd[1]: Server listening on 0.0.0.0 port 22.',
      'sshd[2]: Failed password for root from 203.0.113.5 port 51234 ssh2',
      'sshd[3]: Accepted publickey for deploy from 10.0.0.2 port 51234 ssh2',
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('auth_failure');
    expect(events[1].type).toBe('auth_success');
  });
});

describe('createAuthLogReader', () => {
  it('prefers journalctl and returns its lines split from stdout', async () => {
    const run = async (cmd, args) => {
      expect(cmd).toBe('journalctl');
      expect(args).toContain('--since');
      return { stdout: 'line one\nline two\n' };
    };
    const reader = createAuthLogReader({ run, readFileBuffer: () => { throw new Error('should not be called'); } });
    const lines = await reader();
    expect(lines).toEqual(['line one', 'line two']);
  });

  it('falls back to flat files when journalctl is unavailable, skipping pre-existing backlog', async () => {
    const run = async () => { throw new Error('journalctl: command not found'); };
    let call = 0;
    const readFileBuffer = (path) => {
      call += 1;
      if (path !== '/var/log/auth.log') throw new Error('ENOENT');
      // First poll: whole file is "backlog" and should be skipped entirely.
      // Second poll: new bytes appended should be picked up.
      return call === 1
        ? Buffer.from('old backlog line\n')
        : Buffer.from('old backlog line\nsshd[9]: Failed password for root from 198.51.100.9 port 22 ssh2\n');
    };
    const reader = createAuthLogReader({ run, readFileBuffer });

    const first = await reader();
    expect(first).toEqual([]); // backlog skipped on first sight

    const second = await reader();
    expect(second).toEqual(['sshd[9]: Failed password for root from 198.51.100.9 port 22 ssh2']);
  });

  it('restarts from offset 0 when a watched file shrinks (log rotation)', async () => {
    const run = async () => { throw new Error('no journalctl'); };
    let call = 0;
    const readFileBuffer = (path) => {
      if (path !== '/var/log/auth.log') throw new Error('ENOENT');
      call += 1;
      if (call === 1) return Buffer.from('a'.repeat(100));
      return Buffer.from('short\n'); // rotated: much smaller now
    };
    const reader = createAuthLogReader({ run, readFileBuffer });
    await reader(); // establishes baseline offset at 100
    const afterRotation = await reader();
    expect(afterRotation).toEqual(['short']);
  });
});
