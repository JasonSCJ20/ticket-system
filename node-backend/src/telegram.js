// Import configuration
import { CONFIG } from './config.js';
import { logger } from './logger.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Talks to the Telegram Bot API directly over fetch. The only endpoint this
// app ever calls is sendMessage (inbound webhook updates are read as plain
// JSON in routes/webhooks.js, no SDK involved there either), so a client
// library's dependency chain isn't earning its keep here — same
// zero-dependency approach @commandcentre/agent already uses.
export async function sendTelegramMessage(chatId, text, options = {}) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !chatId) return false;

  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  const sendOptions = { ...options };
  delete sendOptions.retries;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...sendOptions }),
      });
      const data = await res.json().catch(() => ({}));
      // Telegram can return HTTP 200 with { ok: false, description } on
      // some failures, so both the transport status and the body matter.
      if (res.ok && data.ok) return true;
      throw new Error(data.description || `Telegram API returned HTTP ${res.status}`);
    } catch (error) {
      const finalAttempt = attempt >= retries;
      logger.error({ err: error, chatId, attempt: attempt + 1 }, 'Telegram delivery failed');
      if (finalAttempt) return false;
      await delay(750 * (attempt + 1));
    }
  }

  return false;
}

// Function to format ticket information as text
export function ticketText(ticket) {
  // Return formatted Markdown text with ticket details
  return `*Ticket #${ticket.id}*\nTitle: ${ticket.title}\nDescription: ${ticket.description}\nPriority: ${ticket.priority}\nStatus: ${ticket.status}`;
}
