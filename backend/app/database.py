# Import SQLAlchemy components for database engine and sessions
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Import settings for database URL
from .config import settings

# Create SQLAlchemy engine with the database URL from settings
engine = create_engine(
    settings.DATABASE_URL,  # Database connection string
    connect_args={"check_same_thread": False},  # Allow multi-threading (for SQLite)
    echo=False,  # Disable SQL query logging
)

# Create sessionmaker for database sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency function to get database session
def get_db():
    # Create a new session
    db = SessionLocal()
    try:
        # Yield the session for use in the request
        yield db
    finally:
        # Ensure the session is closed after use
        db.close()
