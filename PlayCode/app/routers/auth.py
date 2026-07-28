from fastapi import APIRouter, HTTPException

from app.db import get_pool
from app.jwt_auth import create_access_token
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse
from app.schemas.user import UserMe
from app.security import hash_password, verify_password

router = APIRouter()

_ME_COLUMNS = """
    u.id AS user_id, u.email, u.phone, u.auth_provider,
    u.display_name, u.avatar_url, u.avatar_prompt,
    p.bio, p.city, p.is_public, p.show_stats, p.show_activity,
    u.created_at, p.updated_at
"""


@router.post("/auth/signup", response_model=TokenResponse, status_code=201)
async def signup(payload: SignupRequest):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchval(
                "SELECT id FROM core.users WHERE email = $1", payload.email
            )
            if existing:
                raise HTTPException(status_code=409, detail="Email already registered")

            password_hash = hash_password(payload.password)
            user_row = await conn.fetchrow(
                """
                INSERT INTO core.users
                    (email, auth_provider, auth_provider_id, display_name, password_hash)
                VALUES ($1, 'email', $1, $2, $3)
                RETURNING id
                """,
                payload.email,
                payload.display_name,
                password_hash,
            )
            user_id = user_row["id"]

            await conn.execute(
                "INSERT INTO social.profiles (user_id, city) VALUES ($1, $2)",
                user_id,
                payload.city,
            )

            row = await conn.fetchrow(
                f"""
                SELECT {_ME_COLUMNS}
                FROM core.users u
                JOIN social.profiles p ON p.user_id = u.id
                WHERE u.id = $1
                """,
                user_id,
            )

    token = create_access_token(user_id)
    return TokenResponse(access_token=token, user=UserMe(**dict(row)))


@router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    pool = get_pool()
    row = await pool.fetchrow(
        f"""
        SELECT {_ME_COLUMNS}, u.password_hash
        FROM core.users u
        JOIN social.profiles p ON p.user_id = u.id
        WHERE u.email = $1
        """,
        payload.email,
    )
    # Same error for "no such user" and "wrong password" — don't reveal which
    # emails are registered.
    if row is None or row["password_hash"] is None:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    user_data = {k: v for k, v in dict(row).items() if k != "password_hash"}
    token = create_access_token(user_data["user_id"])
    return TokenResponse(access_token=token, user=UserMe(**user_data))
