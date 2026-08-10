import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID | None:
    """Returns the user_id encoded in the token, or None if it's missing,
    expired, or invalid in any way."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None

    sub = payload.get("sub")
    if sub is None:
        return None
    try:
        return uuid.UUID(sub)
    except ValueError:
        return None
