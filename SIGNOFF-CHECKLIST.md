# Release Sign-off Checklist

Use this checklist before stakeholder sign-off.

## 1. Core Build and Test Evidence

- [x] Node backend tests pass: `cd node-backend && npm test`
- [x] Frontend production build passes: `cd frontend && npm run build`
- [x] Sign-off runner passes cleanly: `run-signoff-checks.bat`

## 2. Runtime Verification

- [ ] Core services start with no port collisions: `./run-all.ps1`
- [ ] Frontend reachable at http://localhost:5173
- [ ] Node API reachable at http://localhost:8001
- [ ] Login works with approved admin and analyst accounts

## 3. Feature Validation (Business-Critical)

- [ ] Ticket creation, assignment, transition, and closure verified
- [ ] Executive report and technical report endpoints verified
- [ ] Patch Management board verified:
  - [ ] Application tiles for to-do, in-progress, completed
  - [ ] Network device tiles for to-do, in-progress, completed
  - [ ] Database asset tiles for to-do, in-progress, completed
  - [ ] Patch task create and status transitions verified

## 4. Security and Governance

- [ ] Password reset request rate limiting verified (429 after threshold)
- [ ] Password reset verification rate limiting verified (429 after threshold)
- [ ] Governance audit logs include reset and lockout events
- [x] npm audit high-severity gate passes

## 5. Release Documentation

- [ ] README matches deployed runtime and ports
- [ ] deployment-notes.md reviewed against target environment
- [ ] Security ownership and rollback contact documented

## 6. Sign-off Record

- [x] Sign-off date: 2026-04-05
- [x] Environment: Windows local pre-release gate (cmd + npm)
- [ ] Approved by:
- [x] Evidence links/logs stored: terminal outputs for `run-signoff-checks.bat`, `npm run build`, and `npm audit --audit-level=high` (exit code 0)
