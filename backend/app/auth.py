import os
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User

# Zero Hardcode: Get secrets from environment
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev_secret_key_change_me_in_prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days for MVP convenience

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

def add_oauth_routes(app):
    # Task 1: OAuth2 SSO Stub
    @app.get("/auth/google/login")
    def google_login():
        return {"url": "https://accounts.google.com/o/oauth2/auth?client_id=...&redirect_uri=..."}
        
    @app.get("/auth/google/callback")
    def google_callback(code: str):
        # exchange code for token, create user
        return {"access_token": "mock_google_jwt_token", "token_type": "bearer"}

    # Task 3: Monetization (PRO-account) Stub
    class PaymentData(BaseModel):
        token: str
    
    @app.post("/api/billing/upgrade")
    def upgrade_to_pro(data: PaymentData, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        # Call Stripe / Telegram Stars API
        if data.token == "success_mock":
            current_user.is_pro = True
            db.commit()
            return {"status": "success", "message": "Welcome to PRO!"}
        raise HTTPException(status_code=400, detail="Payment failed")
