// Auth is now an httpOnly cookie rather than a bearer token in the response
// body (see src/services/authCookie.js) — every test that logs in and then
// makes an authenticated follow-up request needs to pull the cookie back
// out of the login response's Set-Cookie header and replay it, since
// supertest doesn't carry cookies between requests automatically.
export function extractAuthCookie(loginResponse) {
  const setCookieHeaders = loginResponse.headers['set-cookie'] || [];
  const authCookieHeader = setCookieHeaders.find((line) => line.startsWith('access_token='));
  if (!authCookieHeader) throw new Error('Login response did not set an access_token cookie');
  // Only the name=value pair is valid in a request Cookie header — strip
  // the Path/HttpOnly/Secure/SameSite attributes the browser would normally
  // handle on its own.
  return authCookieHeader.split(';')[0];
}
