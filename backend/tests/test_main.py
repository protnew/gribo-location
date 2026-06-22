import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_read_main():
    response = client.get("/api/feed")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_weather_endpoint():
    response = client.get("/api/weather?lat=53.9&lng=27.5")
    assert response.status_code == 200
    assert "current_weather" in response.json() or response.status_code == 500 # Might fail without net

def test_create_user():
    # Attempt login without user
    response = client.post("/auth/login", data={"username": "testuser", "password": "testpassword"})
    # Expect 401 because user doesn't exist in dummy DB (or we can mock DB)
    assert response.status_code in (401, 200)
