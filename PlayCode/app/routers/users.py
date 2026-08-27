import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.user import (
    Achievement,
    AchievementCreate,
    ProfileUpdate,
    SportPerformance,
    UserMe,
    UserProfile,
    UserPublic,
)

router = APIRouter()

_ME_COLUMNS = """
    u.id AS user_id, u.email, u.phone, u.auth_provider,
    u.display_name, u.avatar_url, u.avatar_prompt,
    p.bio, p.city, p.is_public, p.show_stats, p.show_activity,
    p.sports_interest, p.date_of_birth, p.date_of_birth_verified,
    p.height_cm, p.height_verified, p.weight_kg, p.weight_verified,
    u.created_at, p.updated_at
"""

_CORE_USER_FIELDS = {"display_name", "avatar_url", "avatar_prompt"}
_PROFILE_FIELDS = {
    "bio", "city", "is_public", "show_stats", "show_activity",
    "sports_interest", "date_of_birth", "height_cm", "weight_kg",
}

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


@router.get("/users/{user_id}/profile", response_model=UserProfile)
async def get_full_profile(
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """The richer sports/performance view — same is_public privacy gate as
    the plain public-profile endpoint above, just more content once past
    it. Viewing your own profile always works regardless of is_public."""
    pool = get_pool()

    profile_row = await pool.fetchrow(
        """
        SELECT u.id AS user_id, u.display_name, u.avatar_url, p.bio, p.city,
               p.sports_interest, p.date_of_birth, p.date_of_birth_verified,
               p.height_cm, p.height_verified, p.weight_kg, p.weight_verified,
               p.is_public
        FROM core.users u
        JOIN social.profiles p ON p.user_id = u.id
        WHERE u.id = $1
        """,
        user_id,
    )
    if profile_row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not profile_row["is_public"] and user_id != current_user_id:
        raise HTTPException(status_code=404, detail="Profile not found")

    match_stats = await pool.fetch(
        """
        SELECT
            s.id AS sport_id, s.name AS sport_name,
            count(*) AS matches_played,
            count(*) FILTER (WHERE mp.result = 'win') AS wins,
            count(*) FILTER (WHERE mp.result = 'loss') AS losses
        FROM social.match_participants mp
        JOIN social.matches m ON m.id = mp.match_id
        JOIN core.sports s ON s.id = m.sport_id
        WHERE mp.user_id = $1 AND mp.result IS NOT NULL
        GROUP BY s.id, s.name
        """,
        user_id,
    )
    tournament_stats = await pool.fetch(
        """
        SELECT t.sport_id, count(DISTINCT t.id) AS tournaments_played
        FROM social.tournament_participants tp
        JOIN social.tournaments t ON t.id = tp.tournament_id
        WHERE tp.user_id = $1
        GROUP BY t.sport_id
        """,
        user_id,
    )
    tournaments_by_sport = {r["sport_id"]: r["tournaments_played"] for r in tournament_stats}

    performance = [
        SportPerformance(
            sport_id=r["sport_id"],
            sport_name=r["sport_name"],
            matches_played=r["matches_played"],
            wins=r["wins"],
            losses=r["losses"],
            win_rate=round((r["wins"] / r["matches_played"]) * 100, 1) if r["matches_played"] else 0.0,
            tournaments_played=tournaments_by_sport.get(r["sport_id"], 0),
        )
        for r in match_stats
    ]

    achievement_rows = await pool.fetch(
        """
        SELECT a.id, a.sport_id, s.name AS sport_name, a.level, a.event_name,
               a.rank, a.verified, a.created_at
        FROM social.achievements a
        JOIN core.sports s ON s.id = a.sport_id
        WHERE a.user_id = $1
        ORDER BY a.created_at DESC
        """,
        user_id,
    )

    return UserProfile(
        user_id=profile_row["user_id"],
        display_name=profile_row["display_name"],
        avatar_url=profile_row["avatar_url"],
        bio=profile_row["bio"],
        city=profile_row["city"],
        sports_interest=profile_row["sports_interest"],
        date_of_birth=profile_row["date_of_birth"],
        date_of_birth_verified=profile_row["date_of_birth_verified"],
        height_cm=float(profile_row["height_cm"]) if profile_row["height_cm"] is not None else None,
        height_verified=profile_row["height_verified"],
        weight_kg=float(profile_row["weight_kg"]) if profile_row["weight_kg"] is not None else None,
        weight_verified=profile_row["weight_verified"],
        performance=performance,
        achievements=[Achievement(**dict(r)) for r in achievement_rows],
    )


@router.post("/users/me/achievements", response_model=Achievement, status_code=201)
async def add_achievement(
    payload: AchievementCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    sport_exists = await pool.fetchval(
        "SELECT 1 FROM core.sports WHERE id = $1", payload.sport_id
    )
    if not sport_exists:
        raise HTTPException(status_code=404, detail="Sport not found")

    row = await pool.fetchrow(
        """
        INSERT INTO social.achievements (user_id, sport_id, level, event_name, rank)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, sport_id, level, event_name, rank, verified, created_at
        """,
        current_user_id,
        payload.sport_id,
        payload.level,
        payload.event_name,
        payload.rank,
    )
    sport_name = await pool.fetchval(
        "SELECT name FROM core.sports WHERE id = $1", payload.sport_id
    )
    return Achievement(**dict(row), sport_name=sport_name)


@router.delete("/users/me/achievements/{achievement_id}", status_code=204)
async def remove_achievement(
    achievement_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    result = await pool.execute(
        "DELETE FROM social.achievements WHERE id = $1 AND user_id = $2",
        achievement_id,
        current_user_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Achievement not found")


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
