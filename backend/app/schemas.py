# Import datetime for timestamp handling
from datetime import datetime
# Import Enum for defining fixed sets of values
from enum import Enum
# Import typing for optional types
from typing import Optional

# Import Pydantic components for data validation and serialization
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Define an enum for ticket priorities; mirrors the database enum
class TicketPriority(str, Enum):
    low = "low"  # Lowest priority
    medium = "medium"  # Medium priority
    high = "high"  # High priority
    critical = "critical"  # Critical priority

# Define an enum for ticket statuses; mirrors the database enum
class TicketStatus(str, Enum):
    open = "open"  # Ticket is open
    in_progress = "in_progress"  # Ticket is being worked on
    resolved = "resolved"  # Issue is resolved
    closed = "closed"  # Ticket is closed

# Base schema for User; defines common fields
class UserBase(BaseModel):
    # User's name with length constraints and sanitization
    name: str = Field(..., min_length=2, max_length=255)
    # Optional Telegram ID for linking accounts
    telegram_id: Optional[int] = None
    # User's role with default and length constraints
    role: Optional[str] = Field('analyst', min_length=3, max_length=64)

    # Validator to sanitize the name field
    @field_validator('name')
    def sanitize_name(cls, value: str) -> str:
        # Import the sanitize function from security module
        from .security import sanitize_text
        # Clean the input to prevent XSS
        cleaned = sanitize_text(value)
        # Ensure the cleaned value is not empty
        if not cleaned:
            raise ValueError('name must not be empty')
        return cleaned

# Schema for creating a new user; extends UserBase
class UserCreate(UserBase):
    # Optional password with minimum length
    password: Optional[str] = Field(None, min_length=8)

    # Validator for password field
    @field_validator('password')
    def sanitize_password(cls, value: Optional[str]) -> Optional[str]:
        # If no password provided, return None
        if value is None:
            return None
        # Check minimum length
        if len(value) < 8:
            raise ValueError('password must be at least 8 characters')
        return value

# Schema for JWT token response
class Token(BaseModel):
    # The access token string
    access_token: str
    # Type of token (usually "bearer")
    token_type: str

# Schema for token data (used in JWT payload)
class TokenData(BaseModel):
    # Optional username from token
    username: Optional[str] = None

# Schema for reading user data; includes ID
class UserRead(UserBase):
    # User's unique ID
    id: int

    # Configuration to allow ORM mode (convert SQLAlchemy objects to Pydantic)
    model_config = ConfigDict(from_attributes=True)

# Base schema for Ticket; defines common fields
class TicketBase(BaseModel):
    # Ticket title with length constraints
    title: str = Field(..., max_length=512, min_length=5)
    # Ticket description with length constraints
    description: str = Field(..., min_length=10, max_length=2000)
    # Priority with default value
    priority: TicketPriority = TicketPriority.medium

    # Validator for title and description fields
    @field_validator('title', 'description')
    def sanitize_strings(cls, value: str) -> str:
        # Import sanitize function
        from .security import sanitize_text
        # Clean the input
        cleaned = sanitize_text(value)
        # Ensure not empty after sanitization
        if not cleaned:
            raise ValueError('Input must not be empty after sanitization')
        return cleaned

# Schema for creating a new ticket; extends TicketBase
class TicketCreate(TicketBase):
    # Optional assignee ID
    assignee_id: Optional[int] = None
    # Optional creator ID
    creator_id: Optional[int] = None

    # Validator for assignee_id
    @field_validator('assignee_id', mode='before')
    def check_assignee_type(cls, value):
        # If None, return as is
        if value is None:
            return value
        # Ensure it's an integer
        if not isinstance(value, int):
            raise ValueError('assignee_id must be an integer')
        return value

# Schema for updating a ticket; all fields optional
class TicketUpdate(BaseModel):
    # Optional title update
    title: Optional[str] = None
    # Optional description update
    description: Optional[str] = None
    # Optional priority update
    priority: Optional[TicketPriority] = None
    # Optional status update
    status: Optional[TicketStatus] = None
    # Optional assignee update
    assignee_id: Optional[int] = None

# Schema for reading ticket data; includes all fields
class TicketRead(TicketBase):
    # Ticket ID
    id: int
    # Current status
    status: TicketStatus
    # Creation timestamp
    created_at: datetime
    # Last update timestamp
    updated_at: datetime
    # Assignee ID (optional)
    assignee_id: Optional[int]
    # Creator ID (optional)
    creator_id: Optional[int]

    # Configuration for ORM mode
    model_config = ConfigDict(from_attributes=True)

# Schema for reading ticket history
class TicketHistoryRead(BaseModel):
    # ID of the related ticket
    ticket_id: int
    # Type of event (e.g., created, updated)
    event_type: str
    # Reason for the change
    reason: str
    # Timestamp of the event
    created_at: datetime

    # Configuration for ORM mode
    model_config = ConfigDict(from_attributes=True)

# Base schema for notification settings
class NotificationSettingBase(BaseModel):
    # User ID this setting belongs to
    user_id: int
    # Whether to send notifications via Telegram (default true)
    via_telegram: bool = True

# Schema for reading notification settings; includes ID
class NotificationSettingRead(NotificationSettingBase):
    # Setting ID
    id: int

    # Configuration for ORM mode
    model_config = ConfigDict(from_attributes=True)
