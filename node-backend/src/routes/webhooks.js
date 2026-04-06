import express from 'express';

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
}) {
  const router = express.Router();

  router.post('/telegram', async (req, res) => {
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
  });

  return router;
}
