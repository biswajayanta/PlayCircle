import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.user import ProfileUpdate, UserMe, UserPublic

router = APIRouter()

_ME_COLUMNS = """
    u.id AS user_id, u.email, u.phone, u.auth_provider,
    u.display_name, u.avatar_url, u.avatar_prompt,
    p.bio, p.city, p.is_public, p.show_stats, p.show_activity,
    u.created_at, p.updated_at
"""

_CORE_USER_FIELDS = {"display_name", "avatar_url", "avatar_prompt"}
_PROFILE_FIELDS = {"bio", "city", "is_public", "show_stats", "show_activity"}

# Account creation now happens via POST /auth/signup (sets a password hash).
# This router only handles reading/updating profiles for already-authenticated users.


@router.get("/users/search", response_model=list[UserPublic])
async def search_users(
    q: str = Query(..., min_length=1, max_length=120),
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Search by display name only — never by email or phone, and only among
    public profiles. Someone with a private profile simply won't appear here;
    they can still be added to a circle directly by their exact email."""
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT u.id AS user_id, u.display_name, u.avatar_url, p.bio, p.city
        FROM core.users u
        JOIN social.profiles p ON p.user_id = u.id
        WHERE p.is_public = true
          AND u.id != $1
          AND u.display_name ILIKE '%' || $2 || '%'
        ORDER BY u.display_name
        LIMIT 15
        """,
        current_user_id,
        q,
    )
    return [UserPublic(**dict(r)) for r in rows]


@router.get("/users/{user_id}", response_model=UserPublic)
async def get_public_profile(user_id: uuid.UUID):
    pool = get_pool()
    row = await pool.fetchrow(
        """
        SELECT u.id AS user_id, u.display_name, u.avatar_url, p.bio, p.city
        FROM core.users u
        JOIN social.profiles p ON p.user_id = u.id
        WHERE u.id = $1 AND p.is_public = true
        """,
        user_id,
    )
    if row is None:
        # Same 404 whether the user doesn't exist or the profile is private —
        # avoids leaking which UUIDs correspond to real, non-public accounts.
        raise HTTPException(status_code=404, detail="Profile not found")
    return UserPublic(**dict(row))


@router.get("/me", response_model=UserMe)
async def get_me(current_user_id: uuid.UUID = Depends(get_current_user_id)):
    pool = get_pool()
    row = await pool.fetchrow(
        f"""
        SELECT {_ME_COLUMNS}
        FROM core.users u
        JOIN social.profiles p ON p.user_id = u.id
        WHERE u.id = $1
        """,
        current_user_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserMe(**dict(row))


@router.patch("/me", response_model=UserMe)
async def update_me(
    payload: ProfileUpdate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    updates = payload.model_dump(exclude_unset=True)
    core_updates = {k: v for k, v in updates.items() if k in _CORE_USER_FIELDS}
    profile_updates = {k: v for k, v in updates.items() if k in _PROFILE_FIELDS}

    if core_updates or profile_updates:
        pool = get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                if core_updates:
                    set_clauses = []
                    values = []
                    for i, (col, val) in enumerate(core_updates.items(), start=1):
                        set_clauses.append(f"{col} = ${i}")
                        values.append(val)
                    values.append(current_user_id)
                    result = await conn.execute(
                        f"UPDATE core.users SET {', '.join(set_clauses)} WHERE id = ${len(values)}",
                        *values,
                    )
                    if result == "UPDATE 0":
                        raise HTTPException(status_code=404, detail="User not found")

                if profile_updates:
                    set_clauses = []
                    values = []
                    for i, (col, val) in enumerate(profile_updates.items(), start=1):
                        set_clauses.append(f"{col} = ${i}")
                        values.append(val)
                    set_clauses.append("updated_at = now()")
                    values.append(current_user_id)
                    result = await conn.execute(
                        f"UPDATE social.profiles SET {', '.join(set_clauses)} WHERE user_id = ${len(values)}",
                        *values,
                    )
                    if result == "UPDATE 0":
                        raise HTTPException(status_code=404, detail="User not found")

    return await get_me(current_user_id)
