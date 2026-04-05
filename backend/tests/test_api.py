from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import uuid

from app.main import app
from app.auth import get_password_hash
from app.database import get_db
from app.models import Base, User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)


def _auth_headers() -> dict:
    db = TestingSessionLocal()
    try:
        username = f"admin_{uuid.uuid4().hex[:8]}"
        user = User(name=username, role="admin", password_hash=get_password_hash("password123"))
        db.add(user)
        db.commit()

        response = client.post(
            "/api/token",
            data={"username": username, "password": "password123"},
        )
        assert response.status_code == 200
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    finally:
        db.close()

def test_create_user():
    headers = _auth_headers()
    response = client.post(
        "/api/users",
        json={"name": f"testuser_{uuid.uuid4().hex[:6]}", "role": "analyst"},
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "analyst"

def test_list_tickets():
    headers = _auth_headers()
    response = client.get("/api/tickets", headers=headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_create_ticket():
    headers = _auth_headers()
    response = client.post(
        "/api/tickets",
        json={
            "title": "Test Ticket",
            "description": "This is a test ticket",
            "priority": "high",
        },
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Test Ticket"
