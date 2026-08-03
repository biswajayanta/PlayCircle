import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.match import (
    FORMAT_CAPACITY,
    MatchComplete,
    MatchCreate,
    MatchDetail,
    MatchOut,
    MatchParticipantOut,
    RecordPoint,
)
from app.scoring.registry import get_engine

router = APIRouter()

# Same day-level (not exact time) cutoff used for joining/leaving a game —
# a match can't be *started* once the game's date has passed, though an
# already-in-progress match can still be scored past midnight.
_TZ = ZoneInfo("Asia/Kolkata")


def _is_past_date(scheduled_at: datetime) -> bool:
    return scheduled_at.astimezone(_TZ).date() < datetime.now(_TZ).date()

_MATCH_COLUMNS = """
    m.id, m.game_id, m.sport_id, sp.name AS sport_name, m.format,
    m.started_at, m.ended_at, m.score, m.status, m.created_at
"""


async def _require_circle_member_for_game(conn, game_id: uuid.UUID, user_id: uuid.UUID):
    game_row = await conn.fetchrow(
        "SELECT circle_id, sport_id, status, scheduled_at FROM social.games WHERE id = $1", game_id
    )
    if game_row is None:
        raise HTTPException(status_code=404, detail="Game not found")
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        game_row["circle_id"],
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this game's circle")
    return game_row


async def _fetch_match_detail(pool, match_id: uuid.UUID) -> MatchDetail:
    row = await pool.fetchrow(
        f"""
        SELECT {_MATCH_COLUMNS}
        FROM social.matches m
        JOIN core.sports sp ON sp.id = m.sport_id
        WHERE m.id = $1
        """,
        match_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Match not found")

    participant_rows = await pool.fetch(
        """
        SELECT mp.user_id, u.display_name, mp.team, mp.points_scored, mp.result
        FROM social.match_participants mp
        JOIN core.users u ON u.id = mp.user_id
        WHERE mp.match_id = $1
        ORDER BY mp.team, u.display_name
        """,
        match_id,
    )
    row_data = dict(row)
    if isinstance(row_data.get("score"), str):
        row_data["score"] = json.loads(row_data["score"])
    match_out = MatchOut(**row_data)
    return MatchDetail(
        **match_out.model_dump(),
        participants=[MatchParticipantOut(**dict(p)) for p in participant_rows],
    )


async def _save_score_and_maybe_complete(
    conn, match_id: uuid.UUID, sport_name: str, new_score: dict
) -> None:
    engine = get_engine(sport_name)

    await conn.execute(
        "UPDATE social.matches SET score = $2::jsonb WHERE id = $1",
        match_id,
        json.dumps(new_score),
    )

    if engine.is_complete(new_score):
        winner = engine.winner(new_score)
        await conn.execute(
            """
            UPDATE social.matches
            SET status = 'completed', ended_at = now()
            WHERE id = $1 AND status = 'in_progress'
            """,
            match_id,
        )
        participant_rows = await conn.fetch(
            "SELECT user_id, team FROM social.match_participants WHERE match_id = $1", match_id
        )
        for p in participant_rows:
            team_score = new_score.get(f"team_{p['team']}", 0)
            result = "win" if p["team"] == winner else "loss"
            await conn.execute(
                """
                UPDATE social.match_participants
                SET points_scored = $3, result = $4
                WHERE match_id = $1 AND user_id = $2
                """,
                match_id,
                p["user_id"],
                team_score,
                result,
            )
    else:
        # A point was undone and the match is no longer complete (e.g. correcting
        # a mis-tap that had ended it) — reopen it and clear any recorded results.
        await conn.execute(
            """
            UPDATE social.matches
            SET status = 'in_progress', ended_at = NULL
            WHERE id = $1 AND status = 'completed'
            """,
            match_id,
        )
        await conn.execute(
            """
            UPDATE social.match_participants
            SET points_scored = NULL, result = NULL
            WHERE match_id = $1
            """,
            match_id,
        )


async def _get_match_for_update(conn, match_id: uuid.UUID):
    match_row = await conn.fetchrow(
        """
        SELECT m.id, m.game_id, m.status, m.score, sp.name AS sport_name
        FROM social.matches m
        JOIN core.sports sp ON sp.id = m.sport_id
        WHERE m.id = $1
        FOR UPDATE OF m
        """,
        match_id,
    )
    if match_row is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match_row


@router.post("/matches/{match_id}/points", response_model=MatchDetail)
async def record_point(
    match_id: uuid.UUID,
    payload: RecordPoint,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            match_row = await _get_match_for_update(conn, match_id)
            if match_row["status"] == "abandoned":
                raise HTTPException(status_code=409, detail="Match was abandoned")

            await _require_circle_member_for_game(conn, match_row["game_id"], current_user_id)

            try:
                engine = get_engine(match_row["sport_name"])
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))

            current_score = match_row["score"]
            if isinstance(current_score, str):
                current_score = json.loads(current_score)
            if "team_1" not in current_score or "team_2" not in current_score:
                current_score = engine.initial_score()

            if match_row["status"] == "completed":
                raise HTTPException(
                    status_code=409,
                    detail="Match is already complete — undo the winning point first if this was a mistake",
                )

            try:
                new_score = engine.apply_point(current_score, payload.team)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))

            await _save_score_and_maybe_complete(conn, match_id, match_row["sport_name"], new_score)

    return await _fetch_match_detail(pool, match_id)


@router.post("/matches/{match_id}/undo", response_model=MatchDetail)
async def undo_point(
    match_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            match_row = await _get_match_for_update(conn, match_id)
            if match_row["status"] == "abandoned":
                raise HTTPException(status_code=409, detail="Match was abandoned")

            await _require_circle_member_for_game(conn, match_row["game_id"], current_user_id)

            try:
                engine = get_engine(match_row["sport_name"])
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))

            current_score = match_row["score"]
            if isinstance(current_score, str):
                current_score = json.loads(current_score)

            try:
                new_score = engine.undo_last_point(current_score)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))

            await _save_score_and_maybe_complete(conn, match_id, match_row["sport_name"], new_score)

    return await _fetch_match_detail(pool, match_id)


@router.post("/games/{game_id}/matches", response_model=MatchDetail, status_code=201)
async def create_match(
    game_id: uuid.UUID,
    payload: MatchCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await _require_circle_member_for_game(conn, game_id, current_user_id)
            if game_row["status"] in ("cancelled", "completed"):
                raise HTTPException(
                    status_code=409, detail=f"This game is {game_row['status']}"
                )
            if _is_past_date(game_row["scheduled_at"]):
                raise HTTPException(
                    status_code=409,
                    detail="This game's date has passed — no new matches can be started",
                )

            sport_name = await conn.fetchval(
                "SELECT name FROM core.sports WHERE id = $1", game_row["sport_id"]
            )

            expected_per_team = FORMAT_CAPACITY[payload.format]
            team_1_count = sum(1 for p in payload.participants if p.team == 1)
            team_2_count = sum(1 for p in payload.participants if p.team == 2)
            if team_1_count != expected_per_team or team_2_count != expected_per_team:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"This is a {payload.format} match — each team needs exactly "
                        f"{expected_per_team} player(s), got {team_1_count} and {team_2_count}"
                    ),
                )

            participant_ids = [p.user_id for p in payload.participants]
            confirmed_rows = await conn.fetch(
                """
                SELECT user_id FROM social.game_participants
                WHERE game_id = $1 AND status = 'confirmed' AND user_id = ANY($2::uuid[])
                """,
                game_id,
                participant_ids,
            )
            confirmed_ids = {r["user_id"] for r in confirmed_rows}
            missing = set(participant_ids) - confirmed_ids
            if missing:
                raise HTTPException(
                    status_code=422,
                    detail=f"These users are not confirmed participants of this game: {sorted(str(m) for m in missing)}",
                )

            try:
                engine = get_engine(sport_name)
                initial_score = engine.initial_score()
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))

            match_row = await conn.fetchrow(
                """
                INSERT INTO social.matches (game_id, sport_id, format, started_at, score)
                VALUES ($1, $2, $3, COALESCE($4, now()), $5::jsonb)
                RETURNING id
                """,
                game_id,
                game_row["sport_id"],
                payload.format,
                payload.started_at,
                json.dumps(initial_score),
            )
            match_id = match_row["id"]

            for p in payload.participants:
                await conn.execute(
                    """
                    INSERT INTO social.match_participants (match_id, user_id, team)
                    VALUES ($1, $2, $3)
                    """,
                    match_id,
                    p.user_id,
                    p.team,
                )

    return await _fetch_match_detail(pool, match_id)


@router.get("/games/{game_id}/matches", response_model=list[MatchOut])
async def list_matches_for_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member_for_game(conn, game_id, current_user_id)

    rows = await pool.fetch(
        f"""
        SELECT {_MATCH_COLUMNS}
        FROM social.matches m
        JOIN core.sports sp ON sp.id = m.sport_id
        WHERE m.game_id = $1
        ORDER BY m.started_at
        """,
        game_id,
    )
    result = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("score"), str):
            d["score"] = json.loads(d["score"])
        result.append(MatchOut(**d))
    return result


@router.get("/matches/{match_id}", response_model=MatchDetail)
async def get_match(
    match_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    match_row = await pool.fetchrow("SELECT game_id FROM social.matches WHERE id = $1", match_id)
    if match_row is None:
        raise HTTPException(status_code=404, detail="Match not found")

    async with pool.acquire() as conn:
        await _require_circle_member_for_game(conn, match_row["game_id"], current_user_id)

    return await _fetch_match_detail(pool, match_id)


@router.patch("/matches/{match_id}/complete", response_model=MatchDetail)
async def complete_match(
    match_id: uuid.UUID,
    payload: MatchComplete,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            match_row = await conn.fetchrow(
                "SELECT game_id, status FROM social.matches WHERE id = $1 FOR UPDATE", match_id
            )
            if match_row is None:
                raise HTTPException(status_code=404, detail="Match not found")
            if match_row["status"] != "in_progress":
                raise HTTPException(
                    status_code=409, detail=f"Match is already {match_row['status']}"
                )

            await _require_circle_member_for_game(conn, match_row["game_id"], current_user_id)

            if payload.participants:
                existing_rows = await conn.fetch(
                    "SELECT user_id FROM social.match_participants WHERE match_id = $1", match_id
                )
                existing_ids = {r["user_id"] for r in existing_rows}
                unknown = {p.user_id for p in payload.participants} - existing_ids
                if unknown:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Not participants of this match: {sorted(str(u) for u in unknown)}",
                    )
                for p in payload.participants:
                    await conn.execute(
                        """
                        UPDATE social.match_participants
                        SET points_scored = COALESCE($3, points_scored),
                            result = COALESCE($4, result)
                        WHERE match_id = $1 AND user_id = $2
                        """,
                        match_id,
                        p.user_id,
                        p.points_scored,
                        p.result,
                    )

            await conn.execute(
                """
                UPDATE social.matches
                SET status = $2,
                    ended_at = COALESCE($3, now()),
                    score = COALESCE($4::jsonb, score)
                WHERE id = $1
                """,
                match_id,
                payload.status,
                payload.ended_at,
                json.dumps(payload.score) if payload.score is not None else None,
            )

    return await _fetch_match_detail(pool, match_id)
