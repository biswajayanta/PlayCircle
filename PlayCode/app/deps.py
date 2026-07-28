import uuid

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db import get_pool
from app.jwt_auth import decode_access_token

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> uuid.UUID:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Confirm the user still exists (e.g. wasn't deleted after the token was issued).
    pool = get_pool()
    exists = await pool.fetchval("SELECT 1 FROM core.users WHERE id = $1", user_id)
    if not exists:
        raise HTTPException(status_code=401, detail="User no longer exists")

    return user_id
