import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.game import FORMAT_CAPACITY, GameCreate, GameDetail, GameOut, GameParticipantOut

router = APIRouter()

_GAME_COLUMNS = """
    g.id, g.sport_id, sp.name AS sport_name, g.venue_id, v.name AS venue_name,
    g.circle_id, c.name AS circle_name, g.creator_user_id, g.scheduled_at,
    g.format, g.visibility, g.status, g.created_at,
    (SELECT count(*) FROM social.game_participants gp
        WHERE gp.game_id = g.id AND gp.status = 'confirmed') AS confirmed_count
"""


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this circle")


def _build_game_out(row) -> GameOut:
    d = dict(row)
    d["capacity"] = FORMAT_CAPACITY[d["format"]]
    return GameOut(**d)


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
                    (sport_id, venue_id, creator_user_id, circle_id, scheduled_at, format, visibility)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
                """,
                payload.sport_id,
                payload.venue_id,
                current_user_id,
                payload.circle_id,
                payload.scheduled_at,
                payload.format,
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
                SELECT {_GAME_COLUMNS}
                FROM social.games g
                JOIN core.sports sp ON sp.id = g.sport_id
                JOIN core.venues v ON v.id = g.venue_id
                JOIN social.circles c ON c.id = g.circle_id
                WHERE g.id = $1
                """,
                game_id,
            )
    return _build_game_out(row)


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
            SELECT {_GAME_COLUMNS}
            FROM social.games g
            JOIN core.sports sp ON sp.id = g.sport_id
            JOIN core.venues v ON v.id = g.venue_id
            JOIN social.circles c ON c.id = g.circle_id
            WHERE g.circle_id = $1
            ORDER BY g.scheduled_at
            """,
            circle_id,
        )
    else:
        # Games in any circle the current user belongs to.
        rows = await pool.fetch(
            f"""
            SELECT {_GAME_COLUMNS}
            FROM social.games g
            JOIN core.sports sp ON sp.id = g.sport_id
            JOIN core.venues v ON v.id = g.venue_id
            JOIN social.circles c ON c.id = g.circle_id
            JOIN social.circle_members cm ON cm.circle_id = g.circle_id AND cm.user_id = $1
            ORDER BY g.scheduled_at
            """,
            current_user_id,
        )
    return [_build_game_out(r) for r in rows]


@router.get("/games/{game_id}", response_model=GameDetail)
async def get_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    row = await pool.fetchrow(
        f"""
        SELECT {_GAME_COLUMNS}
        FROM social.games g
        JOIN core.sports sp ON sp.id = g.sport_id
        JOIN core.venues v ON v.id = g.venue_id
        JOIN social.circles c ON c.id = g.circle_id
        WHERE g.id = $1
        """,
        game_id,
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
    game_out = _build_game_out(row)
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
                "SELECT circle_id, format, status FROM social.games WHERE id = $1 FOR UPDATE",
                game_id,
            )
            if game_row is None:
                raise HTTPException(status_code=404, detail="Game not found")
            if game_row["status"] in ("completed", "cancelled"):
                raise HTTPException(status_code=409, detail=f"Game is {game_row['status']}")

            await _require_circle_member(conn, game_row["circle_id"], current_user_id)

            already_in = await conn.fetchval(
                "SELECT 1 FROM social.game_participants WHERE game_id = $1 AND user_id = $2",
                game_id,
                current_user_id,
            )
            if already_in:
                raise HTTPException(status_code=409, detail="Already joined this game")

            capacity = FORMAT_CAPACITY[game_row["format"]]
            confirmed_count = await conn.fetchval(
                """
                SELECT count(*) FROM social.game_participants
                WHERE game_id = $1 AND status = 'confirmed'
                """,
                game_id,
            )
            if confirmed_count >= capacity:
                raise HTTPException(status_code=409, detail="Game is full")

            await conn.execute(
                """
                INSERT INTO social.game_participants (game_id, user_id, status)
                VALUES ($1, $2, 'confirmed')
                """,
                game_id,
                current_user_id,
            )

            if confirmed_count + 1 >= capacity:
                await conn.execute(
                    "UPDATE social.games SET status = 'full' WHERE id = $1", game_id
                )

    return await get_game(game_id, current_user_id)
