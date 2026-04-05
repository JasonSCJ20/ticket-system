# Import datetime and timedelta for token expiration handling
from datetime import UTC, datetime, timedelta
# Import Optional for type hints
from typing import Optional

# Import FastAPI components for authentication and dependencies
try:
    from fastapi import Depends, HTTPException, status
    # Import OAuth2 scheme for token-based auth
    from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
except ModuleNotFoundError:  # pragma: no cover
    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str, headers: Optional[dict] = None):
            self.status_code = status_code
            self.detail = detail
            self.headers = headers or {}
            super().__init__(detail)

    class _Status:
        HTTP_401_UNAUTHORIZED = 401

    status = _Status()

    def Depends(dependency=None):
        return dependency

    class OAuth2PasswordBearer:
        def __init__(self, tokenUrl: str):
            self.tokenUrl = tokenUrl

    class OAuth2PasswordRequestForm:
        pass
# Import JWT functions for encoding/decoding tokens
from jose import JWTError, jwt
# Import password hashing context
from passlib.context import CryptContext
# Import SQLAlchemy session
from sqlalchemy.orm import Session

# Import local modules: CRUD operations, models, config, database
from . import crud, models
from .config import settings
from .database import get_db

# Create password context using bcrypt for secure hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# Define OAuth2 scheme for token extraction from requests
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")

# JWT algorithm to use
ALGORITHM = "HS256"
# Default token expiration time in minutes
ACCESS_TOKEN_EXPIRE_MINUTES = 60


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

# Function to verify a plain password against its hash
def verify_password(plain_password, hashed_password):
    # Use the password context to verify the password
    return pwd_context.verify(plain_password, hashed_password)

# Function to hash a plain password
def get_password_hash(password):
    # Use the password context to hash the password
    return pwd_context.hash(password)

# Function to authenticate a user via Telegram ID, username, or password
def authenticate_user(db: Session, telegram_id: Optional[int] = None, username: Optional[str] = None, password: str = ""):
    # Initialize user variable
    user = None
    # Try to find user by Telegram ID if provided
    if telegram_id is not None:
        user = crud.get_user_by_telegram_id(db, telegram_id)
    # If not found and username provided, find by username
    if not user and username is not None:
        user = db.query(models.User).filter(models.User.name == username).first()

    # If user not found, no password hash, or password doesn't match, return None
    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        return None
    # Return the authenticated user
    return user

# Function to create a JWT access token
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    # Copy the data to encode
    to_encode = data.copy()
    # Set expiration time: now + delta or default 60 minutes
    expire = _utcnow_naive() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    # Add expiration to the payload
    to_encode.update({"exp": expire})
    # Encode and return the JWT token
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)

# Dependency to get the current authenticated user from token
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    # Define exception for invalid credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Decode the JWT token
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        # Extract user ID from payload and coerce to int
        user_id_raw = payload.get("sub")
        # If no user ID, raise exception
        if user_id_raw is None:
            raise credentials_exception
        user_id = int(user_id_raw)
    except JWTError:
        # If JWT decoding fails, raise exception
        raise credentials_exception
    except (TypeError, ValueError):
        # If subject is missing/invalid, treat as invalid credentials
        raise credentials_exception
    # Fetch user from database
    user = crud.get_user(db, user_id)
    # If user not found, raise exception
    if user is None:
        raise credentials_exception
    # Return the user
    return user

# Function to create a role-based access control dependency
def require_role(required_role: str):
    # Define the inner dependency function
    def role_checker(current_user: models.User = Depends(get_current_user)):
        # Check if user has required role or is admin
        if current_user.role != required_role and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        # Return the user if authorized
        return current_user
    # Return the dependency function
    return role_checker
