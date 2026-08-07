import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { body, param, validationResult } from 'express-validator';
import { runAsPlatformAdmin, runWithOrganization } from '../services/tenantContext.js';
import { encryptAssetCredential } from '../services/assetSecrets.js';

// Real, cryptographically-random temp password, guaranteed to satisfy
// validatePassword's rules (12+ chars, upper/lower/digit/special) rather
// than relying on chance — one required character from each class, the
// rest random, then shuffled with crypto randomness so the required
// characters aren't always in the same first four positions.
function generateTempPassword() {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = lower + upper + digits + special;
  const pick = (set) => set[crypto.randomInt(set.length)];

  const chars = [pick(lower), pick(upper), pick(digits), pick(special)];
  for (let i = 0; i < 12; i += 1) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Platform-level organization management — for Scratch Solid Solutions
// staff onboarding a new customer, not for any customer's own use. Kept
// deliberately narrow: a platform_admin can create organizations and issue
// their first admin account, nothing more — they get no standing access to
// any customer's operational data (tenant scoping still applies to
// everything else they do under their own organizationId).
export default function platformRouteFactory({ models, authMiddleware, sendEmailNotification }) {
  const { Organization, User, SecurityState } = models;
  const router = express.Router();

  const platformAdminOnly = (req, res, next) => {
    if (req.user?.role === 'platform_admin') return next();
    return res.status(403).json({ error: 'Platform admin access required' });
  };

  router.post(
    '/organizations',
    authMiddleware,
    platformAdminOnly,
    body('name').isString().trim().isLength({ min: 2, max: 255 }),
    body('slug').isString().trim().isLength({ min: 2, max: 64 }).matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, numbers, and hyphens only'),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const existing = await runAsPlatformAdmin(() => Organization.findOne({ where: { slug: req.body.slug } }));
      if (existing) return res.status(409).json({ error: 'An organization with this slug already exists' });

      const org = await runAsPlatformAdmin(() => Organization.create({ name: req.body.name, slug: req.body.slug }));

      // Provision the one per-org singleton resource this platform has
      // today. fortressKillSwitch.js's getState() also self-heals via
      // findOrCreate, so this isn't strictly load-bearing — but doing it
      // explicitly at organization-creation time is the honest, intended
      // provisioning point, not a fallback.
      await runWithOrganization(org.id, () => SecurityState.findOrCreate({ where: {}, defaults: {} }));

      return res.status(201).json({ id: org.id, name: org.name, slug: org.slug, plan: org.plan, status: org.status });
    },
  );

  router.get('/organizations', authMiddleware, platformAdminOnly, async (_req, res) => {
    const organizations = await runAsPlatformAdmin(() => Organization.findAll({ order: [['name', 'ASC']] }));
    const withCounts = await Promise.all(organizations.map(async (org) => {
      const userCount = await runWithOrganization(org.id, () => User.count());
      return { id: org.id, name: org.name, slug: org.slug, plan: org.plan, status: org.status, userCount };
    }));
    return res.json(withCounts);
  });

  router.post(
    '/organizations/:id/admins',
    authMiddleware,
    platformAdminOnly,
    param('id').isInt(),
    body('name').isString().trim().isLength({ min: 2, max: 255 }),
    body('surname').isString().trim().isLength({ min: 2, max: 255 }),
    body('email').isEmail().normalizeEmail(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const org = await runAsPlatformAdmin(() => Organization.findByPk(req.params.id));
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const name = req.body.name.trim();
      const surname = req.body.surname.trim();
      const username = `${name} ${surname}`.trim();
      const tempPassword = generateTempPassword();

      let created;
      try {
        created = await runWithOrganization(org.id, () => User.create({
          username,
          name,
          surname,
          email: req.body.email,
          role: 'admin',
          audienceCode: 'TJN',
          password_hash: bcrypt.hashSync(tempPassword, 10),
          mustChangePassword: true,
        }));
      } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({ error: 'A user with this name or email already exists' });
        }
        throw error;
      }

      // Best-effort — if email delivery fails, the account still exists;
      // an operator can always issue a password reset separately. Never
      // let a delivery failure make the account creation itself fail.
      await sendEmailNotification(
        req.body.email,
        `Your CommandCentre account for ${org.name}`,
        `An administrator account has been created for you at ${org.name} on CommandCentre.\n\n`
        + `Username: ${username}\nTemporary password: ${tempPassword}\n\n`
        + 'You will be required to set a new password the first time you log in.',
      ).catch(() => {});

      return res.status(201).json({ id: created.id, username, email: created.email, organizationId: org.id });
    },
  );

  // Issues (or rotates) this organization's own connector secret, used to
  // authenticate its Wazuh/Suricata/Prometheus feeds instead of the single
  // global CONFIG.CONNECTOR_SHARED_SECRET every tenant used to share — see
  // routes/securityConnectors.js's resolveConnectorSecret. Shown once, same
  // pattern as agent-key issuance: the server only ever stores it encrypted.
  router.post(
    '/organizations/:id/connector-secret',
    authMiddleware,
    platformAdminOnly,
    param('id').isInt(),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const org = await runAsPlatformAdmin(() => Organization.findByPk(req.params.id));
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const rawSecret = crypto.randomBytes(32).toString('hex');
      await org.update({ connectorSecret: encryptAssetCredential(rawSecret) });

      return res.status(201).json({
        connectorSecret: rawSecret,
        header: 'x-connector-org',
        organizationSlug: org.slug,
        warning: 'This secret will not be shown again. Store it securely — send it with every connector request as x-connector-secret, alongside x-connector-org: ' + org.slug + '.',
      });
    },
  );

  return router;
}
