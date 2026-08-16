import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { CONFIG } from '../config.js';
import { runWithOrganization } from '../services/tenantContext.js';

// Same constant-time comparison already used for the Wazuh/Suricata
// connector webhooks (see routes/securityConnectors.js) — a plain !== would
// leak timing information about how many leading bytes matched.
function hasValidTelegramSecret(receivedHeader, expectedSecret) {
  if (!expectedSecret) return false;
  const received = Buffer.from(String(receivedHeader || ''), 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

export default function webhooksRouteFactory({
  sanitizeString,
  findOrCreateUser,
  telegramConversations,
  sendTelegramMessage,
  ticketModel,
  userModel,
  ticketHistoryModel,
  notify,
  notificationLedgerModel,
  defaultOrganizationId,
  logger,
}) {
  const router = express.Router();

  // This endpoint used to accept every request completely unauthenticated —
  // no secret-token check, no rate limit — despite creating real user
  // accounts and driving real ticket creation via the /newticket
  // conversation below. TELEGRAM_WEBHOOK_SECRET is optional only so
  // deploying this fix can't itself take the live bot down before the
  // secret is registered with Telegram's own setWebhook call; once it's
  // configured, every request is verified. Rate limiting applies either way.
  const telegramWebhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: CONFIG.TELEGRAM_WEBHOOK_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/telegram', telegramWebhookLimiter, async (req, res) => {
    if (CONFIG.TELEGRAM_WEBHOOK_SECRET) {
      const provided = req.header('x-telegram-bot-api-secret-token');
      if (!hasValidTelegramSecret(provided, CONFIG.TELEGRAM_WEBHOOK_SECRET)) {
        return res.status(401).json({ ok: false, message: 'Invalid webhook secret' });
      }
    } else {
      logger?.warn('Telegram webhook received with no TELEGRAM_WEBHOOK_SECRET configured — request accepted unauthenticated.');
    }

    // This route has no user session to derive an organization from (it's
    // driven by Telegram, not a logged-in browser) — every tenant-scoped
    // model touched below (User/Ticket/TicketHistory) requires a real
    // established tenant context or it throws, so the whole handler runs
    // inside the platform's own default organization, same as other
    // pre-auth/no-session flows (see writePublicAudit's use of
    // defaultOrganizationId in routes/auth.js).
    return runWithOrganization(defaultOrganizationId, () => handleTelegramUpdate(req, res));
  });

  async function handleTelegramUpdate(req, res) {
    const message = req.body.message || req.body.edited_message;
    if (!message) return res.json({ ok: true });

    const chatId = message.chat.id;
    let text = (message.text || '').trim();
    try {
      text = sanitizeString(text);
    } catch (_err) {
      return res.status(400).json({ ok: false, message: 'Invalid text input' });
    }

    const from = message.from;
    const [user] = await findOrCreateUser(from);
    const now = new Date();
    await user.update({
      lastSeenAt: now,
      lastSeenIp: req.ip || null,
      lastSeenUserAgent: 'telegram-webhook',
      isOnline: true,
      lastTelegramReadAt: now,
      lastTelegramDeliveryStatus: 'read',
    }).catch(() => {});

    // Mark the most recent unread delivered ledger entry for this user as read
    if (notificationLedgerModel) {
      const latest = await notificationLedgerModel.findOne({
        where: { userId: user.id, status: 'delivered', readAt: null },
        order: [['createdAt', 'DESC']],
      }).catch(() => null);
      if (latest) await latest.update({ status: 'read', readAt: now }).catch(() => {});
    }

    const state = telegramConversations.get(from.id) || { step: null, ticket: { creatorId: user.id } };

    if (text.startsWith('/newticket')) {
      state.step = 'title';
      state.ticket = { creatorId: user.id };
      telegramConversations.set(from.id, state);
      sendTelegramMessage(chatId, 'Please enter ticket title:');
      return res.json({ ok: true });
    }

    if (state.step === 'title') {
      state.ticket.title = text;
      state.step = 'description';
      telegramConversations.set(from.id, state);
      sendTelegramMessage(chatId, 'Enter ticket description:');
      return res.json({ ok: true });
    }

    if (state.step === 'description') {
      state.ticket.description = text;
      state.step = 'priority';
      telegramConversations.set(from.id, state);
      sendTelegramMessage(chatId, 'Priority? low/medium/high/critical');
      return res.json({ ok: true });
    }

    if (state.step === 'priority') {
      const priority = text.toLowerCase();
      if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
        sendTelegramMessage(chatId, 'Invalid priority. Use low, medium, high, critical');
        return res.json({ ok: true });
      }
      state.ticket.priority = priority;
      state.step = 'assignee';
      telegramConversations.set(from.id, state);
      sendTelegramMessage(chatId, 'Assignee Telegram ID or name:');
      return res.json({ ok: true });
    }

    if (state.step === 'assignee') {
      let assignee = null;
      const safeContext = sanitizeString(text);
      if (!Number.isNaN(Number(safeContext))) {
        assignee = await userModel.findOne({ where: { telegramId: Number(safeContext) } });
      }
      if (!assignee) {
        assignee = await userModel.findOne({ where: { name: safeContext } });
      }
      if (!assignee) {
        assignee = await userModel.create({ name: safeContext });
      }

      state.ticket.assigneeId = assignee.scjId || null;
      const ticket = await ticketModel.create(state.ticket);
      await ticketHistoryModel.create({ ticketId: ticket.id, eventType: 'created', reason: 'Telegram newticket' });
      await notify(ticket, 'created');

      sendTelegramMessage(chatId, `Ticket #${ticket.id} created and assigned to ${assignee.name}`);
      telegramConversations.delete(from.id);
      return res.json({ ok: true });
    }

    sendTelegramMessage(chatId, 'Unknown command. Use /newticket to create incident ticket.');
    return res.json({ ok: true });
  }

  return router;
}
