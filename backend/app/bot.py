# Import logging for error handling
import logging

# Import Telegram Bot API components
from telegram import Bot
from telegram.error import TelegramError

# Import settings for bot token
from .config import settings

# Get logger for this module
logger = logging.getLogger(__name__)

# Initialize Telegram bot only if token is provided
bot = None
if settings.TELEGRAM_BOT_TOKEN:
    try:
        bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    except Exception as e:
        logger.error("Failed to initialize Telegram bot: %s", e)
else:
    logger.warning("TELEGRAM_BOT_TOKEN not set. Telegram features will be disabled.")

# Function to send a message via Telegram bot
def send_telegram_message(chat_id: int, text: str, parse_mode: str = "Markdown"):
    if bot is None:
        logger.warning("Telegram bot not initialized. Skipping message send.")
        return
    try:
        # Send message to the specified chat ID with optional parse mode
        bot.send_message(chat_id=chat_id, text=text, parse_mode=parse_mode)
    except TelegramError as e:
        # Log error if sending fails
        logger.error("Telegram send_message failed: %s", e)

# Function to build formatted text for a ticket
def build_ticket_text(ticket):
    # Return formatted Markdown text with ticket details
    return (
        f"*Ticket #{ticket.id}*\n"
        f"*Title:* {ticket.title}\n"
        f"*Description:* {ticket.description}\n"
        f"*Priority:* {ticket.priority}\n"
        f"*Status:* {ticket.status}\n"
        f"*Assignee:* {ticket.assignee.name if ticket.assignee else 'Unassigned'}\n"
    )
