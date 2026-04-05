# Import SQLAlchemy session
from sqlalchemy.orm import Session

# Import local modules: CRUD, models
from . import crud, models
# Import bot functions for sending messages and building text
from .bot import send_telegram_message, build_ticket_text

# Function to notify assignee when a new ticket is created and assigned
def notify_assignee_ticket_created(db: Session, ticket: models.Ticket):
    # If no assignee, do nothing
    if not ticket.assignee:
        return

    # Build notification text
    text = "A new ticket has been assigned to you:\n" + build_ticket_text(ticket)
    # Check if assignee has Telegram notifications enabled
    if ticket.assignee.notification_setting and ticket.assignee.notification_setting.via_telegram:
        # If assignee has Telegram ID, send message
        if ticket.assignee.telegram_id:
            send_telegram_message(ticket.assignee.telegram_id, text)

# Function to notify assignee when a ticket is updated
def notify_ticket_update(db: Session, ticket: models.Ticket, changer_text: str):
    # Build notification text with changer info
    text = f"Ticket updated by {changer_text}:\n" + build_ticket_text(ticket)
    # Check if assignee has Telegram notifications enabled
    if ticket.assignee and ticket.assignee.notification_setting and ticket.assignee.notification_setting.via_telegram:
        # If assignee has Telegram ID, send message
        if ticket.assignee.telegram_id:
            send_telegram_message(ticket.assignee.telegram_id, text)
