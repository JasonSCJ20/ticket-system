import express from 'express';
import { isValidScjId, validatePassword } from '../utils.js';
import {
  AUDIENCE_CODE_LABELS,
  derivePrimaryDepartment,
  getProfileCompletionState,
  isOperationalStaffAudience,
  normalizeOperationalTeams,
} from '../services/userProfile.js';

const NHNE_EMAIL_DOMAIN = '@nhne.org.za';
const SCJ_ID_EXAMPLE = '00000000-00000';

function normalizePersonName(value = '') {
  return value.trim().replace(/\s+/g, ' ');
}

function buildUsername(name, surname) {
  return `${normalizePersonName(name)} ${normalizePersonName(surname)}`.trim();
}

function isNhneEmail(email = '') {
  return email.trim().toLowerCase().endsWith(NHNE_EMAIL_DOMAIN);
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
    async (req, res) => {
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

      if (!isNhneEmail(email)) {
        return res.status(422).json({ error: 'Email address must use the @nhne.org.za domain' });
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
        console.error('Account registration failed:', error?.message || error);
        return res.status(500).json({ error: 'Account registration failed due to a server error' });
      }
    },
  );

  router.post(
    '/auth/forgot-username',
    body('email').isEmail().normalizeEmail(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const user = await userModel.findOne({ where: { email: req.body.email } });
      return res.json({
        ok: true,
        message: 'If an account exists for this email, username recovery details were generated.',
        username: user?.username || user?.name || null,
      });
    },
  );

  router.post(
    '/auth/forgot-password/request',
    body('email').isEmail().normalizeEmail(),
    async (req, res) => {
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
          'CCC Password Reset Code',
          `Your Cybersecurity Command Centre password reset code is: ${resetCode}. It expires at ${expires.toISOString()}.`,
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
    },
  );

  router.post(
    '/auth/forgot-password/reset',
    body('email').isEmail().normalizeEmail(),
    body('resetCode').isString().trim().isLength({ min: 4, max: 16 }),
    body('newPassword').isString().isLength({ min: 12, max: 128 }),
    async (req, res) => {
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

      const user = await userModel.findOne({ where: { email } });
      if (!user) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_invalid_request',
          details: JSON.stringify({ reason: 'email_not_found' }),
        });
        return res.status(400).json({ error: 'Invalid reset request' });
      }

      if (!user.resetPasswordCode || user.resetPasswordCode !== req.body.resetCode.trim()) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_invalid_code',
          details: null,
        });
        return res.status(400).json({ error: 'Invalid reset code' });
      }

      if (!user.resetPasswordCodeExpiresAt || new Date(user.resetPasswordCodeExpiresAt).getTime() < Date.now()) {
        await writePublicAudit(req, {
          entityType: 'auth_recovery',
          entityId: email,
          action: 'auth.reset_code_expired',
          details: null,
        });
        return res.status(400).json({ error: 'Reset code expired' });
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
    },
  );

  router.post(
    '/token',
    body('username').isString(),
    body('password').isString(),
    body('mfaCode').optional().isString().trim().isLength({ min: 6, max: 8 }),
    async (req, res) => {
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
      await user.update({
        lastLoginAt: now,
        lastLoginIp: req.ip || null,
        lastSeenAt: now,
        lastSeenIp: req.ip || null,
        lastSeenUserAgent: String(req.get('user-agent') || '').slice(0, 512) || null,
        isOnline: true,
      });

      const token = jwt.sign(
        { sub: user.id, username: user.username || user.name, role: user.role, audienceCode, jti },
        config.SECRET_KEY,
        { expiresIn: config.ACCESS_TOKEN_TTL || '15m' },
      );
      const profileState = getProfileCompletionState(user);
      return res.json({
        access_token: token,
        token_type: 'bearer',
        mfaEnabled: Boolean(user.mfaEnabled),
        profileCompletionRequired: !profileState.isComplete,
        profileCompletionIssues: profileState.issues,
      });
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

    const issuer = config.MFA_ISSUER || 'Cybersecurity Command Centre';
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
