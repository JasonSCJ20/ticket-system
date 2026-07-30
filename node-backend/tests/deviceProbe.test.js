import { EventEmitter } from 'events';
import { createDeviceProbe } from '../src/services/scanners/deviceProbe.js';

// Fake socket: a real EventEmitter so .once()/emit() behave exactly like a
// real net.Socket, without opening any real network connection.
function fakeSocketFactory(outcomeByPort) {
  return (port) => {
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => {};
    const outcome = outcomeByPort[port] || 'closed';
    // Simulate the async nature of a real connection attempt.
    setImmediate(() => {
      if (outcome === 'open') socket.emit('connect');
      else if (outcome === 'timeout') socket.emit('timeout');
      else socket.emit('error', new Error('ECONNREFUSED'));
    });
    return socket;
  };
}

describe('createDeviceProbe', () => {
  it('reports reachable=true and lists only the ports that actually accepted a connection', async () => {
    const connect = fakeSocketFactory({ 22: 'open', 443: 'open', 3389: 'closed' });
    const probe = createDeviceProbe({ connect, ports: [22, 443, 3389] });

    const result = await probe.probe('10.0.0.5');

    expect(result.reachable).toBe(true);
    expect(result.openPorts.sort()).toEqual([22, 443]);
    expect(result.highRiskOpenPorts).toEqual([]);
  });

  it('reports reachable=false when every port refuses or times out', async () => {
    const connect = fakeSocketFactory({ 22: 'closed', 443: 'timeout' });
    const probe = createDeviceProbe({ connect, ports: [22, 443] });

    const result = await probe.probe('10.0.0.99');

    expect(result.reachable).toBe(false);
    expect(result.openPorts).toEqual([]);
  });

  it('flags a high-risk port (RDP) as a real exposure signal when actually open', async () => {
    const connect = fakeSocketFactory({ 443: 'open', 3389: 'open' });
    const probe = createDeviceProbe({ connect, ports: [443, 3389] });

    const result = await probe.probe('10.0.0.7');

    expect(result.highRiskOpenPorts).toEqual([{ port: 3389, reason: expect.stringContaining('RDP') }]);
  });

  it('does not flag ordinary web ports as high-risk', async () => {
    const connect = fakeSocketFactory({ 80: 'open', 443: 'open' });
    const probe = createDeviceProbe({ connect, ports: [80, 443] });

    const result = await probe.probe('10.0.0.8');

    expect(result.highRiskOpenPorts).toEqual([]);
  });
});
