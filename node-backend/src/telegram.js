// Import Telegram Bot API
import TelegramBot from 'node-telegram-bot-api';
// Import configuration
import { CONFIG } from './config.js';

// Initialize Telegram bot with token from config, disable polling
export const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false });

// Function to send a message via Telegram bot
export function sendTelegramMessage(chatId, text, options = {}) {
  // Skip if no bot token configured
  if (!CONFIG.TELEGRAM_BOT_TOKEN) return;
  // Send message and catch any errors
  bot.sendMessage(chatId, text, options).catch(console.error);
}

// Function to format ticket information as text
export function ticketText(ticket) {
  // Return formatted Markdown text with ticket details
  return `*Ticket #${ticket.id}*\nTitle: ${ticket.title}\nDescription: ${ticket.description}\nPriority: ${ticket.priority}\nStatus: ${ticket.status}`;
}
