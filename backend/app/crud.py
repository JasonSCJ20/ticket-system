# Import SQLAlchemy session for database operations
from sqlalchemy.orm import Session

# Import local models and schemas
from . import models, schemas

# Function to get a user by their Telegram ID
def get_user_by_telegram_id(db: Session, telegram_id: int):
    # Query the User table filtering by telegram_id and return the first match
    return db.query(models.User).filter(models.User.telegram_id == telegram_id).first()

# Function to get a user by their ID
def get_user(db: Session, user_id: int):
    # Query the User table filtering by id and return the first match
    return db.query(models.User).filter(models.User.id == user_id).first()

# Function to get a list of users with pagination
def get_users(db: Session, skip: int = 0, limit: int = 100):
    # Query all users, skip the first 'skip' records, limit to 'limit' records
    return db.query(models.User).offset(skip).limit(limit).all()

# Function to create a new user
def create_user(db: Session, user: schemas.UserCreate, password_hash: str = None):
    # Create a new User model instance with provided data
    db_user = models.User(name=user.name, telegram_id=user.telegram_id, role=user.role)
    # If password hash provided, set it
    if password_hash:
        db_user.password_hash = password_hash
    # Add the user to the session
    db.add(db_user)
    # Commit the transaction
    db.commit()
    # Refresh the user object with database-generated values
    db.refresh(db_user)
    # Return the created user
    return db_user

# Function to get a ticket by its ID
def get_ticket(db: Session, ticket_id: int):
    # Query the Ticket table filtering by id and return the first match
    return db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()

# Function to get a list of tickets with pagination
def get_tickets(db: Session, skip: int = 0, limit: int = 100):
    # Query all tickets, skip the first 'skip' records, limit to 'limit' records
    return db.query(models.Ticket).offset(skip).limit(limit).all()

# Function to create a new ticket
def create_ticket(db: Session, ticket: schemas.TicketCreate):
    # Create a new Ticket model instance with provided data, default status to open
    db_ticket = models.Ticket(
        title=ticket.title,
        description=ticket.description,
        priority=ticket.priority,
        status=models.TicketStatus.open,
        assignee_id=ticket.assignee_id,
        creator_id=ticket.creator_id,
    )
    # Add the ticket to the session
    db.add(db_ticket)
    # Commit the transaction
    db.commit()
    # Refresh the ticket object with database-generated values
    db.refresh(db_ticket)
    # Return the created ticket
    return db_ticket

# Function to update an existing ticket
def update_ticket(db: Session, db_ticket: models.Ticket, ticket_update: schemas.TicketUpdate):
    # Iterate over the fields in the update schema that are set
    for field, value in ticket_update.dict(exclude_unset=True).items():
        # Set the attribute on the ticket object
        setattr(db_ticket, field, value)

    # Add the updated ticket to the session
    db.add(db_ticket)
    # Commit the transaction
    db.commit()
    # Refresh the ticket object
    db.refresh(db_ticket)
    # Return the updated ticket
    return db_ticket

# Function to add a history entry for a ticket
def add_ticket_history(db: Session, ticket_id: int, event_type: str, reason: str):
    # Create a new TicketHistory instance
    history = models.TicketHistory(ticket_id=ticket_id, event_type=event_type, reason=reason)
    # Add to session
    db.add(history)
    # Commit
    db.commit()
    # Refresh
    db.refresh(history)
    # Return the history entry
    return history

# Function to get the history of a ticket
def get_ticket_history(db: Session, ticket_id: int):
    # Query TicketHistory for the given ticket_id, ordered by creation time descending
    return db.query(models.TicketHistory).filter(models.TicketHistory.ticket_id == ticket_id).order_by(models.TicketHistory.created_at.desc()).all()
