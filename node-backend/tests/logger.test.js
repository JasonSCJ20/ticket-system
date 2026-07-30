import { jest } from '@jest/globals';
import { logger, requestLoggingMiddleware } from '../src/logger.js';

describe('logger', () => {
  it('exposes a real pino-shaped structured logger with level methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });
});

describe('requestLoggingMiddleware', () => {
  it('assigns a request id and a child logger, and sets the response header', () => {
    const req = { headers: {} };
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name] = value; } };
    const next = jest.fn();

    requestLoggingMiddleware(req, res, next);

    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
    expect(typeof req.log.info).toBe('function');
    expect(headers['x-request-id']).toBe(req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses an incoming x-request-id header instead of generating a new one', () => {
    const req = { headers: { 'x-request-id': 'incoming-id-123' } };
    const res = { setHeader: () => {} };
    const next = () => {};

    requestLoggingMiddleware(req, res, next);

    expect(req.requestId).toBe('incoming-id-123');
  });
});
