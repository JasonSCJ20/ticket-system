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

// Export factory function that takes models as parameter
export default (models) => {
  // Destructure User model
  const { User } = models;
  const adminOnly = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };

  // GET /api/users - List all users
  router.get('/', async (req, res) => {
    // Fetch all users from database
    const users = await User.findAll();
    // Return users as JSON
    res.json(users);
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
        // Return created user with 201 status
        res.status(201).json(user);
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
