// Import Express router
import express from 'express';
// Import validation middleware
import { body, validationResult } from 'express-validator';

// Create router instance
const router = express.Router();

const SCJ_ID_REGEX = /^\d{8}-\d{5}$/;
const DEFAULT_IT_STAFF = [
  {
    name: 'Alicia',
    surname: 'Brown',
    department: 'Networks',
    jobTitle: 'Security Analyst',
    telegramNumber: '100000001',
    email: 'alicia.brown@scj.local',
    scjId: '00361031-00803',
    role: 'analyst',
  },
  {
    name: 'Martin',
    surname: 'Khan',
    department: 'Dev',
    jobTitle: 'Software Developer',
    telegramNumber: '100000002',
    email: 'martin.khan@scj.local',
    scjId: '00361031-00804',
    role: 'analyst',
  },
  {
    name: 'Sophie',
    surname: 'Naidoo',
    department: 'Hardware',
    jobTitle: 'Systems Engineer',
    telegramNumber: '100000003',
    email: 'sophie.naidoo@scj.local',
    scjId: '00361031-00805',
    role: 'analyst',
  },
];

// Fields safe to expose to API clients. Excludes credential/secret-bearing
// columns such as password_hash, mfaSecret, resetPasswordCode, and
// resetPasswordCodeExpiresAt (mirrors the explicit-allowlist pattern used
// for user-facing responses in src/routes/auth.js).
const toSafeUser = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  surname: user.surname,
  department: user.department,
  operationalTeams: user.operationalTeams,
  audienceCode: user.audienceCode,
  jobTitle: user.jobTitle,
  scjId: user.scjId,
  email: user.email,
  telegramNumber: user.telegramNumber,
  telegramChatId: user.telegramChatId,
  telegramId: user.telegramId,
  role: user.role,
  mfaEnabled: user.mfaEnabled,
  notifyTelegram: user.notifyTelegram,
  notifyEmail: user.notifyEmail,
  lastLoginAt: user.lastLoginAt,
  lastLoginIp: user.lastLoginIp,
  lastSeenAt: user.lastSeenAt,
  lastSeenIp: user.lastSeenIp,
  lastSeenUserAgent: user.lastSeenUserAgent,
  isOnline: user.isOnline,
  lastTelegramDeliveryAt: user.lastTelegramDeliveryAt,
  lastTelegramDeliveryStatus: user.lastTelegramDeliveryStatus,
  lastTelegramReadAt: user.lastTelegramReadAt,
  lastSeenGeo: user.lastSeenGeo,
});

// Export factory function that takes models as parameter
export default (models) => {
  // Destructure User model
  const { User, AuditLog } = models;
  const adminOnly = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };

  // The team roster is internal staff data — an asset owner has no
  // legitimate reason to see it, so this whole router is analyst/admin only.
  router.use((req, res, next) => {
    if (req.user?.role === 'admin' || req.user?.role === 'analyst') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  });

  // GET /api/users - List all users
  router.get('/', async (req, res) => {
    // Fetch all users from database
    const users = await User.findAll();
    // Return users as JSON, excluding credential/secret fields
    res.json(users.map(toSafeUser));
  });

  // POST /api/users - Create IT staff with strict registration fields
  router.post('/',
    adminOnly,
    // Validate name: string, trimmed, length 2-255, escaped
    body('name').isString().trim().isLength({ min: 2, max: 255 }).escape(),
    // Validate surname: required string
    body('surname').isString().trim().isLength({ min: 2, max: 255 }).escape(),
    // Validate department: required enum
    body('department').isIn(['Networks', 'Dev', 'Hardware']),
    // Validate job title
    body('jobTitle').optional().isString().trim().isLength({ min: 2, max: 128 }).escape(),
    // Validate telegram number as a digit string (chat id format)
    body('telegramNumber').isString().trim().matches(/^\d{5,32}$/),
    // Validate email
    body('email').isEmail().normalizeEmail(),
    // Validate SCJ ID strict format
    body('scjId').isString().trim().matches(SCJ_ID_REGEX),
    // Validate role: optional string, trimmed, length 3-64, escaped
    body('role').optional().isString().trim().isLength({ min: 3, max: 64 }).escape(),
    async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      // Prepare user data
      const data = {
        name: req.body.name,
        surname: req.body.surname,
        department: req.body.department,
        jobTitle: req.body.jobTitle || 'Security Analyst',
        telegramNumber: req.body.telegramNumber,
        telegramId: Number(req.body.telegramNumber),
        email: req.body.email,
        scjId: req.body.scjId,
        role: req.body.role || 'analyst', // Default role
      };

      // Create user in database
      try {
        const user = await User.create(data);

        // An admin creating another account — worth logging on its own,
        // and especially so since this endpoint can assign any role,
        // including admin itself.
        await AuditLog.create({
          entityType: 'user',
          entityId: String(user.id),
          actor: req.user?.username || 'unknown',
          actorRole: req.user?.role || null,
          action: 'user.created_by_admin',
          ipAddress: req.ip,
          details: JSON.stringify({ email: data.email, role: data.role, department: data.department }),
        });

        // Return created user with 201 status, excluding credential/secret fields
        res.status(201).json(toSafeUser(user));
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({ error: 'User with same email, telegram number, or SCJ ID already exists' });
        }
        throw err;
      }
    }
  );

  // POST /api/users/preload - Upsert predefined IT staff list
  router.post('/preload', adminOnly, async (_req, res) => {
    const created = [];
    const skipped = [];

    for (const candidate of DEFAULT_IT_STAFF) {
      const existing = await User.findOne({ where: { scjId: candidate.scjId } });
      if (existing) {
        skipped.push(candidate.scjId);
        continue;
      }
      const user = await User.create({
        ...candidate,
        telegramId: Number(candidate.telegramNumber),
      });
      created.push(user.scjId);
    }

    return res.status(200).json({ created, skipped, total: DEFAULT_IT_STAFF.length });
  });

  // Return configured router
  return router;
};
