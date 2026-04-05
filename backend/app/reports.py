# Import datetime and timedelta for date calculations
from datetime import datetime, timedelta

# Import SQLAlchemy session
from sqlalchemy.orm import Session

# Import local modules: models, CRUD
from . import models, crud
# Import bot function for sending messages
from .bot import send_telegram_message
# Import settings for chat ID
from .config import settings

# Function to get monthly ticket summary
def get_monthly_summary(db: Session):
    # Get current time and time 30 days ago
    now = datetime.utcnow()
    month_ago = now - timedelta(days=30)

    # Count total tickets
    total = db.query(models.Ticket).count()
    # Count tickets created in last 30 days
    created = db.query(models.Ticket).filter(models.Ticket.created_at >= month_ago).count()
    # Count closed tickets
    closed = db.query(models.Ticket).filter(models.Ticket.status == models.TicketStatus.closed).count()

    # Return summary dictionary
    return {
        "total_tickets": total,
        "created_last_30d": created,
        "closed_total": closed,
        "month_window_days": 30,
    }

# Function to send monthly report via Telegram
def send_monthly_report(db: Session):
    # Get summary data
    summary = get_monthly_summary(db)
    # Build report text in Markdown
    text = (
        "*Monthly Cybersecurity Ticket Report*\n"
        f"Total tickets: {summary['total_tickets']}\n"
        f"Created last 30 days: {summary['created_last_30d']}\n"
        f"Closed total: {summary['closed_total']}\n"
    )
    # If chat ID is set, send the message
    if settings.MONTHLY_REPORT_CHAT_ID:
        send_telegram_message(settings.MONTHLY_REPORT_CHAT_ID, text)
