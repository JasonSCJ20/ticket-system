import { describe, it, expect } from 'vitest';
import { parseTcpTable, listListeningPorts, listActiveConnections, listOutboundConnections } from '../src/portInventory.js';

// A real-shaped /proc/net/tcp fixture: header row + a LISTEN on port 22 (0x16),
// an ESTABLISHED connection from a remote host, and a TIME_WAIT entry that
// should be ignored by both helper functions.
const FIXTURE = `
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1F90 0201A8C0:C350 01 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 100 0 0 10 0
   2: 00000000:01BB 00000000:0000 06 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0
`;

describe('parseTcpTable', () => {
  it('decodes hex IP:port pairs and connection state for every row', () => {
    const rows = parseTcpTable(FIXTURE);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({ localIp: '0.0.0.0', localPort: 22, state: 'LISTEN' });
    expect(rows[1]).toMatchObject({ localIp: '127.0.0.1', localPort: 8080, remoteIp: '192.168.1.2', remotePort: 50000, state: 'ESTABLISHED' });
    expect(rows[2]).toMatchObject({ localPort: 443, state: 'TIME_WAIT' });
  });
});

describe('listListeningPorts', () => {
  it('returns only ports in LISTEN state', () => {
    const rows = parseTcpTable(FIXTURE);
    expect(listListeningPorts(rows)).toEqual([22]);
  });
});

describe('listActiveConnections', () => {
  it('returns only ESTABLISHED connections with a real remote IP', () => {
    const rows = parseTcpTable(FIXTURE);
    const active = listActiveConnections(rows);
    expect(active).toHaveLength(1);
    expect(active[0].remoteIp).toBe('192.168.1.2');
  });
});

describe('listOutboundConnections', () => {
  it('excludes an ESTABLISHED row whose local port is one this host listens on (inbound)', () => {
    const rows = [
      { localIp: '10.0.0.1', localPort: 443, remoteIp: '203.0.113.9', remotePort: 51234, state: 'ESTABLISHED' },
    ];
    expect(listOutboundConnections(rows, [443])).toEqual([]);
  });

  it('includes an ESTABLISHED row whose local port is an ephemeral one this host is NOT listening on (outbound)', () => {
    const rows = [
      { localIp: '10.0.0.1', localPort: 54221, remoteIp: '198.51.100.7', remotePort: 443, state: 'ESTABLISHED' },
    ];
    expect(listOutboundConnections(rows, [22, 443])).toHaveLength(1);
  });

  it('ignores non-ESTABLISHED rows and the 0.0.0.0 placeholder remote', () => {
    const rows = [
      { localIp: '10.0.0.1', localPort: 54221, remoteIp: '0.0.0.0', remotePort: 0, state: 'ESTABLISHED' },
      { localIp: '10.0.0.1', localPort: 54222, remoteIp: '198.51.100.7', remotePort: 443, state: 'TIME_WAIT' },
    ];
    expect(listOutboundConnections(rows, [])).toEqual([]);
  });
});

describe('readTcpTables (real file access, non-Linux host)', () => {
  it('degrades to an empty list instead of throwing when /proc is unavailable', async () => {
    const { readTcpTables } = await import('../src/portInventory.js');
    // This test runs on whatever OS the CI/dev machine actually is — on a
    // real Linux host this would return real rows; the point being checked
    // here is only that a missing/unreadable path never throws.
    expect(() => readTcpTables(['/nonexistent/proc/net/tcp'])).not.toThrow();
    expect(readTcpTables(['/nonexistent/proc/net/tcp'])).toEqual([]);
  });
});
