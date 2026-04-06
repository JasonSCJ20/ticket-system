import express from 'express';
import { isValidScjId, validatePassword } from '../utils.js';

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
            [Op.or]: [{ username }, { email }, { scjId }],
          },
        });
        if (existing) return res.status(409).json({ error: 'Name and surname, email, or SCJ ID already exists' });

        const passwordHash = bcrypt.hashSync(req.body.password, 10);
        const created = await userModel.create({
          username,
          name,
          surname,
          department: null,
          jobTitle: 'Security Analyst',
          scjId,
          email,
          role: 'analyst',
          password_hash: passwordHash,
        });

        return res.status(201).json({
          id: created.id,
          username: created.username,
          name: created.name,
          surname: created.surname,
          scjId: created.scjId,
          email: created.email,
          role: created.role,
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

      if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
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

      const token = jwt.sign(
        { sub: user.id, username: user.username || user.name, role: user.role, jti },
        config.SECRET_KEY,
        { expiresIn: config.ACCESS_TOKEN_TTL || '15m' },
      );
      return res.json({ access_token: token, token_type: 'bearer', mfaEnabled: Boolean(user.mfaEnabled) });
    },
  );

  router.post('/auth/logout', authMiddleware, async (req, res) => {
    const exp = req.user?.exp ? new Date(req.user.exp * 1000) : null;
    await revokeTokenJti(req.user?.jti, exp);
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
