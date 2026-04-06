// Import Telegram Bot API
import TelegramBot from 'node-telegram-bot-api';
// Import configuration
import { CONFIG } from './config.js';

// Create the bot only when a token is configured so startup does not fail in environments without Telegram.
export const bot = CONFIG.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false })
  : null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to send a message via Telegram bot
export async function sendTelegramMessage(chatId, text, options = {}) {
  if (!bot || !chatId) return false;

  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  const sendOptions = { ...options };
  delete sendOptions.retries;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await bot.sendMessage(chatId, text, sendOptions);
      return true;
    } catch (error) {
      const finalAttempt = attempt >= retries;
      console.error(`Telegram delivery failed for chat ${chatId} on attempt ${attempt + 1}:`, error?.message || error);
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
