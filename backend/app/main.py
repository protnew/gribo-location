from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
import requests
from typing import List, Optional
from pydantic import BaseModel

from app import models, database, auth, bot, ml_service
from app.database import engine

# Create tables for dev (in prod we use alembic)
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="GriboLocation API", version="3.3.0")

# Task 6: Rate Limiting & Security
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import redis
import json
import os

try:
    redis_client = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    redis_client.ping()
except Exception:
    redis_client = None

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For dev, restrict in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class MushroomCreate(BaseModel):
    client_id: str
    lat: float
    lng: float
    source: str
    type: str
    time: str

@app.post("/auth/register", response_model=Token)
def register(user: UserCreate, db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_pw = auth.get_password_hash(user.password)
    new_user = models.User(username=user.username, hashed_password=hashed_pw)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = auth.create_access_token(
        data={"sub": new_user.username},
        expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/auth/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}

class SyncPayload(BaseModel):
    device_id: str
    mushrooms: List[MushroomCreate]
    path: List[dict] = [] # list of {lat, lng, time}

@app.post("/api/sync")
def sync_data(payload: SyncPayload, db: Session = Depends(database.get_db)):
    synced_ids = []
    
    # Process mushrooms
    for m in payload.mushrooms:
        exists = db.query(models.Mushroom).filter(models.Mushroom.client_id == m.client_id).first()
        if not exists:
            new_m = models.Mushroom(
                client_id=m.client_id,
                lat=m.lat,
                lng=m.lng,
                source=m.source,
                type=m.type,
                device_id=payload.device_id
            )
            if database.DATABASE_URL.startswith("postgres"):
                new_m.location = f'POINT({m.lng} {m.lat})'
            db.add(new_m)
            synced_ids.append(m.client_id)
            
    # Process path
    for p in payload.path:
        # Avoid duplicate path points (simplified, in reality you'd want a better unique key)
        new_p = models.PathPoint(
            device_id=payload.device_id,
            lat=p.get('lat', 0),
            lng=p.get('lng', 0)
        )
        db.add(new_p)

    db.commit()
    return {"status": "ok", "synced": synced_ids}

@app.get("/api/admin/all_mushrooms")
def get_all_mushrooms(db: Session = Depends(database.get_db)):
    # Task 8: Admin panel endpoint
    # In production, require password/auth
    mushrooms = db.query(models.Mushroom).all()
    paths = db.query(models.PathPoint).all()
    
    res_mush = [{"lat": m.lat, "lng": m.lng, "type": m.type, "device_id": m.device_id} for m in mushrooms]
    res_paths = [{"lat": p.lat, "lng": p.lng, "device_id": p.device_id} for p in paths]
    
    return {"mushrooms": res_mush, "paths": res_paths}

@app.get("/api/leaderboard")
def get_leaderboard(db: Session = Depends(database.get_db)):
    from sqlalchemy import func
    results = db.query(models.User.username, func.count(models.Mushroom.id).label('total'))\
        .join(models.Mushroom)\
        .group_by(models.User.username)\
        .order_by(func.count(models.Mushroom.id).desc())\
        .limit(10).all()
    
    return [{"username": r[0], "mushrooms": r[1]} for r in results]

class Telemetry(BaseModel):
    sensor_id: str
    soil_moisture: float
    lat: float
    lng: float

@app.post("/api/telemetry")
def receive_telemetry(data: Telemetry, db: Session = Depends(database.get_db)):
    # Task 8: IoT Dashboard endpoint
    prob = ml_service.predict_mushroom_probability(data.lat, data.lng, data.soil_moisture)
    return {"status": "received", "mushroom_probability": prob}

@app.get("/api/weather")
@limiter.limit("30/minute") # Task 6
def get_weather(request: Request, lat: float, lng: float):
    # Task 4: Weather API Integration (Open-Meteo)
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current_weather=true"
        r = requests.get(url)
        return r.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Weather API error")

@app.get("/api/achievements")
@limiter.limit("60/minute") # Task 6
def get_achievements(request: Request, client_id: str, db: Session = Depends(database.get_db)):
    # Task 6: Server-side achievements calculation
    count = db.query(models.Mushroom).count()
    # Simple logic based on count
    achievements = []
    if count >= 1: achievements.append("ach0")
    if count >= 10: achievements.append("ach1")
    if count >= 100: achievements.append("ach3")
    return {"achievements": achievements}

@app.delete("/api/admin/mushrooms/{mushroom_id}")
@limiter.limit("10/minute") # Task 6
def delete_mushroom_admin(request: Request, mushroom_id: int, current_user: models.User = Depends(auth.get_current_user), db: Session = Depends(database.get_db)):
    # Task 10: Admin Panel (moderation)
    if current_user.username != "admin":
        raise HTTPException(status_code=403, detail="Not an admin")
    m = db.query(models.Mushroom).filter(models.Mushroom.id == mushroom_id).first()
    if m:
        db.delete(m)
        db.commit()
    return {"status": "deleted"}

auth.add_oauth_routes(app)
from app.upload import add_upload_route
add_upload_route(app)

# Task 3: Geo-fence Radius Endpoint
@app.get("/api/mushrooms/nearby")
def get_nearby_mushrooms(lat: float, lng: float, radius_km: float = 5.0, db: Session = Depends(database.get_db)):
    if database.DATABASE_URL.startswith("postgres"):
        from sqlalchemy import func
        # ST_DWithin arguments: geometry, geometry, distance in meters (if using Geography type) or degrees (if Geometry)
        # Using cast to Geography to measure in meters
        from geoalchemy2.elements import WKTElement
        point = WKTElement(f'POINT({lng} {lat})', srid=4326)
        results = db.query(models.Mushroom).filter(
            func.ST_DWithin(func.cast(models.Mushroom.location, database.Geography), func.cast(point, database.Geography), radius_km * 1000)
        ).all()
    else:
        # Simple bounding box for MVP
        deg_offset = radius_km / 111.0
        results = db.query(models.Mushroom).filter(
            models.Mushroom.lat >= lat - deg_offset,
            models.Mushroom.lat <= lat + deg_offset,
            models.Mushroom.lng >= lng - deg_offset,
            models.Mushroom.lng <= lng + deg_offset
        ).all()
    return results

# Task 5: AI Path Prediction (Phase 11)
class PathPredictRequest(BaseModel):
    lat: float
    lng: float
    radius_km: float = 5.0

@app.post("/api/path/predict")
def predict_path(req: PathPredictRequest, db: Session = Depends(database.get_db)):
    """
    Returns an optimized path hitting the areas with the highest mushroom probability 
    (mocked using nearest neighbor for now).
    """
    if database.DATABASE_URL.startswith("postgres"):
        from sqlalchemy import func
        from geoalchemy2.elements import WKTElement
        point = WKTElement(f'POINT({req.lng} {req.lat})', srid=4326)
        results = db.query(models.Mushroom).filter(
            func.ST_DWithin(func.cast(models.Mushroom.location, database.Geography), func.cast(point, database.Geography), req.radius_km * 1000)
        ).limit(10).all()
    else:
        deg_offset = req.radius_km / 111.0
        results = db.query(models.Mushroom).filter(
            models.Mushroom.lat >= req.lat - deg_offset,
            models.Mushroom.lat <= req.lat + deg_offset,
            models.Mushroom.lng >= req.lng - deg_offset,
            models.Mushroom.lng <= req.lng + deg_offset
        ).limit(10).all()
    
    if not results:
        return {"path": []}

    # Sort nearest neighbor
    path = []
    current = (req.lat, req.lng)
    unvisited = [{"id": r.id, "lat": r.lat, "lng": r.lng} for r in results]
    
    while unvisited:
        nearest = min(unvisited, key=lambda x: (x["lat"] - current[0])**2 + (x["lng"] - current[1])**2)
        path.append({"lat": nearest["lat"], "lng": nearest["lng"], "type": "predicted_hotspot"})
        current = (nearest["lat"], nearest["lng"])
        unvisited.remove(nearest)
        
    return {"path": path}

# Task 7: Social Feed (with Redis caching & Rate limiting)
@app.get("/api/feed")
@limiter.limit("60/minute") # Task 6
def get_social_feed(request: Request, db: Session = Depends(database.get_db)):
    if redis_client:
        try:
            cached = redis_client.get("social_feed")
            if cached:
                return json.loads(cached)
        except:
            pass

    results = db.query(models.Mushroom, models.User.username)\
        .join(models.User, isouter=True)\
        .order_by(models.Mushroom.time.desc())\
        .limit(50).all()
        
    data = []
    for r in results:
        upvotes = 0
        if redis_client:
            try:
                upvotes = int(redis_client.get(f"upvotes:{r[0].id}") or 0)
            except: pass
            
        data.append({
            "mushroom": {
                "id": r[0].id, "client_id": r[0].client_id, "lat": r[0].lat, "lng": r[0].lng,
                "type": r[0].type, "time": r[0].time.isoformat() if r[0].time else None,
                "upvotes": upvotes
            },
            "username": r[1] or "Аноним"
        })
    if redis_client:
        try:
            redis_client.setex("social_feed", 10, json.dumps(data))
        except:
            pass
    return data

@app.post("/api/feed/upvote/{mushroom_id}")
@limiter.limit("30/minute")
def upvote_mushroom(request: Request, mushroom_id: int):
    if not redis_client:
        return {"status": "error", "message": "Redis not available"}
    # For Phase 12 MVP, simple increment without checking if user already voted
    new_score = redis_client.incr(f"upvotes:{mushroom_id}")
    redis_client.delete("social_feed") # invalidate cache
    return {"status": "ok", "upvotes": new_score}

# Task 5: WebSocket Live-Radar
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/radar")
async def websocket_radar(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast user location to others
            await manager.broadcast(data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
