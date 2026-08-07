import express from 'express';
import { isValidScjId, validatePassword } from '../utils.js';
import { logger } from '../logger.js';
import {
  AUDIENCE_CODE_LABELS,
  derivePrimaryDepartment,
  getProfileCompletionState,
  isOperationalStaffAudience,
  normalizeOperationalTeams,
} from '../services/userProfile.js';

const ALLOWED_REGISTRATION_EMAIL_DOMAIN = '@scratchsolidsolutions.org';
const SCJ_ID_EXAMPLE = '00000000-00000';

function normalizePersonName(value = '') {
  return value.trim().replace(/\s+/g, ' ');
}

function buildUsername(name, surname) {
  return `${normalizePersonName(name)} ${normalizePersonName(surname)}`.trim();
}

function isAllowedRegistrationEmail(email = '') {
  return email.trim().toLowerCase().endsWith(ALLOWED_REGISTRATION_EMAIL_DOMAIN);
}

function isConfiguredAdminUsername(username = '', config = {}) {
  return String(username || '').trim().toLowerCase() === String(config.ADMIN_USERNAME || '').trim().toLowerCase();
}

function getRegisterConflictMessage(error) {
  const value = String(error?.message || '').toLowerCase();
  if (value.includes('users.email')) return 'Email already exists';
  if (value.includes('users.scjid')) return 'SCJ ID already exists';
  if (value.includes('users.username')) return 'Username already exists';
  if (value.includes('users.name')) return 'Name already exists';
  return 'Name and surname, email, or SCJ ID already exists';
}

export default function authRouteFactory({
  body,
  validationResult,
  Op,
  bcrypt,
  randomInt,
  randomUUID,
  jwt,
  speakeasy,
  authMiddleware,
  config,
  userModel,
  revokeTokenJti,
  consumeAuthAttempt,
  clearAuthAttemptState,
  writePublicAudit,
  sendEmailNotification,
  runAsPlatformAdmin,
  defaultOrganizationId,
  flagUnfamiliarLogin,
}) {
  const router = express.Router();

  router.post(
    '/auth/register',
    body('name').isString().trim().isLength({ min: 2, max: 255 }).withMessage('Name is required'),
    body('surname').isString().trim().isLength({ min: 2, max: 255 }).withMessage('Surname is required'),
    body('scjId').isString().trim().isLength({ min: 14, max: 14 }).withMessage(`SCJ ID must be format ${SCJ_ID_EXAMPLE}`),
    body('email').isEmail().normalizeEmail().withMessage('Email is required and must be valid'),
    body('password').isString().isLength({ min: 12, max: 128 }).withMessage('Password must be at least 12 characters'),
    body('telegramNumber').optional({ nullable: true }).isString().trim().isLength({ min: 8, max: 32 }).withMessage('Telegram phone number must be valid'),
    body('telegramChatId').optional({ nullable: true }).isString().trim().matches(/^-?\d{5,32}$/).withMessage('Telegram chat ID must be numeric'),
    body('audienceCode').isString().trim().isIn(Object.keys(AUDIENCE_CODE_LABELS)).withMessage('Audience code is required'),
    body('operationalTeams')
      .optional({ nullable: true })
      .custom((value) => value === undefined || value === null || Array.isArray(value))
      .withMessage('Select one or two operational teams'),
    body('username').optional().isString().trim().isLength({ min: 3, max: 255 }),
    async (req, res) => runAsPlatformAdmin(async () => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const name = normalizePersonName(req.body.name);
      const surname = normalizePersonName(req.body.surname);
      const scjId = req.body.scjId.trim();
      const email = req.body.email.trim().toLowerCase();
      const username = buildUsername(name, surname);
      const submittedUsername = req.body.username?.trim();
      const telegramNumber = req.body.telegramNumber ? req.body.telegramNumber.trim() : null;
      const telegramChatId = req.body.telegramChatId ? req.body.telegramChatId.trim() : null;
      const audienceCode = req.body.audienceCode.trim().toUpperCase();
      const operationalTeams = normalizeOperationalTeams(req.body.operationalTeams);
      const isOperationalStaff = isOperationalStaffAudience(audienceCode);

      if (isOperationalStaff && (operationalTeams.length < 1 || operationalTeams.length > 2)) {
        return res.status(422).json({ error: 'Select one or two operational teams' });
      }

      if (isOperationalStaff && !telegramNumber) {
        return res.status(422).json({ error: 'Telegram phone number is required for operational staff' });
      }

      if (submittedUsername && submittedUsername !== username) {
        return res.status(422).json({ error: 'Username must match the provided name and surname' });
      }

      if (!isAllowedRegistrationEmail(email)) {
        return res.status(422).json({ error: 'Email address must use the @scratchsolidsolutions.org domain' });
      }

      if (!isValidScjId(scjId)) {
        return res.status(422).json({ error: `SCJ ID must be format ${SCJ_ID_EXAMPLE}` });
      }

      const passwordValidation = validatePassword(req.body.password);
      if (!passwordValidation.isValid) {
        return res.status(422).json({ error: passwordValidation.message });
      }

      try {
        const existing = await userModel.findOne({
          where: {
            [Op.or]: [{ username }, { email }, { scjId }, ...(telegramNumber ? [{ telegramNumber }] : []), ...(telegramChatId ? [{ telegramChatId }] : [])],
          },
        });
        if (existing) return res.status(409).json({ error: 'Name and surname, email, or SCJ ID already exists' });

        const passwordHash = bcrypt.hashSync(req.body.password, 10);
        const created = await userModel.create({
          // Self-registration is still gated to the company's own email
          // domain (see isAllowedRegistrationEmail above) — a real
          // organization-selection/invite flow for reselling to other
          // companies is Phase 2, not built yet. Every self-registered
          // account goes to the one default organization for now.
          organizationId: defaultOrganizationId,
          username,
          name,
          surname,
          department: isOperationalStaff ? derivePrimaryDepartment(operationalTeams) : null,
          operationalTeams: isOperationalStaff ? operationalTeams : [],
          audienceCode,
          jobTitle: 'Security Analyst',
          scjId,
          email,
          telegramNumber,
          telegramChatId,
          role: 'analyst',
          password_hash: passwordHash,
        });

        const profileState = getProfileCompletionState(created);

        return res.status(201).json({
          id: created.id,
          username: created.username,
          name: created.name,
          surname: created.surname,
          scjId: created.scjId,
          email: created.email,
          telegramNumber: created.telegramNumber,
          operationalTeams,
          audienceCode,
          role: created.role,
          profileCompletionRequired: !profileState.isComplete,
          message: 'Account created. You can now log in.',
        });
      } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({ error: getRegisterConflictMessage(error) });
        }
        logger.error({ err: error }, 'Account registration failed');
        return res.status(500).json({ error: 'Account registration failed due to a server error' });
      }
    }),
  );

  router.post(
    '/auth/forgot-username',
    body('email').isEmail().normalizeEmail(),
    async (req, res) => runAsPlatformAdmin(async () => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const email = req.body.email;
      const requestGate = await consumeAuthAttempt('username_request', email, {
        limit: 5,
        windowMs: 15 * 60 * 1000,
        lockMs: 15 * 60 * 1000,
      });
      if (!requestGate.allowed) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.username_request_rate_limited',
          details: JSON.stringify({ retryAfterSec: requestGate.retryAfterSec }),
        });
        return res.status(429).json({
          error: 'Too many username recovery requests. Try again later.',
          retryAfterSec: requestGate.retryAfterSec,
        });
      }

      // Always return the same generic response regardless of whether the
      // account exists, and never put the username itself in the API
      // response — both would let anyone enumerate which emails have
      // accounts (and learn the username directly) just by calling this
      // endpoint. The username only ever goes to the account's own inbox.
      const user = await userModel.findOne({ where: { email } });
      if (user) {
        const username = user.username || user.name;
        if (user.email) {
          await sendEmailNotification(
            user.email,
            'CommandCentre Username Recovery',
            `Your CommandCentre username is: ${username}`,
          ).catch(() => {});
        }
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.username_recovery_sent',
          details: null,
        });
      } else {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.username_recovery_noop',
          details: JSON.stringify({ reason: 'email_not_found' }),
        });
      }

      return res.json({
        ok: true,
        message: 'If an account exists for this email, the username has been sent to it.',
      });
    }),
  );

  router.post(
    '/auth/forgot-password/request',
    body('email').isEmail().normalizeEmail(),
    async (req, res) => runAsPlatformAdmin(async () => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const email = req.body.email;
      const requestGate = await consumeAuthAttempt('reset_request', email, {
        limit: 5,
        windowMs: 15 * 60 * 1000,
        lockMs: 15 * 60 * 1000,
      });
      if (!requestGate.allowed) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_request_rate_limited',
          details: JSON.stringify({ retryAfterSec: requestGate.retryAfterSec }),
        });
        return res.status(429).json({
          error: 'Too many password reset requests. Try again later.',
          retryAfterSec: requestGate.retryAfterSec,
        });
      }

      const user = await userModel.findOne({ where: { email } });
      if (!user) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_request_noop',
          details: JSON.stringify({ reason: 'email_not_found' }),
        });
        return res.json({
          ok: true,
          message: 'If account details were valid, a reset code has been issued.',
        });
      }

      const resetCode = String(randomInt(100000, 1000000));
      const expires = new Date(Date.now() + 15 * 60 * 1000);
      await user.update({
        resetPasswordCode: resetCode,
        resetPasswordCodeExpiresAt: expires,
      });

      if (user.email) {
        await sendEmailNotification(
          user.email,
          'CommandCentre Password Reset Code',
          `Your CommandCentre password reset code is: ${resetCode}. It expires at ${expires.toISOString()}.`,
        ).catch(() => {});
      }

      await writePublicAudit(req, {
        entityType: 'auth_recovery',
        entityId: email,
        action: 'auth.reset_code_issued',
        details: JSON.stringify({ delivery: user.email ? 'email' : 'none' }),
      });

      return res.json({
        ok: true,
        message: 'If account details were valid, a reset code has been issued by email.',
      });
    }),
  );

  router.post(
    '/auth/forgot-password/reset',
    body('email').isEmail().normalizeEmail(),
    body('resetCode').isString().trim().isLength({ min: 4, max: 16 }),
    body('newPassword').isString().isLength({ min: 12, max: 128 }),
    async (req, res) => runAsPlatformAdmin(async () => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const passwordValidation = validatePassword(req.body.newPassword);
      if (!passwordValidation.isValid) {
        return res.status(422).json({ error: passwordValidation.message });
      }

      const email = req.body.email;
      const verifyGate = await consumeAuthAttempt('reset_verify', email, {
        limit: 5,
        windowMs: 15 * 60 * 1000,
        lockMs: 15 * 60 * 1000,
      });
      if (!verifyGate.allowed) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_verify_rate_limited',
          details: JSON.stringify({ retryAfterSec: verifyGate.retryAfterSec }),
        });
        return res.status(429).json({
          error: 'Too many reset verification attempts. Try again later.',
          retryAfterSec: verifyGate.retryAfterSec,
        });
      }

      // Every failure below returns the exact same generic message — email
      // not found, wrong code, and expired code must be indistinguishable
      // to the caller, or this becomes an account-enumeration oracle (an
      // attacker could tell which emails have accounts just from which
      // error comes back). The audit log still records the real reason
      // for operators, via the distinct `action` value.
      const genericResetError = { error: 'Invalid or expired reset code' };

      const user = await userModel.findOne({ where: { email } });
      if (!user) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_invalid_request',
          details: JSON.stringify({ reason: 'email_not_found' }),
        });
        return res.status(400).json(genericResetError);
      }

      if (!user.resetPasswordCode || user.resetPasswordCode !== req.body.resetCode.trim()) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_invalid_code',
          details: null,
        });
        return res.status(400).json(genericResetError);
      }

      if (!user.resetPasswordCodeExpiresAt || new Date(user.resetPasswordCodeExpiresAt).getTime() < Date.now()) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_code_expired',
          details: null,
        });
        return res.status(400).json(genericResetError);
      }

      await user.update({
        password_hash: bcrypt.hashSync(req.body.newPassword, 10),
        resetPasswordCode: null,
        resetPasswordCodeExpiresAt: null,
      });

      await clearAuthAttemptState('reset_verify', email);

      await writePublicAudit(req, {
        entityType: 'auth_recovery',
        entityId: email,
        action: 'auth.reset_success',
        details: null,
      });

      return res.json({ ok: true, message: 'Password reset successful. You can now log in.' });
    }),
  );

  router.post(
    '/token',
    body('username').isString(),
    body('password').isString(),
    body('mfaCode').optional().isString().trim().isLength({ min: 6, max: 8 }),
    async (req, res) => runAsPlatformAdmin(async () => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      const { username, password, mfaCode } = req.body;
      const normalizedUsername = username.trim();
      const normalizedEmail = normalizedUsername.toLowerCase();

      let user = await userModel.findOne({
        where: {
          [Op.or]: [{ username: normalizedUsername }, { name: normalizedUsername }, { email: normalizedEmail }],
        },
      });

      // Fall back to case-insensitive lookup so users can authenticate even when casing varies.
      if (!user && userModel.sequelize) {
        const { fn, col, where } = userModel.sequelize;
        user = await userModel.findOne({
          where: {
            [Op.or]: [
              where(fn('lower', col('username')), normalizedEmail),
              where(fn('lower', col('name')), normalizedEmail),
              where(fn('lower', col('email')), normalizedEmail),
            ],
          },
        });
      }

      // Dev/local resilience: if configured admin credentials are provided but DB is out-of-sync,
      // recreate/repair the admin account transparently during login.
      const isConfiguredAdminAttempt = isConfiguredAdminUsername(normalizedUsername, config)
        && password === config.ADMIN_PASSWORD;
      if (!user && isConfiguredAdminAttempt) {
        const repairedHash = bcrypt.hashSync(config.ADMIN_PASSWORD, 10);
        const [adminUser] = await userModel.findOrCreate({
          where: {
            [Op.or]: [{ username: config.ADMIN_USERNAME }, { name: config.ADMIN_USERNAME }],
          },
          defaults: {
            organizationId: defaultOrganizationId,
            username: config.ADMIN_USERNAME,
            name: config.ADMIN_USERNAME,
            surname: null,
            role: 'admin',
            password_hash: repairedHash,
          },
        });

        await adminUser.update({
          username: config.ADMIN_USERNAME,
          name: config.ADMIN_USERNAME,
          role: 'admin',
          password_hash: repairedHash,
        });

        user = adminUser;
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!user.password_hash) {
        return res.status(401).json({
          error: 'This account has no local password configured. Create an account or use password recovery to set one.',
        });
      }

      if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (user.mfaEnabled) {
        const code = String(mfaCode || '').trim();
        if (!code) {
          return res.status(401).json({ error: 'MFA required', mfaRequired: true });
        }

        const ok = speakeasy.totp.verify({
          secret: user.mfaSecret,
          encoding: 'base32',
          token: code,
          window: 1,
        });

        if (!ok) {
          return res.status(401).json({ error: 'Invalid MFA code', mfaRequired: true });
        }
      }

      const jti = randomUUID();
      const now = new Date();
      const audienceCode = String(user.audienceCode || '').trim().toUpperCase() || null;
      // Behind a reverse proxy, req.ip is the proxy's own address — the same
      // x-forwarded-for resolution already used at /api/me and /api/heartbeat
      // is needed here too, since the unfamiliar-location check below is
      // only as accurate as the IP it's given.
      const loginIp = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip || null;
      await user.update({
        lastLoginAt: now,
        lastLoginIp: loginIp,
        lastSeenAt: now,
        lastSeenIp: loginIp,
        lastSeenUserAgent: String(req.get('user-agent') || '').slice(0, 512) || null,
        isOnline: true,
      });

      // Best-effort and must never block or fail the login itself.
      flagUnfamiliarLogin(user, loginIp).catch((err) => {
        logger.error({ err, userId: user.id }, 'Unfamiliar login location check failed');
      });

      const token = jwt.sign(
        { sub: user.id, organizationId: user.organizationId, username: user.username || user.name, role: user.role, audienceCode, jti },
        config.SECRET_KEY,
        { expiresIn: config.ACCESS_TOKEN_TTL || '15m' },
      );
      const profileState = getProfileCompletionState(user);
      return res.json({
        access_token: token,
        token_type: 'bearer',
        mfaEnabled: Boolean(user.mfaEnabled),
        mustChangePassword: Boolean(user.mustChangePassword),
        profileCompletionRequired: !profileState.isComplete,
        profileCompletionIssues: profileState.issues,
      });
    }),
  );

  // Not gated behind requireCompletedProfile (see app.js) — a user whose
  // account is stuck behind the mustChangePassword 428 must still be able
  // to reach this one endpoint to actually fix it.
  router.post(
    '/auth/change-password',
    authMiddleware,
    body('currentPassword').isString(),
    body('newPassword').isString().isLength({ min: 12, max: 128 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const passwordValidation = validatePassword(req.body.newPassword);
      if (!passwordValidation.isValid) {
        return res.status(422).json({ error: passwordValidation.message });
      }

      const user = await userModel.findByPk(req.user.sub);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (!user.password_hash || !bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      await user.update({
        password_hash: bcrypt.hashSync(req.body.newPassword, 10),
        mustChangePassword: false,
      });

      return res.json({ ok: true, message: 'Password changed successfully.' });
    },
  );

  router.post('/auth/logout', authMiddleware, async (req, res) => {
    const exp = req.user?.exp ? new Date(req.user.exp * 1000) : null;
    await revokeTokenJti(req.user?.jti, exp);
    const user = await userModel.findByPk(req.user.sub);
    if (user) {
      await user.update({
        isOnline: false,
        lastSeenAt: new Date(),
        lastSeenIp: req.ip || null,
        lastSeenUserAgent: String(req.get('user-agent') || '').slice(0, 512) || null,
      });
    }
    return res.json({ ok: true });
  });

  router.get('/auth/mfa/setup', authMiddleware, async (req, res) => {
    const user = await userModel.findByPk(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const issuer = config.MFA_ISSUER || 'CommandCentre';
    const secret = speakeasy.generateSecret({
      name: `${issuer}:${user.username || user.name}`,
      issuer,
    });

    await user.update({ mfaSecret: secret.base32, mfaEnabled: false });
    return res.json({ ok: true, secret: secret.base32, otpauthUrl: secret.otpauth_url, issuer });
  });

  router.post(
    '/auth/mfa/enable',
    authMiddleware,
    body('code').isString().trim().isLength({ min: 6, max: 8 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const user = await userModel.findByPk(req.user.sub);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.mfaSecret) return res.status(400).json({ error: 'MFA setup not initialized' });

      const ok = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: String(req.body.code).trim(),
        window: 1,
      });

      if (!ok) return res.status(400).json({ error: 'Invalid MFA code' });

      await user.update({ mfaEnabled: true });
      return res.json({ ok: true, mfaEnabled: true });
    },
  );

  router.post(
    '/auth/mfa/disable',
    authMiddleware,
    body('code').isString().trim().isLength({ min: 6, max: 8 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const user = await userModel.findByPk(req.user.sub);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.mfaSecret || !user.mfaEnabled) return res.status(400).json({ error: 'MFA is not enabled' });

      const ok = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: String(req.body.code).trim(),
        window: 1,
      });

      if (!ok) return res.status(400).json({ error: 'Invalid MFA code' });

      await user.update({ mfaEnabled: false, mfaSecret: null });
      return res.json({ ok: true, mfaEnabled: false });
    },
  );

  router.get('/auth/sso/config', authMiddleware, (_req, res) => {
    res.json({
      enabled: config.SSO_ENABLED,
      provider: config.SSO_PROVIDER,
      issuer: config.SSO_ISSUER,
      clientIdConfigured: Boolean(config.SSO_CLIENT_ID),
      callbackUrl: config.SSO_CALLBACK_URL,
    });
  });

  return router;
}
