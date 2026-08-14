import { createErrorHandler } from '../src/services/errorHandler.js';

// A direct unit test against the handler function itself, not an
// end-to-end request through the real app — Express dispatches error
// middleware strictly in registration order, and this handler is always
// registered last (see services/errorHandler.js), so any route added to
// the app *after* setup() has already run can never actually reach it.
// Testing the function directly is both simpler and avoids that pitfall.
function mockRes() {
  return {
    statusCode: null,
    headersSent: false,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('createErrorHandler', () => {
  it('returns a clean 500 with a generic message for an error with no status', () => {
    const logger = { error: () => {} };
    const handler = createErrorHandler(logger);
    const res = mockRes();

    handler(new Error('some internal detail'), { method: 'GET', originalUrl: '/api/whatever' }, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('never leaks the real error message when it falls back to 500', () => {
    const logger = { error: () => {} };
    const handler = createErrorHandler(logger);
    const res = mockRes();

    handler(new Error('database password is hunter2'), { method: 'GET', originalUrl: '/api/whatever' }, res, () => {});

    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('respects a custom status/message set on the thrown error', () => {
    const logger = { error: () => {} };
    const handler = createErrorHandler(logger);
    const res = mockRes();
    const err = new Error('asset not found');
    err.status = 404;

    handler(err, { method: 'GET', originalUrl: '/api/security/applications/999' }, res, () => {});

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'asset not found' });
  });

  it('also honors statusCode (not just status) for compatibility with libraries that use either', () => {
    const logger = { error: () => {} };
    const handler = createErrorHandler(logger);
    const res = mockRes();
    const err = new Error('bad request');
    err.statusCode = 400;

    handler(err, { method: 'POST', originalUrl: '/api/tickets' }, res, () => {});

    expect(res.statusCode).toBe(400);
  });

  it('always logs the real error server-side, even though the client only sees a generic message', () => {
    const logged = [];
    const logger = { error: (payload, msg) => logged.push({ payload, msg }) };
    const handler = createErrorHandler(logger);
    const res = mockRes();
    const realError = new Error('the actual root cause');

    handler(realError, { method: 'GET', originalUrl: '/api/x' }, res, () => {});

    expect(logged).toHaveLength(1);
    expect(logged[0].payload.err).toBe(realError);
  });

  it('does nothing further if a response was already sent (avoids a double-send crash)', () => {
    const logger = { error: () => {} };
    const handler = createErrorHandler(logger);
    const res = mockRes();
    res.headersSent = true;

    expect(() => handler(new Error('too late'), { method: 'GET', originalUrl: '/api/x' }, res, () => {})).not.toThrow();
    expect(res.statusCode).toBeNull();
  });
});
