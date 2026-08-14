// Shared helpers for the auth-token httpOnly cookie — kept in one place so
// the cookie name/attributes stay identical across every issuance site
// (login, profile-update reissue) and the one place that clears it (logout).
//
// SameSite=Lax (not None) is correct here even though the frontend
// (soc.scratchsolidsolutions.org) and backend (soc-api.scratchsolidsolutions.org)
// are different origins: SameSite is scoped to the registrable domain
// ("site"), not the origin, so these two subdomains are same-site — Lax
// cookies are sent on requests between them. SameSite=None would only be
// needed for a genuinely cross-site setup, and would also require dropping
// Chrome's cross-site tracking protections we don't need to opt out of.
export const AUTH_COOKIE_NAME = 'access_token';

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs != null ? { maxAge: maxAgeMs } : {}),
  };
}

export function setAuthCookie(res, token, maxAgeMs) {
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions(maxAgeMs));
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}

// Minimal Cookie-header parser — only ever looked up by exact name, so this
// avoids pulling in cookie-parser for a single value.
export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const headerToken = authHeader.split(' ')[1];
    if (headerToken) return headerToken;
  }

  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;
  for (const pair of rawCookie.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = pair.slice(0, separatorIndex).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
  }
  return null;
}
