# Import FastAPI components for routing and dependencies
from fastapi import APIRouter, Depends, HTTPException

# Import local modules: CRUD operations
from .. import crud
# Import database session getter
from ..database import get_db
# Import ticket creation schema
from ..schemas import TicketCreate
# Import notification function
from ..notifications import notify_assignee_ticket_created
# Import SQLAlchemy session
from sqlalchemy.orm import Session

# Create router for Snort integration endpoints
router = APIRouter(prefix="/integrations/snort", tags=["snort"])

# Endpoint to handle Snort alerts and create tickets
@router.post("/alert")
def snort_alert(payload: dict, db: Session = Depends(get_db)):
    # Validate payload is not empty
    if not payload:
        raise HTTPException(status_code=400, detail="Empty payload")

    # Extract fields from payload with defaults
    title = payload.get("signature", "Snort alert")
    description = payload.get("description", "No description")
    priority = payload.get("priority", "high")
    assignee_id = payload.get("assignee_id")

    # Create ticket schema instance
    ticket_in = TicketCreate(
        title=title,
        description=description,
        priority=priority,
        assignee_id=assignee_id,
    )

    # Create the ticket in database
    ticket = crud.create_ticket(db, ticket_in)
    # Add history entry for Snort alert
    crud.add_ticket_history(db, ticket.id, "snort_alert", "Created from Snort alert")
    # Notify assignee
    notify_assignee_ticket_created(db, ticket)

    # Return success response with ticket ID
    return {"detail": "ticket created", "ticket_id": ticket.id}
