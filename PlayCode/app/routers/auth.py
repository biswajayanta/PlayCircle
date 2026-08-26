import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.db import get_pool
from app.jwt_auth import create_access_token
from app.schemas.auth import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    TokenResponse,
)
from app.schemas.user import UserMe
from app.security import generate_reset_token, hash_password, hash_reset_token, verify_password

logger = logging.getLogger("playcircle.auth")

router = APIRouter()

RESET_TOKEN_EXPIRE_MINUTES = 30

_ME_COLUMNS = """
    u.id AS user_id, u.email, u.phone, u.auth_provider,
    u.display_name, u.avatar_url, u.avatar_prompt,
    p.bio, p.city, p.is_public, p.show_stats, p.show_activity,
    p.sports_interest, p.age, p.age_verified,
    p.height_cm, p.height_verified, p.weight_kg, p.weight_verified,
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


@router.post("/auth/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(payload: ForgotPasswordRequest):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            user_id = await conn.fetchval(
                "SELECT id FROM core.users WHERE email = $1", payload.email
            )
            # Always return the same generic response whether or not the email
            # is registered — otherwise this endpoint becomes a way to check
            # who has an account.
            if user_id is not None:
                # Invalidate any previous outstanding tokens for this user so
                # only the newest request is ever valid.
                await conn.execute(
                    "DELETE FROM core.password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
                    user_id,
                )

                raw_token, token_hash = generate_reset_token()
                expires_at = datetime.now(timezone.utc) + timedelta(
                    minutes=RESET_TOKEN_EXPIRE_MINUTES
                )
                await conn.execute(
                    """
                    INSERT INTO core.password_reset_tokens (user_id, token_hash, expires_at)
                    VALUES ($1, $2, $3)
                    """,
                    user_id,
                    token_hash,
                    expires_at,
                )

                # TODO: replace with real email delivery once an email provider
                # is set up. Until then, this is how the token actually reaches
                # someone — visible in server logs / Azure Log stream.
                logger.info(
                    "Password reset requested for %s — token (valid %s min): %s",
                    payload.email,
                    RESET_TOKEN_EXPIRE_MINUTES,
                    raw_token,
                )

    return ForgotPasswordResponse()


@router.post("/auth/reset-password", response_model=ForgotPasswordResponse)
async def reset_password(payload: ResetPasswordRequest):
    pool = get_pool()
    token_hash = hash_reset_token(payload.token)

    async with pool.acquire() as conn:
        async with conn.transaction():
            token_row = await conn.fetchrow(
                """
                SELECT id, user_id, expires_at, used_at
                FROM core.password_reset_tokens
                WHERE token_hash = $1
                FOR UPDATE
                """,
                token_hash,
            )

            # Same generic error for "no such token", "expired", and "already
            # used" — no reason to help an attacker distinguish these.
            invalid = (
                token_row is None
                or token_row["used_at"] is not None
                or token_row["expires_at"] < datetime.now(timezone.utc)
            )
            if invalid:
                raise HTTPException(status_code=400, detail="Invalid or expired reset link")

            new_hash = hash_password(payload.new_password)
            await conn.execute(
                "UPDATE core.users SET password_hash = $1 WHERE id = $2",
                new_hash,
                token_row["user_id"],
            )
            await conn.execute(
                "UPDATE core.password_reset_tokens SET used_at = now() WHERE id = $1",
                token_row["id"],
            )

    return ForgotPasswordResponse(detail="Password has been reset. You can now log in.")
