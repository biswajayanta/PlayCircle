import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.game import (
    AddParticipantRequest,
    GameCreate,
    GameDetail,
    GameOut,
    GameParticipantOut,
    GameReschedule,
)

router = APIRouter()

# All "is this the right day" comparisons use a fixed timezone rather than
# whatever the DB server's session timezone happens to default to, so the
# same game behaves identically whether the API runs on a laptop or Azure.
_TZ = "Asia/Kolkata"

_GAME_COLUMNS = """
    g.id, g.sport_id, sp.name AS sport_name, g.venue_id, v.name AS venue_name,
    g.circle_id, c.name AS circle_name, g.creator_user_id, g.scheduled_at,
    g.visibility, g.status, g.created_at,
    (SELECT count(*) FROM social.game_participants gp
        WHERE gp.game_id = g.id AND gp.status = 'confirmed') AS confirmed_count,
    EXISTS (
        SELECT 1 FROM social.game_participants gp2
        WHERE gp2.game_id = g.id AND gp2.user_id = $__USER__ AND gp2.status = 'confirmed'
    ) AS already_joined,
    (g.scheduled_at AT TIME ZONE '""" + _TZ + """')::date < (now() AT TIME ZONE '""" + _TZ + """')::date AS is_past,
    EXISTS (
        SELECT 1 FROM financial.expenses fe WHERE fe.game_id = g.id
    ) AS has_expenses,
    NOT EXISTS (
        SELECT 1 FROM financial.expense_splits fes
        JOIN financial.expenses fe2 ON fe2.id = fes.expense_id
        WHERE fe2.game_id = g.id AND fes.is_settled = false
    ) AS all_settled
"""


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this circle")


@router.post("/games", response_model=GameOut, status_code=201)
async def create_game(
    payload: GameCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _require_circle_member(conn, payload.circle_id, current_user_id)

            venue_row = await conn.fetchrow(
                "SELECT sport_id FROM core.venues WHERE id = $1", payload.venue_id
            )
            if venue_row is None:
                raise HTTPException(status_code=404, detail="Venue not found")
            if venue_row["sport_id"] != payload.sport_id:
                raise HTTPException(
                    status_code=422, detail="Venue does not host the given sport"
                )

            game_row = await conn.fetchrow(
                """
                INSERT INTO social.games
                    (sport_id, venue_id, creator_user_id, circle_id, scheduled_at, visibility)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
                """,
                payload.sport_id,
                payload.venue_id,
                current_user_id,
                payload.circle_id,
                payload.scheduled_at,
                payload.visibility,
            )
            game_id = game_row["id"]

            # Creator auto-joins as a confirmed participant.
            await conn.execute(
                """
                INSERT INTO social.game_participants (game_id, user_id, status)
                VALUES ($1, $2, 'confirmed')
                """,
                game_id,
                current_user_id,
            )

            row = await conn.fetchrow(
                f"""
                SELECT {_GAME_COLUMNS.replace('$__USER__', '$2')}
                FROM social.games g
                JOIN core.sports sp ON sp.id = g.sport_id
                JOIN core.venues v ON v.id = g.venue_id
                JOIN social.circles c ON c.id = g.circle_id
                WHERE g.id = $1
                """,
                game_id,
                current_user_id,
            )
    return GameOut(**dict(row))


@router.get("/games", response_model=list[GameOut])
async def list_games(
    circle_id: uuid.UUID | None = Query(default=None),
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    if circle_id is not None:
        async with pool.acquire() as conn:
            await _require_circle_member(conn, circle_id, current_user_id)
        rows = await pool.fetch(
            f"""
            SELECT {_GAME_COLUMNS.replace('$__USER__', '$2')}
            FROM social.games g
            JOIN core.sports sp ON sp.id = g.sport_id
            JOIN core.venues v ON v.id = g.venue_id
            JOIN social.circles c ON c.id = g.circle_id
            WHERE g.circle_id = $1
            ORDER BY g.scheduled_at
            """,
            circle_id,
            current_user_id,
        )
    else:
        rows = await pool.fetch(
            f"""
            SELECT {_GAME_COLUMNS.replace('$__USER__', '$1')}
            FROM social.games g
            JOIN core.sports sp ON sp.id = g.sport_id
            JOIN core.venues v ON v.id = g.venue_id
            JOIN social.circles c ON c.id = g.circle_id
            JOIN social.circle_members cm ON cm.circle_id = g.circle_id AND cm.user_id = $1
            ORDER BY g.scheduled_at
            """,
            current_user_id,
        )
    return [GameOut(**dict(r)) for r in rows]


@router.get("/games/{game_id}", response_model=GameDetail)
async def get_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    row = await pool.fetchrow(
        f"""
        SELECT {_GAME_COLUMNS.replace('$__USER__', '$2')}
        FROM social.games g
        JOIN core.sports sp ON sp.id = g.sport_id
        JOIN core.venues v ON v.id = g.venue_id
        JOIN social.circles c ON c.id = g.circle_id
        WHERE g.id = $1
        """,
        game_id,
        current_user_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Game not found")

    async with pool.acquire() as conn:
        await _require_circle_member(conn, row["circle_id"], current_user_id)

    participant_rows = await pool.fetch(
        """
        SELECT gp.user_id, u.display_name, gp.status, gp.joined_at
        FROM social.game_participants gp
        JOIN core.users u ON u.id = gp.user_id
        WHERE gp.game_id = $1
        ORDER BY gp.joined_at
        """,
        game_id,
    )
    game_out = GameOut(**dict(row))
    return GameDetail(
        **game_out.model_dump(),
        participants=[GameParticipantOut(**dict(p)) for p in participant_rows],
    )


@router.post("/games/{game_id}/join", response_model=GameDetail, status_code=201)
async def join_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await conn.fetchrow(
                f"""
                SELECT circle_id, status,
                    (scheduled_at AT TIME ZONE '{_TZ}')::date AS scheduled_date,
                    (now() AT TIME ZONE '{_TZ}')::date AS today
                FROM social.games WHERE id = $1 FOR UPDATE
                """,
                game_id,
            )
            if game_row is None:
                raise HTTPException(status_code=404, detail="Game not found")
            if game_row["status"] in ("completed", "cancelled"):
                raise HTTPException(status_code=409, detail=f"Game is {game_row['status']}")
            if game_row["scheduled_date"] < game_row["today"]:
                raise HTTPException(
                    status_code=409, detail="This game's date has already passed"
                )

            await _require_circle_member(conn, game_row["circle_id"], current_user_id)

            already_in = await conn.fetchval(
                "SELECT 1 FROM social.game_participants WHERE game_id = $1 AND user_id = $2",
                game_id,
                current_user_id,
            )
            if already_in:
                raise HTTPException(status_code=409, detail="Already joined this game")

            await conn.execute(
                """
                INSERT INTO social.game_participants (game_id, user_id, status)
                VALUES ($1, $2, 'confirmed')
                """,
                game_id,
                current_user_id,
            )

    return await get_game(game_id, current_user_id)


@router.post("/games/{game_id}/participants", response_model=GameDetail, status_code=201)
async def add_participant(
    game_id: uuid.UUID,
    payload: AddParticipantRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """The game's creator adds a circle member directly, bypassing the
    self-service join flow. Same rules as joining (day cutoff, active
    status) apply — this is a shortcut for the owner, not a way around
    those checks."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await conn.fetchrow(
                f"""
                SELECT circle_id, status, creator_user_id,
                    (scheduled_at AT TIME ZONE '{_TZ}')::date AS scheduled_date,
                    (now() AT TIME ZONE '{_TZ}')::date AS today
                FROM social.games WHERE id = $1 FOR UPDATE
                """,
                game_id,
            )
            if game_row is None:
                raise HTTPException(status_code=404, detail="Game not found")
            if game_row["creator_user_id"] != current_user_id:
                raise HTTPException(
                    status_code=403, detail="Only the game's creator can add players directly"
                )
            if game_row["status"] in ("completed", "cancelled"):
                raise HTTPException(status_code=409, detail=f"Game is {game_row['status']}")
            if game_row["scheduled_date"] < game_row["today"]:
                raise HTTPException(
                    status_code=409, detail="This game's date has already passed"
                )

            is_circle_member = await conn.fetchval(
                "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                game_row["circle_id"],
                payload.user_id,
            )
            if not is_circle_member:
                raise HTTPException(
                    status_code=422, detail="They must be a member of this circle first"
                )

            already_in = await conn.fetchval(
                "SELECT 1 FROM social.game_participants WHERE game_id = $1 AND user_id = $2",
                game_id,
                payload.user_id,
            )
            if already_in:
                raise HTTPException(status_code=409, detail="Already a participant of this game")

            await conn.execute(
                """
                INSERT INTO social.game_participants (game_id, user_id, status)
                VALUES ($1, $2, 'confirmed')
                """,
                game_id,
                payload.user_id,
            )

    return await get_game(game_id, current_user_id)


@router.patch("/games/{game_id}/reschedule", response_model=GameDetail)
async def reschedule_game(
    game_id: uuid.UUID,
    payload: GameReschedule,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await conn.fetchrow(
                "SELECT creator_user_id, scheduled_at, status FROM social.games WHERE id = $1 FOR UPDATE",
                game_id,
            )
            if game_row is None:
                raise HTTPException(status_code=404, detail="Game not found")
            if game_row["creator_user_id"] != current_user_id:
                raise HTTPException(
                    status_code=403, detail="Only the game's creator can reschedule it"
                )
            if game_row["status"] in ("completed", "cancelled"):
                raise HTTPException(status_code=409, detail=f"Game is {game_row['status']}")

            now = datetime.now(timezone.utc)
            original = game_row["scheduled_at"]
            if original.tzinfo is None:
                original = original.replace(tzinfo=timezone.utc)
            if now > original:
                raise HTTPException(
                    status_code=409,
                    detail="Can't reschedule — this game's original start time has already passed",
                )

            await conn.execute(
                "UPDATE social.games SET scheduled_at = $1 WHERE id = $2",
                payload.scheduled_at,
                game_id,
            )

    return await get_game(game_id, current_user_id)


@router.post("/games/{game_id}/cancel", response_model=GameDetail)
async def cancel_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await conn.fetchrow(
                "SELECT creator_user_id, status FROM social.games WHERE id = $1 FOR UPDATE",
                game_id,
            )
            if game_row is None:
                raise HTTPException(status_code=404, detail="Game not found")
            if game_row["creator_user_id"] != current_user_id:
                raise HTTPException(
                    status_code=403, detail="Only the game's creator can cancel it"
                )
            if game_row["status"] == "cancelled":
                raise HTTPException(status_code=409, detail="Game is already cancelled")

            match_count = await conn.fetchval(
                "SELECT count(*) FROM social.matches WHERE game_id = $1", game_id
            )
            if match_count > 0:
                raise HTTPException(
                    status_code=422,
                    detail="Can't cancel — matches have already been played in this game",
                )

            unpaid_count = await conn.fetchval(
                """
                SELECT count(*) FROM financial.expense_splits es
                JOIN financial.expenses e ON e.id = es.expense_id
                WHERE e.game_id = $1 AND es.is_settled = false
                """,
                game_id,
            )
            if unpaid_count > 0:
                raise HTTPException(
                    status_code=422,
                    detail="Can't cancel — there are unpaid expenses in this game",
                )

            await conn.execute(
                "UPDATE social.games SET status = 'cancelled' WHERE id = $1", game_id
            )

    return await get_game(game_id, current_user_id)


@router.delete("/games/{game_id}/participants/{user_id}", status_code=204)
async def remove_or_leave_game(
    game_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """One endpoint covers both cases: passing your own user_id is a
    self-leave (always allowed, subject to the checks below); passing
    someone else's requires you to be the game's creator.

    Allowed only if:
    - the game's date hasn't passed (day-level check, same as joining)
    - the target isn't the game's creator (cancel the game instead)
    - the target has no footprint beyond having joined: no matches played,
      no expense involvement at all (as payer or as a split), in this game
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await conn.fetchrow(
                f"""
                SELECT creator_user_id, status,
                    (scheduled_at AT TIME ZONE '{_TZ}')::date AS scheduled_date,
                    (now() AT TIME ZONE '{_TZ}')::date AS today
                FROM social.games WHERE id = $1 FOR UPDATE
                """,
                game_id,
            )
            if game_row is None:
                raise HTTPException(status_code=404, detail="Game not found")

            is_self = user_id == current_user_id
            if not is_self and game_row["creator_user_id"] != current_user_id:
                raise HTTPException(
                    status_code=403,
                    detail="Only the game's creator can remove someone else",
                )
            if user_id == game_row["creator_user_id"]:
                raise HTTPException(
                    status_code=422,
                    detail="The game's creator can't be removed — cancel the game instead",
                )
            if game_row["scheduled_date"] < game_row["today"]:
                raise HTTPException(
                    status_code=409, detail="This game's date has already passed"
                )

            participant_exists = await conn.fetchval(
                "SELECT 1 FROM social.game_participants WHERE game_id = $1 AND user_id = $2",
                game_id,
                user_id,
            )
            if not participant_exists:
                raise HTTPException(status_code=404, detail="Not a participant of this game")

            played_count = await conn.fetchval(
                """
                SELECT count(*) FROM social.match_participants mp
                JOIN social.matches m ON m.id = mp.match_id
                WHERE m.game_id = $1 AND mp.user_id = $2
                """,
                game_id,
                user_id,
            )
            if played_count > 0:
                raise HTTPException(
                    status_code=422,
                    detail="Can't remove — they've already played a match in this game",
                )

            paid_count = await conn.fetchval(
                "SELECT count(*) FROM financial.expenses WHERE game_id = $1 AND paid_by_user_id = $2",
                game_id,
                user_id,
            )
            if paid_count > 0:
                raise HTTPException(
                    status_code=422,
                    detail="Can't remove — they've logged an expense payment in this game",
                )

            split_count = await conn.fetchval(
                """
                SELECT count(*) FROM financial.expense_splits es
                JOIN financial.expenses e ON e.id = es.expense_id
                WHERE e.game_id = $1 AND es.user_id = $2
                """,
                game_id,
                user_id,
            )
            if split_count > 0:
                raise HTTPException(
                    status_code=422,
                    detail="Can't remove — they're part of an expense split in this game",
                )

            await conn.execute(
                "DELETE FROM social.game_participants WHERE game_id = $1 AND user_id = $2",
                game_id,
                user_id,
            )
