# Import datetime for timestamps
from contextlib import asynccontextmanager
from datetime import UTC, datetime
# Import FastAPI components for building the API
from fastapi import Depends, FastAPI, HTTPException, Request
# Import CORS middleware for cross-origin requests
from fastapi.middleware.cors import CORSMiddleware
# Import OAuth2 form for login
from fastapi.security import OAuth2PasswordRequestForm
# Import SQLAlchemy session
from sqlalchemy.orm import Session
# Import background scheduler for periodic tasks
from apscheduler.schedulers.background import BackgroundScheduler
# Import SSE for server-sent events
from sse_starlette.sse import EventSourceResponse
# Import response for HTTP responses
from starlette.responses import Response
# Import security functions for sanitization
from .security import sanitize_text, sanitize_payload

# Import local modules: CRUD, models, schemas
from . import crud, models, schemas
# Import auth functions: authentication, token creation, user retrieval, password hashing, role checking
from .auth import (authenticate_user, create_access_token, get_current_user, get_password_hash, require_role)
# Import bot function for Telegram messaging
from .bot import send_telegram_message
# Import settings from config
from .config import settings
# Import database engine and session getter
from .database import engine, get_db
# Import notification functions
from .notifications import notify_assignee_ticket_created, notify_ticket_update
# Import report function
from .reports import send_monthly_report
# Import integrations (Snort router)
from .integrations import snort


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Import session local for background tasks
    from .database import SessionLocal

    # Define the monthly report job
    def report_job():
        # Create DB session and send report
        with SessionLocal() as db:
            send_monthly_report(db)

    # Create background scheduler
    scheduler = BackgroundScheduler(timezone="UTC")
    # Add job to run monthly on the 1st at 9 AM
    scheduler.add_job(report_job, "cron", day=1, hour=9)
    # Start the scheduler
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)

# Create FastAPI app instance with title
app = FastAPI(title="Cybersecurity Ticketing System", lifespan=lifespan)

# Add CORS middleware to allow requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Frontend URL
    allow_credentials=True,  # Allow cookies/auth headers
    allow_methods=["GET", "POST", "PATCH"],  # Allowed HTTP methods
    allow_headers=["Authorization", "Content-Type"],  # Allowed headers
)

# Custom middleware for rate limiting and security headers
@app.middleware("http")
async def rate_limit_and_security_headers(request: Request, call_next):
    # Get client IP address
    client_ip = request.client.host if request.client else 'unknown'
    # Get current timestamp
    now = int(datetime.now(UTC).timestamp())
    # Get or initialize request counter for this IP
    window_start, count = request_counters.get(client_ip, (now, 0))
    # Check if within rate limit window
    if now - window_start < RATE_LIMIT_WINDOW:
        # If exceeded max requests, return 429
        if count >= RATE_LIMIT_MAX:
            raise HTTPException(status_code=429, detail="Too many requests")
        # Increment counter
        request_counters[client_ip] = (window_start, count + 1)
    else:
        # Reset counter for new window
        request_counters[client_ip] = (now, 1)

    # Call next middleware/handler
    response: Response = await call_next(request)
    # Add security headers to response
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return response

# Include Snort integration router
app.include_router(snort.router)

# Create all database tables
models.Base.metadata.create_all(bind=engine)

# In-memory storage for Telegram conversation states (wizard flow)
telegram_conversations = {}

# Simple in-memory rate limiting counters (IP-based)
request_counters = {}
# Rate limit window in seconds
RATE_LIMIT_WINDOW = 60
# Max requests per window
RATE_LIMIT_MAX = 60

# Telegram webhook endpoint for bot interactions
@app.post(settings.TELEGRAM_WEBHOOK_PATH)
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    # Parse incoming JSON data
    data = await request.json()
    # Extract message (new or edited)
    message = data.get("message") or data.get("edited_message")
    # If no message, return OK
    if not message:
        return {"ok": True}

    # Get chat ID and sanitize text
    chat_id = message["chat"]["id"]
    text = sanitize_text(message.get("text", "")).strip()
    # Get user info
    from_user = message.get("from")
    telegram_user_id = from_user.get("id")

    # Find or create user
    user = crud.get_user_by_telegram_id(db, telegram_user_id)
    if not user:
        user = crud.create_user(db, schemas.UserCreate(name=from_user.get("first_name", "Unknown"), telegram_id=telegram_user_id))

    # Get current conversation state
    state = telegram_conversations.get(telegram_user_id, {"step": None, "ticket": {}})

    # Handle /newticket command
    if text.startswith("/newticket"):
        # Initialize state for new ticket creation
        state = {"step": "title", "ticket": {"creator_id": user.id}}
        telegram_conversations[telegram_user_id] = state
        send_telegram_message(chat_id, "Please enter ticket title:")
        return {"ok": True}

    # Handle title step
    if state.get("step") == "title":
        # Store sanitized title and move to description
        state["ticket"]["title"] = sanitize_text(text)
        state["step"] = "description"
        telegram_conversations[telegram_user_id] = state
        send_telegram_message(chat_id, "OK. Enter ticket description:")
        return {"ok": True}

    # Handle description step
    if state.get("step") == "description":
        # Store sanitized description and move to priority
        state["ticket"]["description"] = sanitize_text(text)
        state["step"] = "priority"
        telegram_conversations[telegram_user_id] = state
        send_telegram_message(chat_id, "What is the priority? (low/medium/high/critical)")
        return {"ok": True}

    # Handle priority step
    if state.get("step") == "priority":
        # Validate priority value
        priority_value = text.lower()
        if priority_value not in ["low", "medium", "high", "critical"]:
            send_telegram_message(chat_id, "Invalid priority, choose low, medium, high, or critical.")
            return {"ok": True}

        # Store priority and move to assignee
        state["ticket"]["priority"] = priority_value
        state["step"] = "assignee"
        telegram_conversations[telegram_user_id] = state
        send_telegram_message(chat_id, "Enter assignee Telegram ID (numeric) or name:")
        return {"ok": True}

    # Handle assignee step
    if state.get("step") == "assignee":
        # Parse assignee identifier
        identifier = text.strip()
        assignee = None

        # Try to find by Telegram ID if numeric
        if identifier.isdigit():
            assignee = crud.get_user_by_telegram_id(db, int(identifier))
        # Try to find by name
        if not assignee:
            found = db.query(models.User).filter(models.User.name == identifier).first()
            if found:
                assignee = found

        # Create new user if not found
        if not assignee:
            assignee = crud.create_user(db, schemas.UserCreate(name=identifier))

        # Set assignee and create ticket
        state["ticket"]["assignee_id"] = assignee.id
        ticket_in = schemas.TicketCreate(**state["ticket"])
        ticket = crud.create_ticket(db, ticket_in)
        # Add history and notify
        crud.add_ticket_history(db, ticket.id, "created", "Created through Telegram bot")
        notify_assignee_ticket_created(db, ticket)

        # Send confirmation and clear state
        send_telegram_message(chat_id, f"Ticket #{ticket.id} created and assigned to {assignee.name}.")
        telegram_conversations.pop(telegram_user_id, None)
        return {"ok": True}

    # Unknown command
    send_telegram_message(chat_id, "Unknown command. Use /newticket to start a new cybersecurity ticket.")
    return {"ok": True}

# Login endpoint to get access token
@app.post('/api/token', response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Authenticate user with username/password
    user = authenticate_user(db, username=form_data.username, password=form_data.password)
    # If invalid, raise 401
    if not user:
        raise HTTPException(status_code=401, detail='Invalid credentials', headers={'WWW-Authenticate': 'Bearer'})
    # Create and return access token
    access_token = create_access_token(data={'sub': str(user.id)})
    return {'access_token': access_token, 'token_type': 'bearer'}

# Create user endpoint (admin only)
@app.post('/api/users', response_model=schemas.UserRead, dependencies=[Depends(require_role('admin'))])
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # Hash password if provided
    hashed = None
    if user.password:
        hashed = get_password_hash(user.password)
    # Create and return user
    return crud.create_user(db, user, password_hash=hashed)

# List users endpoint (admin only)
@app.get('/api/users', response_model=list[schemas.UserRead], dependencies=[Depends(require_role('admin'))])
def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    # Return paginated list of users
    return crud.get_users(db, skip=skip, limit=limit)

# List tickets endpoint (authenticated users)
@app.get('/api/tickets', response_model=list[schemas.TicketRead], dependencies=[Depends(get_current_user)])
def list_tickets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    # Return paginated list of tickets
    return crud.get_tickets(db, skip=skip, limit=limit)

# Create ticket endpoint (authenticated users)
@app.post('/api/tickets', response_model=schemas.TicketRead, dependencies=[Depends(get_current_user)])
def create_ticket(ticket: schemas.TicketCreate, db: Session = Depends(get_db)):
    # Create ticket
    db_ticket = crud.create_ticket(db, ticket)
    # Add history and notify
    crud.add_ticket_history(db, db_ticket.id, "created", "Created by API")
    notify_assignee_ticket_created(db, db_ticket)
    # Return created ticket
    return db_ticket

# Update ticket endpoint (authenticated users)
@app.patch('/api/tickets/{ticket_id}', response_model=schemas.TicketRead, dependencies=[Depends(get_current_user)])
def update_ticket(ticket_id: int, ticket_update: schemas.TicketUpdate, db: Session = Depends(get_db)):
    # Get existing ticket
    db_ticket = crud.get_ticket(db, ticket_id)
    # If not found, 404
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Update ticket
    updated = crud.update_ticket(db, db_ticket, ticket_update)
    # Add history and notify
    crud.add_ticket_history(db, ticket_id, "updated", "Updated by API")
    notify_ticket_update(db, updated, "API user")
    # Return updated ticket
    return updated

# Get ticket history endpoint
@app.get("/api/tickets/{ticket_id}/history", response_model=list[schemas.TicketHistoryRead])
def ticket_history(ticket_id: int, db: Session = Depends(get_db)):
    # Return history for the ticket
    return crud.get_ticket_history(db, ticket_id)

# Monthly report endpoint
@app.get("/api/reports/monthly")
def monthly_report(db: Session = Depends(get_db)):
    # Import and return monthly summary
    from .reports import get_monthly_summary
    return get_monthly_summary(db)

# SSE stream for real-time ticket updates
@app.get("/api/stream/tickets")
def stream_tickets():
    # Generator for keep-alive events
    async def event_generator():
        while True:
            yield {"event": "ping", "data": "keep-alive"}

    # Return SSE response
    return EventSourceResponse(event_generator())
