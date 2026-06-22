from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base, DATABASE_URL

# For Postgres only
if DATABASE_URL.startswith("postgres"):
    from pgvector.sqlalchemy import Vector
    from geoalchemy2 import Geometry

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_pro = Column(Boolean, default=False) # Task 3: Monetization
    
    mushrooms = relationship("Mushroom", back_populates="user")

class Mushroom(Base):
    __tablename__ = "mushrooms"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(String(100), unique=True, index=True) # ID from frontend (e.g. m1, m2)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    source = Column(String(20), nullable=False)
    type = Column(String(20), nullable=False)
    time = Column(DateTime(timezone=True), server_default=func.now())
    synced_at = Column(DateTime(timezone=True), server_default=func.now())
    device_id = Column(String(100), index=True) # ID for anonymous tracking
    
    if DATABASE_URL.startswith("postgres"):
        location = Column(Geometry('POINT'))
        embedding = Column(Vector(3))  # 3-dim vector for similarity search
    
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user = relationship("User", back_populates="mushrooms")

class PathPoint(Base):
    __tablename__ = "path_points"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(100), index=True, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    time = Column(DateTime(timezone=True), server_default=func.now())

