"""
TEJAS Authentication — Phase 2
Real bcrypt password hashing + real HS256 JWT tokens.
No mock passwords, no fake token strings.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, SessionLocal
from app.models.models import User
from app.schemas.schemas import Token, UserResponse

logger = logging.getLogger("tejas.auth")

router = APIRouter(prefix="/auth", tags=["Authentication"])

import bcrypt

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except Exception:
        return False

def hash_password(plain: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(plain.encode("utf-8")[:72], salt).decode("utf-8")


# ──────────────────────────────────────────────
# JWT helpers
# ──────────────────────────────────────────────
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username, User.is_active == True).first()


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = get_user_by_username(db, username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Dependency: returns the current authenticated user, or None if unauthenticated."""
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    username: str = payload.get("sub")
    if not username:
        return None
    return get_user_by_username(db, username)


def require_user(current_user: Optional[User] = Depends(get_current_user)) -> User:
    """Dependency: raises 401 if not authenticated."""
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


# ──────────────────────────────────────────────
# Seed default users on startup if DB is empty
# ──────────────────────────────────────────────
def seed_default_users():
    """
    Creates default users if missing in the users table.
    Passwords come from environment or fall back to standard development defaults.
    """
    import os
    db = SessionLocal()
    try:
        defaults = [
            {
                "username": os.getenv("ADMIN_USERNAME", "admin"),
                "hashed_password": hash_password(os.getenv("ADMIN_PASSWORD", "tejas_admin_2026")),
                "role": "ADMIN",
                "full_name": "System Administrator",
                "is_active": True,
            },
            {
                "username": os.getenv("OPERATOR_USERNAME", "operator"),
                "hashed_password": hash_password(os.getenv("OPERATOR_PASSWORD", "tejas_op_2026")),
                "role": "OPERATOR",
                "full_name": "Duty Operator",
                "is_active": True,
            },
            {
                "username": "operator.rawat",
                "hashed_password": hash_password(os.getenv("OPERATOR_RAWAT_PASSWORD", "tejas_op_2026")),
                "role": "OPERATOR",
                "full_name": "Sub-Inspector Rawat",
                "is_active": True,
            },
            {
                "username": os.getenv("VIEWER_USERNAME", "viewer"),
                "hashed_password": hash_password(os.getenv("VIEWER_PASSWORD", "tejas_viewer_2026")),
                "role": "VIEWER",
                "full_name": "Duty Observer",
                "is_active": True,
            },
        ]
        for u in defaults:
            existing = db.query(User).filter(User.username == u["username"]).first()
            if not existing:
                db.add(User(**u))
        db.commit()
        logger.info("Default user accounts verified and synced.")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to seed users: {e}")
    finally:
        db.close()


class LoginRequest(BaseModel):
    username: str
    password: str


# ──────────────────────────────────────────────
# Role-Based Access Control (RBAC) Helpers
# ──────────────────────────────────────────────
def require_roles(*allowed_roles: str):
    """
    Dependency factory enforcing role permissions.
    Permits only users whose role is in allowed_roles.
    """
    def role_checker(current_user: User = Depends(require_user)) -> User:
        user_role = (current_user.role or "").upper().strip()
        allowed = [r.upper().strip() for r in allowed_roles]
        if user_role not in allowed:
            logger.warning(
                f"RBAC denial: User '{current_user.username}' with role '{user_role}' "
                f"attempted action requiring {allowed}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Role '{user_role}' has insufficient privileges (requires {', '.join(allowed)})."
            )
        return current_user
    return role_checker


require_admin = require_roles("ADMIN")
require_operator = require_roles("ADMIN", "OPERATOR")
require_any_user = require_roles("ADMIN", "OPERATOR", "VIEWER")


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────
@router.post("/login", response_model=Token)
def login_form(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Standard OAuth2 form-encoded login."""
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": user.username, "role": user.role})
    logger.info(f"Login (form): user={user.username} role={user.role}")
    return Token(access_token=token, token_type="bearer", role=user.role, username=user.username)


@router.post("/login-json", response_model=Token)
def login_json(payload: LoginRequest, db: Session = Depends(get_db)):
    """JSON-based login endpoint for frontend client applications."""
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": user.username, "role": user.role})
    logger.info(f"Login (json): user={user.username} role={user.role}")
    return Token(access_token=token, token_type="bearer", role=user.role, username=user.username)


@router.post("/token", response_model=Token)
def token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """OAuth2-compatible token endpoint."""
    return login_form(form_data, db)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(require_user)):
    """Returns the currently authenticated user's profile."""
    return current_user


@router.get("/users", response_model=List[UserResponse])
def list_users(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Admin-only: lists all registered user accounts."""
    return db.query(User).all()

