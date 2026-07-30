import { describe, it, expect } from 'vitest';
import { createFileIntegrityMonitor } from '../src/fileIntegrity.js';

describe('createFileIntegrityMonitor', () => {
  it('establishes a baseline on first check without flagging anything', () => {
    const readFile = () => 'original content';
    const monitor = createFileIntegrityMonitor({ watchedPaths: ['/etc/passwd'], readFile });
    expect(monitor.check()).toEqual([]);
  });

  it('flags a modified file once its content changes on a later check', () => {
    let content = 'original content';
    const readFile = () => content;
    const monitor = createFileIntegrityMonitor({ watchedPaths: ['/etc/passwd'], readFile });
    monitor.check(); // baseline
    content = 'tampered content';
    expect(monitor.check()).toEqual([{ path: '/etc/passwd', type: 'modified' }]);
  });

  it('does not re-flag the same content on repeated checks', () => {
    const readFile = () => 'stable content';
    const monitor = createFileIntegrityMonitor({ watchedPaths: ['/etc/passwd'], readFile });
    monitor.check();
    expect(monitor.check()).toEqual([]);
    expect(monitor.check()).toEqual([]);
  });

  it('flags a watched file that disappears between checks', () => {
    let exists = true;
    const readFile = (path) => {
      if (!exists) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return 'content';
    };
    const monitor = createFileIntegrityMonitor({ watchedPaths: ['/etc/sudoers'], readFile });
    monitor.check(); // baseline: exists
    exists = false;
    expect(monitor.check()).toEqual([{ path: '/etc/sudoers', type: 'deleted' }]);
  });

  it('flags a watched path that newly appears after not existing at baseline', () => {
    let exists = false;
    const readFile = () => {
      if (!exists) throw new Error('ENOENT');
      return 'new file content';
    };
    const monitor = createFileIntegrityMonitor({ watchedPaths: ['/root/.ssh/authorized_keys'], readFile });
    monitor.check(); // baseline: missing
    exists = true;
    expect(monitor.check()).toEqual([{ path: '/root/.ssh/authorized_keys', type: 'created' }]);
  });

  it('tracks multiple watched paths independently', () => {
    const contents = { '/etc/passwd': 'a', '/etc/hosts': 'b' };
    const readFile = (path) => contents[path];
    const monitor = createFileIntegrityMonitor({ watchedPaths: ['/etc/passwd', '/etc/hosts'], readFile });
    monitor.check();
    contents['/etc/hosts'] = 'changed';
    const changes = monitor.check();
    expect(changes).toEqual([{ path: '/etc/hosts', type: 'modified' }]);
  });
});
