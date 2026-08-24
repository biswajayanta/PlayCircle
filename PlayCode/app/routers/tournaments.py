import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.scoring.registry import get_engine
from app.schemas.tournament import (
    AddParticipantRequest,
    BracketOut,
    GenerateBracketRequest,
    ScheduleTournamentRequest,
    TournamentCreate,
    TournamentMatchOut,
    TournamentOut,
    TournamentParticipantOut,
    WalkoverRequest,
)
from app.tournaments.bracket import build_bracket
from app.tournaments.propagate import propagate_winner

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this circle")


async def _get_tournament_or_404(conn, tournament_id: uuid.UUID):
    row = await conn.fetchrow(
        "SELECT * FROM social.tournaments WHERE id = $1", tournament_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return row


@router.post("", response_model=TournamentOut, status_code=201)
async def create_tournament(
    payload: TournamentCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, payload.circle_id, current_user_id)

        sport_exists = await conn.fetchval(
            "SELECT 1 FROM core.sports WHERE id = $1", payload.sport_id
        )
        if not sport_exists:
            raise HTTPException(status_code=404, detail="Sport not found")

        row = await conn.fetchrow(
            """
            INSERT INTO social.tournaments (circle_id, sport_id, name, creator_user_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id, circle_id, sport_id, name, creator_user_id, format, status, created_at
            """,
            payload.circle_id,
            payload.sport_id,
            payload.name,
            current_user_id,
        )

        detail = await conn.fetchrow(
            """
            SELECT c.name AS circle_name, s.name AS sport_name
            FROM social.circles c, core.sports s
            WHERE c.id = $1 AND s.id = $2
            """,
            payload.circle_id,
            payload.sport_id,
        )

    return TournamentOut(
        id=row["id"],
        circle_id=row["circle_id"],
        circle_name=detail["circle_name"],
        sport_id=row["sport_id"],
        sport_name=detail["sport_name"],
        name=row["name"],
        creator_user_id=row["creator_user_id"],
        format=row["format"],
        status=row["status"],
        game_id=None,
        participant_count=0,
        created_at=row["created_at"],
    )


@router.get("/{tournament_id}", response_model=TournamentOut)
async def get_tournament(
    tournament_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        await _require_circle_member(conn, t["circle_id"], current_user_id)

        detail = await conn.fetchrow(
            """
            SELECT c.name AS circle_name, s.name AS sport_name
            FROM social.circles c, core.sports s
            WHERE c.id = $1 AND s.id = $2
            """,
            t["circle_id"],
            t["sport_id"],
        )
        participant_count = await conn.fetchval(
            "SELECT count(*) FROM social.tournament_participants WHERE tournament_id = $1",
            tournament_id,
        )

    return TournamentOut(
        id=t["id"],
        circle_id=t["circle_id"],
        circle_name=detail["circle_name"],
        sport_id=t["sport_id"],
        sport_name=detail["sport_name"],
        name=t["name"],
        creator_user_id=t["creator_user_id"],
        format=t["format"],
        status=t["status"],
        game_id=t["game_id"],
        participant_count=participant_count,
        created_at=t["created_at"],
    )


@router.post("/{tournament_id}/participants", response_model=TournamentParticipantOut, status_code=201)
async def add_participant(
    tournament_id: uuid.UUID,
    payload: AddParticipantRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        if t["creator_user_id"] != current_user_id:
            raise HTTPException(
                status_code=403, detail="Only the tournament creator can add participants"
            )
        if t["status"] != "draft":
            raise HTTPException(
                status_code=409, detail="Can't add participants once the bracket is set"
            )

        # Phase 1 is closed — every participant must already be a member of
        # the tournament's home circle.
        is_circle_member = await conn.fetchval(
            "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
            t["circle_id"],
            payload.user_id,
        )
        if not is_circle_member:
            raise HTTPException(
                status_code=422,
                detail="This user isn't a member of the tournament's circle",
            )

        already_in = await conn.fetchval(
            "SELECT 1 FROM social.tournament_participants WHERE tournament_id = $1 AND user_id = $2",
            tournament_id,
            payload.user_id,
        )
        if already_in:
            raise HTTPException(status_code=409, detail="Already a participant")

        row = await conn.fetchrow(
            """
            INSERT INTO social.tournament_participants (tournament_id, user_id)
            VALUES ($1, $2)
            RETURNING user_id, joined_at
            """,
            tournament_id,
            payload.user_id,
        )
        display_name = await conn.fetchval(
            "SELECT display_name FROM core.users WHERE id = $1", payload.user_id
        )

    return TournamentParticipantOut(
        user_id=row["user_id"], display_name=display_name, joined_at=row["joined_at"]
    )


@router.get("/{tournament_id}/participants", response_model=list[TournamentParticipantOut])
async def list_participants(
    tournament_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        await _require_circle_member(conn, t["circle_id"], current_user_id)

        rows = await conn.fetch(
            """
            SELECT tp.user_id, u.display_name, tp.joined_at
            FROM social.tournament_participants tp
            JOIN core.users u ON u.id = tp.user_id
            WHERE tp.tournament_id = $1
            ORDER BY tp.joined_at
            """,
            tournament_id,
        )
    return [TournamentParticipantOut(**dict(r)) for r in rows]


@router.post("/{tournament_id}/bracket", response_model=BracketOut, status_code=201)
async def generate_bracket(
    tournament_id: uuid.UUID,
    payload: GenerateBracketRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        if t["creator_user_id"] != current_user_id:
            raise HTTPException(
                status_code=403, detail="Only the tournament creator can generate the bracket"
            )
        if t["status"] != "draft":
            raise HTTPException(
                status_code=409,
                detail="Bracket already generated — can't regenerate once set",
            )

        participant_rows = await conn.fetch(
            "SELECT user_id FROM social.tournament_participants WHERE tournament_id = $1",
            tournament_id,
        )
        participant_ids = [r["user_id"] for r in participant_rows]

        if payload.seeding is not None:
            if set(payload.seeding) != set(participant_ids) or len(payload.seeding) != len(participant_ids):
                raise HTTPException(
                    status_code=422,
                    detail="Seeding list must contain exactly the tournament's current participants, no more, no less",
                )
            ordered = payload.seeding
            randomize = False
        elif payload.random_seed:
            ordered = participant_ids
            randomize = True
        else:
            raise HTTPException(
                status_code=422,
                detail="Provide either an explicit 'seeding' order or set 'random_seed': true",
            )

        try:
            bracket_rows = build_bracket(ordered, randomize=randomize)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

        async with conn.transaction():
            for row in bracket_rows:
                await conn.execute(
                    """
                    INSERT INTO social.tournament_matches
                        (tournament_id, round_number, position_in_round,
                         player_1_user_id, player_2_user_id, winner_user_id, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    tournament_id,
                    row["round_number"],
                    row["position_in_round"],
                    row["player_1_user_id"],
                    row["player_2_user_id"],
                    row["winner_user_id"],
                    row["status"],
                )
            await conn.execute(
                "UPDATE social.tournaments SET status = 'fixture_set' WHERE id = $1",
                tournament_id,
            )

    return await get_bracket(tournament_id, current_user_id)


@router.get("/{tournament_id}/bracket", response_model=BracketOut)
async def get_bracket(
    tournament_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        await _require_circle_member(conn, t["circle_id"], current_user_id)

        rows = await conn.fetch(
            """
            SELECT
                tm.id, tm.round_number, tm.position_in_round,
                tm.player_1_user_id, u1.display_name AS player_1_display_name,
                tm.player_2_user_id, u2.display_name AS player_2_display_name,
                tm.winner_user_id, tm.match_id, tm.status
            FROM social.tournament_matches tm
            LEFT JOIN core.users u1 ON u1.id = tm.player_1_user_id
            LEFT JOIN core.users u2 ON u2.id = tm.player_2_user_id
            WHERE tm.tournament_id = $1
            ORDER BY tm.round_number, tm.position_in_round
            """,
            tournament_id,
        )

    total_rounds = max((r["round_number"] for r in rows), default=0)
    return BracketOut(
        tournament_id=tournament_id,
        total_rounds=total_rounds,
        matches=[TournamentMatchOut(**dict(r)) for r in rows],
    )


async def _fetch_tournament_match_out(tournament_match_id: uuid.UUID) -> TournamentMatchOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                tm.id, tm.round_number, tm.position_in_round,
                tm.player_1_user_id, u1.display_name AS player_1_display_name,
                tm.player_2_user_id, u2.display_name AS player_2_display_name,
                tm.winner_user_id, tm.match_id, tm.status
            FROM social.tournament_matches tm
            LEFT JOIN core.users u1 ON u1.id = tm.player_1_user_id
            LEFT JOIN core.users u2 ON u2.id = tm.player_2_user_id
            WHERE tm.id = $1
            """,
            tournament_match_id,
        )
    return TournamentMatchOut(**dict(row))


@router.post("/{tournament_id}/schedule", response_model=TournamentOut)
async def schedule_tournament(
    tournament_id: uuid.UUID,
    payload: ScheduleTournamentRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Creates the real Game every tournament match will live inside — the
    same way a normal game gets scheduled — and confirms every tournament
    participant into it, since 'all tournament members are also game
    members' per the spec."""
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        if t["creator_user_id"] != current_user_id:
            raise HTTPException(
                status_code=403, detail="Only the tournament creator can schedule it"
            )
        if t["status"] != "fixture_set":
            raise HTTPException(
                status_code=409, detail="Generate the bracket before scheduling"
            )
        if t["game_id"] is not None:
            raise HTTPException(status_code=409, detail="Already scheduled")

        hosts_sport = await conn.fetchval(
            "SELECT 1 FROM core.venue_sports WHERE venue_id = $1 AND sport_id = $2",
            payload.venue_id,
            t["sport_id"],
        )
        if not hosts_sport:
            raise HTTPException(
                status_code=422, detail="This venue doesn't host the tournament's sport"
            )

        async with conn.transaction():
            game_row = await conn.fetchrow(
                """
                INSERT INTO social.games
                    (sport_id, venue_id, creator_user_id, circle_id, scheduled_at, visibility, status)
                VALUES ($1, $2, $3, $4, $5, 'circle', 'open')
                RETURNING id
                """,
                t["sport_id"],
                payload.venue_id,
                current_user_id,
                t["circle_id"],
                payload.scheduled_at,
            )
            game_id = game_row["id"]

            participant_rows = await conn.fetch(
                "SELECT user_id FROM social.tournament_participants WHERE tournament_id = $1",
                tournament_id,
            )
            for p in participant_rows:
                await conn.execute(
                    """
                    INSERT INTO social.game_participants (game_id, user_id, status)
                    VALUES ($1, $2, 'confirmed')
                    ON CONFLICT (game_id, user_id) DO NOTHING
                    """,
                    game_id,
                    p["user_id"],
                )

            await conn.execute(
                "UPDATE social.tournaments SET game_id = $1 WHERE id = $2",
                game_id,
                tournament_id,
            )

    return await get_tournament(tournament_id, current_user_id)


@router.post("/{tournament_id}/matches/{slot_id}/start", response_model=TournamentMatchOut)
async def start_tournament_match(
    tournament_id: uuid.UUID,
    slot_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Turns a 'ready' bracket slot into a real, live-scorable
    social.matches row — from this point on, scoring it uses the exact same
    /matches/{id}/points, /undo, /complete endpoints as any other match."""
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        await _require_circle_member(conn, t["circle_id"], current_user_id)

        if t["game_id"] is None:
            raise HTTPException(status_code=409, detail="Tournament hasn't been scheduled yet")

        slot = await conn.fetchrow(
            "SELECT * FROM social.tournament_matches WHERE id = $1 AND tournament_id = $2",
            slot_id,
            tournament_id,
        )
        if slot is None:
            raise HTTPException(status_code=404, detail="Bracket match not found")
        if slot["status"] != "ready":
            raise HTTPException(
                status_code=409,
                detail=f"This match isn't ready to start (status: {slot['status']})",
            )

        sport_row = await conn.fetchrow(
            "SELECT name, scoring_config FROM core.sports WHERE id = $1", t["sport_id"]
        )
        sport_name = sport_row["name"]
        config = sport_row["scoring_config"]
        if isinstance(config, str):
            config = json.loads(config)

        engine = get_engine(sport_name)
        initial_score = engine.initial_score(config)

        async with conn.transaction():
            match_row = await conn.fetchrow(
                """
                INSERT INTO social.matches (game_id, sport_id, started_at, score, status, format)
                VALUES ($1, $2, now(), $3::jsonb, 'in_progress', 'singles')
                RETURNING id
                """,
                t["game_id"],
                t["sport_id"],
                json.dumps(initial_score),
            )
            match_id = match_row["id"]

            await conn.execute(
                "INSERT INTO social.match_participants (match_id, user_id, team) VALUES ($1, $2, 1)",
                match_id,
                slot["player_1_user_id"],
            )
            await conn.execute(
                "INSERT INTO social.match_participants (match_id, user_id, team) VALUES ($1, $2, 2)",
                match_id,
                slot["player_2_user_id"],
            )

            await conn.execute(
                """
                UPDATE social.tournament_matches
                SET match_id = $1, status = 'in_progress'
                WHERE id = $2
                """,
                match_id,
                slot_id,
            )

            if t["status"] == "fixture_set":
                await conn.execute(
                    "UPDATE social.tournaments SET status = 'in_progress' WHERE id = $1",
                    tournament_id,
                )

    return await _fetch_tournament_match_out(slot_id)


@router.post("/{tournament_id}/matches/{slot_id}/walkover", response_model=TournamentMatchOut)
async def walkover_tournament_match(
    tournament_id: uuid.UUID,
    slot_id: uuid.UUID,
    payload: WalkoverRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        await _require_circle_member(conn, t["circle_id"], current_user_id)

        slot = await conn.fetchrow(
            "SELECT * FROM social.tournament_matches WHERE id = $1 AND tournament_id = $2",
            slot_id,
            tournament_id,
        )
        if slot is None:
            raise HTTPException(status_code=404, detail="Bracket match not found")
        if slot["status"] not in ("ready", "in_progress"):
            raise HTTPException(
                status_code=409, detail=f"Can't walkover a match with status '{slot['status']}'"
            )
        if payload.winner_user_id not in (slot["player_1_user_id"], slot["player_2_user_id"]):
            raise HTTPException(
                status_code=422, detail="Winner must be one of this match's two players"
            )

        async with conn.transaction():
            if slot["match_id"] is not None:
                await conn.execute(
                    """
                    UPDATE social.matches
                    SET status = 'abandoned', ended_at = now()
                    WHERE id = $1 AND status = 'in_progress'
                    """,
                    slot["match_id"],
                )

            await conn.execute(
                """
                UPDATE social.tournament_matches
                SET status = 'walkover', winner_user_id = $1
                WHERE id = $2
                """,
                payload.winner_user_id,
                slot_id,
            )
            await propagate_winner(conn, slot_id, payload.winner_user_id)

    return await _fetch_tournament_match_out(slot_id)
