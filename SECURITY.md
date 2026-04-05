# Security Hardening Checklist

## Authentication and Authorization

- [x] JWT-based authentication using `python-jose` (FastAPI) and `jsonwebtoken` (Node).
- [x] Password hashing with `bcrypt` via `passlib` (FastAPI) and `bcrypt` (Node).
- [x] Role-Based Access Control (RBAC): `admin`, `analyst`, `leader`.
- [x] `/api/token` endpoint for user login.
- [x] Protected API endpoints requiring valid bearer token.

## Input Validation and Sanitization

- [x] Pydantic schema validators on all request payloads (Python).
- [x] `express-validator` middleware on all routes (Node).
- [x] `bleach` (Python) and `xss` (Node) sanitize user-provided strings.
- [x] Strict `min_length` and `max_length` on fields.
- [x] Numeric sanitization on IDs and roles.

## SQL Injection and ORM

- [x] Use SQLAlchemy ORM (Python) and Sequelize ORM (Node) with parametrized queries.
- [x] No direct SQL string interpolation of user input.

## HTTP Security Headers and CORS

- [x] `helmet` + explicit CORS config (Node).
- [x] `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (Python).
- [x] Restrict CORS origin to frontend host (`http://localhost:5173`).

## Logging / Monitoring

- [x] Add security logging to identify bad authentication attempts and rate limiting.
- [x] Explicit warning when invalid payload hits API.
- [x] Audit log stored in database for all security-relevant operations.
- [x] DB-backed rate limit state (`AuthRateLimits` table) — survives restarts, works in multi-process.

## Hardening Notes

- [x] /api routes require bearer tokens; `api/users` is admin-only.
- [x] `/newticket` flow remains for Telegram but is sanitized.
- [x] Added `run-all.ps1` & `stop-all.ps1` for quick local boot and tear down.
- [x] `enforceProductionSecrets()` — startup guard exits fatally if default secrets are detected in `NODE_ENV=production`.
- [x] Auto-detection of database dialect from `DATABASE_URL` (SQLite dev → PostgreSQL/MySQL prod).

## Known Accepted Risks

| ID | Package | Advisory | Severity | Rationale |
|----|---------|-----------|----------|-----------|
| AR-001 | `request` (via `node-telegram-bot-api`) | [GHSA-p8p7-x288-28g6](https://github.com/advisories/GHSA-p8p7-x288-28g6) | Moderate — SSRF | The `request` library is used internally by `node-telegram-bot-api` for outbound calls to `api.telegram.org`. The SSRF risk requires an attacker to control the URL passed to that library, which is not possible through our API surface. Fix requires downgrading `node-telegram-bot-api` to 0.63.0 (breaking). Risk accepted pending a future migration to `grammy` or `telegraf`. |

## Recommended Production Upgrades

- [x] Use HTTPS/SSL certs (Let's Encrypt) via nginx reverse proxy (`nginx.conf`, `nginx.docker.conf`).
- [x] Move from SQLite to PostgreSQL — configure `DATABASE_URL=postgresql://...`
- [ ] Add WAF for injection and DDoS handling.
- [x] `npm audit` overrides applied for `form-data`, `qs`, `tough-cookie`, `tar`, `braces`, `micromatch`.
- [ ] Add multi-factor authentication and strict account lockout.
- [ ] Migrate `node-telegram-bot-api` to `grammy` or `telegraf` to eliminate the `request` SSRF risk (AR-001).
