// Centralized error handler — must be mounted as the very last app.use()
// so it sits after every route. Anything that reaches here (a synchronous
// throw, or an async rejection forwarded by express-async-errors) gets a
// clean, generic JSON response instead of hanging the request or falling
// through to Express's default HTML error page, which can leak stack
// traces. The real error is always logged server-side regardless of what
// the client sees.
//
// Extracted into its own module (rather than left inline in app.js) so it
// can be unit-tested directly against mock req/res objects — an
// integration test that adds routes to the real app after setup() has
// already run can never actually exercise it, since Express dispatches
// error middleware in registration order and this handler is always
// registered last.
export function createErrorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled request error');
    if (res.headersSent) return;
    const status = Number.isInteger(err?.status) ? err.status : Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : (err.message || 'Request failed') });
  };
}
