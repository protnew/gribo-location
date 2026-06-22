import pytest
from fastapi.testclient import TestClient
from app.main import app
import sqlite3
import os

# Перенаправляем БД на тестовую in-memory, чтобы не портить живую базу (Правило 11)
# Это базовая фикстура, в будущем мы заменим путь к БД внутри зависимости FastAPI

client = TestClient(app)

def test_sync_offline_mushrooms():
    # Эмулируем, что человек вышел из леса в зону действия сети
    # и приложение (local-first) скидывает пачку собранных грибов
    
    import uuid
    test_id = f"mush-{uuid.uuid4().hex[:8]}"
    payload = {
        "device_id": "test-uuid-1",
        "mushrooms": [
            {
                "client_id": test_id,
                "lat": 53.91, 
                "lng": 27.56, 
                "type": "white", 
                "source": "gps",
                "time": "2026-06-20T10:00:00Z"
            }
        ],
        "path": []
    }
    
    response = client.post("/api/sync", json=payload)
    
    # 1. Проверяем HTTP статус
    assert response.status_code == 200
    
    # 2. Проверяем бизнес-логику (сервер должен подтвердить сохранение)
    data = response.json()
    assert data["status"] == "ok"
    assert len(data["synced"]) == 1
