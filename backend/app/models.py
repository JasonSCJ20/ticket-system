# Import necessary modules for datetime handling, enums, and SQLAlchemy ORM
from datetime import UTC, datetime  # For handling timestamps
from enum import Enum  # For defining fixed sets of values

# Import SQLAlchemy components for defining database tables and relationships
from sqlalchemy import Column, DateTime, Enum as SqlEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import declarative_base, relationship

# Create a base class for all database models; this is required for SQLAlchemy ORM
Base = declarative_base()


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

# Define an enum for ticket priorities; this ensures only valid values are used
class TicketPriority(str, Enum):
    low = "low"  # Lowest priority level
    medium = "medium"  # Medium priority level
    high = "high"  # High priority level
    critical = "critical"  # Highest priority level, requires immediate attention

# Define an enum for ticket statuses; tracks the lifecycle of a ticket
class TicketStatus(str, Enum):
    open = "open"  # Ticket is newly created and not yet worked on
    in_progress = "in_progress"  # Ticket is being actively worked on
    resolved = "resolved"  # Issue has been fixed, awaiting confirmation
    closed = "closed"  # Ticket is fully resolved and closed

# Define the User model/table; represents users in the system
class User(Base):
    __tablename__ = "users"  # Name of the database table

    # Primary key for the user; auto-increments for each new user
    id = Column(Integer, primary_key=True, index=True)
    # Telegram ID for linking to Telegram accounts; unique and nullable for non-Telegram users
    telegram_id = Column(Integer, unique=True, nullable=True, index=True)
    # User's name; indexed for faster searches
    name = Column(String(255), index=True)
    # User's role in the system; defaults to 'analyst'
    role = Column(String(255), default="analyst")
    # Hashed password for authentication; nullable for Telegram-only users
    password_hash = Column(String(255), nullable=True)

    # Relationship to notification settings; one-to-one
    notification_setting = relationship("NotificationSetting", back_populates="user", uselist=False)
    # Relationship to tickets assigned to this user; one-to-many
    tickets_assigned = relationship("Ticket", foreign_keys="Ticket.assignee_id", back_populates="assignee")

# Define the NotificationSetting model/table; stores user notification preferences
class NotificationSetting(Base):
    __tablename__ = "notification_settings"  # Name of the database table

    # Primary key for notification settings
    id = Column(Integer, primary_key=True, index=True)
    # Foreign key linking to the user; ensures referential integrity
    user_id = Column(Integer, ForeignKey("users.id"))
    # Boolean-like field for Telegram notifications; defaults to enabled (1)
    via_telegram = Column(Integer, default=1)

    # Back-reference to the user; allows navigation from settings to user
    user = relationship("User", back_populates="notification_setting")

# Define the Ticket model/table; represents cybersecurity tickets
class Ticket(Base):
    __tablename__ = "tickets"  # Name of the database table

    # Primary key for the ticket; auto-increments
    id = Column(Integer, primary_key=True, index=True)
    # Title of the ticket; limited to 512 characters
    title = Column(String(512), nullable=False)
    # Detailed description; uses Text for longer content
    description = Column(Text, nullable=False)
    # Priority level; uses enum for validation
    priority = Column(SqlEnum(TicketPriority), nullable=False, default=TicketPriority.medium)
    # Current status; uses enum for validation
    status = Column(SqlEnum(TicketStatus), nullable=False, default=TicketStatus.open)
    # Timestamp for creation; auto-set to current time
    created_at = Column(DateTime, default=_utcnow_naive)
    # Timestamp for last update; auto-updates on changes
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    # Foreign key to the assigned user; nullable if unassigned
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Foreign key to the creator user; nullable for anonymous creation
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Back-reference to the assignee user; allows navigation from ticket to user
    assignee = relationship("User", foreign_keys=[assignee_id], back_populates="tickets_assigned")

# Define the TicketHistory model/table; logs changes to tickets
class TicketHistory(Base):
    __tablename__ = "ticket_history"  # Name of the database table

    # Primary key for history entries
    id = Column(Integer, primary_key=True, index=True)
    # Foreign key to the related ticket
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    # Type of event (e.g., 'created', 'updated')
    event_type = Column(String(255))
    # Reason or details of the change
    reason = Column(Text)
    # Timestamp of the event; auto-set
    created_at = Column(DateTime, default=_utcnow_naive)
