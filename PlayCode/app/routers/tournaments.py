import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_pool
from app.deps import get_current_user_id
from app.scoring.registry import get_engine
from app.schemas.tournament import (
    AddParticipantRequest,
    BracketOut,
    GenerateBracketRequest,
    StartMatchRequest,
    SwapPlayersRequest,
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


async def _round1_open(conn, tournament_id: uuid.UUID) -> bool:
    """Round 1 stays open for participant changes as long as at least one
    Round 1 match hasn't reached a final state yet — even if some matches
    have already been played. True if no bracket exists yet at all, or if
    at least one Round 1 slot is still undecided."""
    total = await conn.fetchval(
        "SELECT count(*) FROM social.tournament_matches WHERE tournament_id = $1 AND round_number = 1",
        tournament_id,
    )
    if total == 0:
        return True  # no bracket yet — nothing to lock
    undecided = await conn.fetchval(
        """
        SELECT count(*) FROM social.tournament_matches
        WHERE tournament_id = $1 AND round_number = 1
          AND status NOT IN ('completed', 'walkover')
        """,
        tournament_id,
    )
    return undecided > 0


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

        hosts_sport = await conn.fetchval(
            "SELECT 1 FROM core.venue_sports WHERE venue_id = $1 AND sport_id = $2",
            payload.venue_id,
            payload.sport_id,
        )
        if not hosts_sport:
            raise HTTPException(
                status_code=422, detail="This venue doesn't host the selected sport"
            )

        async with conn.transaction():
            game_row = await conn.fetchrow(
                """
                INSERT INTO social.games
                    (sport_id, venue_id, creator_user_id, circle_id, scheduled_at, visibility, status)
                VALUES ($1, $2, $3, $4, $5, 'circle', 'open')
                RETURNING id
                """,
                payload.sport_id,
                payload.venue_id,
                current_user_id,
                payload.circle_id,
                payload.scheduled_at,
            )

            row = await conn.fetchrow(
                """
                INSERT INTO social.tournaments (circle_id, sport_id, name, creator_user_id, game_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, circle_id, sport_id, name, creator_user_id, format, status, game_id, created_at
                """,
                payload.circle_id,
                payload.sport_id,
                payload.name,
                current_user_id,
                game_row["id"],
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
        game_id=row["game_id"],
        participant_count=0,
        created_at=row["created_at"],
    )


@router.get("", response_model=list[TournamentOut])
async def list_tournaments(
    circle_id: uuid.UUID = Query(...),
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, circle_id, current_user_id)

        rows = await conn.fetch(
            """
            SELECT t.id, t.circle_id, c.name AS circle_name, t.sport_id, s.name AS sport_name,
                   t.name, t.creator_user_id, t.format, t.status, t.game_id, t.created_at,
                   (SELECT count(*) FROM social.tournament_participants tp WHERE tp.tournament_id = t.id) AS participant_count
            FROM social.tournaments t
            JOIN social.circles c ON c.id = t.circle_id
            JOIN core.sports s ON s.id = t.sport_id
            WHERE t.circle_id = $1
            ORDER BY t.created_at DESC
            """,
            circle_id,
        )
    return [TournamentOut(**dict(r)) for r in rows]


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
        if not await _round1_open(conn, tournament_id):
            raise HTTPException(
                status_code=409,
                detail="Can't add participants — the first round is already complete",
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

        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO social.tournament_participants (tournament_id, user_id)
                VALUES ($1, $2)
                RETURNING user_id, joined_at
                """,
                tournament_id,
                payload.user_id,
            )

            # If a bracket already exists, place them into it immediately —
            # prefer a fully-vacated slot (from an earlier removal) over
            # filling a standing TBD opponent slot, either way with no
            # propagation to reverse since nothing resolves until started.
            empty_slot = await conn.fetchval(
                """
                SELECT id FROM social.tournament_matches
                WHERE tournament_id = $1 AND round_number = 1
                  AND player_1_user_id IS NULL AND player_2_user_id IS NULL
                LIMIT 1
                """,
                tournament_id,
            )
            if empty_slot is not None:
                await conn.execute(
                    """
                    UPDATE social.tournament_matches
                    SET player_1_user_id = $1, status = 'ready'
                    WHERE id = $2
                    """,
                    payload.user_id,
                    empty_slot,
                )
            else:
                tbd_slot = await conn.fetchval(
                    """
                    SELECT id FROM social.tournament_matches
                    WHERE tournament_id = $1 AND round_number = 1
                      AND status = 'ready' AND player_2_user_id IS NULL
                      AND player_1_user_id IS NOT NULL
                    LIMIT 1
                    """,
                    tournament_id,
                )
                if tbd_slot is not None:
                    await conn.execute(
                        "UPDATE social.tournament_matches SET player_2_user_id = $1 WHERE id = $2",
                        payload.user_id,
                        tbd_slot,
                    )
                else:
                    bracket_exists = await conn.fetchval(
                        "SELECT count(*) FROM social.tournament_matches WHERE tournament_id = $1",
                        tournament_id,
                    )
                    if bracket_exists > 0:
                        # No open slot to fit them — growing the bracket
                        # beyond its original size isn't supported yet.
                        raise HTTPException(
                            status_code=409,
                            detail="No open slot available for this player — the "
                            "bracket is full and can't grow beyond its current size yet.",
                        )

        display_name = await conn.fetchval(
            "SELECT display_name FROM core.users WHERE id = $1", payload.user_id
        )

    return TournamentParticipantOut(
        user_id=row["user_id"], display_name=display_name, joined_at=row["joined_at"]
    )


@router.delete("/{tournament_id}/participants/{user_id}", status_code=204)
async def remove_participant(
    tournament_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        if t["creator_user_id"] != current_user_id:
            raise HTTPException(
                status_code=403, detail="Only the tournament creator can remove participants"
            )

        is_participant = await conn.fetchval(
            "SELECT 1 FROM social.tournament_participants WHERE tournament_id = $1 AND user_id = $2",
            tournament_id,
            user_id,
        )
        if not is_participant:
            raise HTTPException(status_code=404, detail="Not a participant")

        # If a bracket exists, find their Round 1 slot specifically — even
        # if Round 1 overall is still open, THEIR match might already be
        # decided (they could've already played and lost, or received/lost
        # a walkover), in which case removal isn't allowed regardless of
        # what other Round 1 matches are still pending.
        slot = await conn.fetchrow(
            """
            SELECT * FROM social.tournament_matches
            WHERE tournament_id = $1 AND round_number = 1
              AND (player_1_user_id = $2 OR player_2_user_id = $2)
            """,
            tournament_id,
            user_id,
        )
        if slot is not None and slot["status"] in ("completed", "walkover"):
            raise HTTPException(
                status_code=409,
                detail="Can't remove this player — their match has already been decided",
            )

        async with conn.transaction():
            if slot is not None:
                if slot["player_1_user_id"] == user_id and slot["player_2_user_id"] is not None:
                    await conn.execute(
                        "UPDATE social.tournament_matches SET player_1_user_id = NULL WHERE id = $1",
                        slot["id"],
                    )
                elif slot["player_2_user_id"] == user_id and slot["player_1_user_id"] is not None:
                    await conn.execute(
                        "UPDATE social.tournament_matches SET player_2_user_id = NULL WHERE id = $1",
                        slot["id"],
                    )
                else:
                    # They were the lone occupant of a TBD slot — vacate it
                    # entirely rather than delete the row, so a future
                    # joiner can reuse this exact position without any
                    # renumbering.
                    await conn.execute(
                        """
                        UPDATE social.tournament_matches
                        SET player_1_user_id = NULL, player_2_user_id = NULL, status = 'pending'
                        WHERE id = $1
                        """,
                        slot["id"],
                    )

            await conn.execute(
                "DELETE FROM social.tournament_participants WHERE tournament_id = $1 AND user_id = $2",
                tournament_id,
                user_id,
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


@router.post("/{tournament_id}/swap", response_model=BracketOut)
async def swap_players(
    tournament_id: uuid.UUID,
    payload: SwapPlayersRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Swaps the occupants of two match slots — the one generic operation
    behind every rearrangement scenario: two full matches trading a player
    each, a lone player moving into a full match (bumping that match's
    other player back into the lone player's now-vacant slot), two lone
    players trading places (each still left with a TBD opponent, not
    merged together). Restricted to Round 1 only — once a bracket reaches
    Round 2, positions are locked."""
    pool = get_pool()
    async with pool.acquire() as conn:
        t = await _get_tournament_or_404(conn, tournament_id)
        if t["creator_user_id"] != current_user_id:
            raise HTTPException(
                status_code=403, detail="Only the tournament creator can rearrange the bracket"
            )

        match_a = await conn.fetchrow(
            "SELECT * FROM social.tournament_matches WHERE id = $1 AND tournament_id = $2",
            payload.match_a_id,
            tournament_id,
        )
        match_b = await conn.fetchrow(
            "SELECT * FROM social.tournament_matches WHERE id = $1 AND tournament_id = $2",
            payload.match_b_id,
            tournament_id,
        )
        if match_a is None or match_b is None:
            raise HTTPException(status_code=404, detail="Match not found")

        for m in (match_a, match_b):
            if m["status"] in ("in_progress", "completed", "walkover"):
                raise HTTPException(
                    status_code=409,
                    detail="Can't rearrange a match that's already started or finished",
                )
            if m["round_number"] != 1:
                raise HTTPException(
                    status_code=409,
                    detail="Rearranging players is only allowed in Round 1",
                )

        if payload.match_a_id == payload.match_b_id and payload.slot_a == payload.slot_b:
            raise HTTPException(status_code=422, detail="Can't swap a slot with itself")

        value_a = match_a[f"{payload.slot_a}_user_id"]
        value_b = match_b[f"{payload.slot_b}_user_id"]

        async with conn.transaction():
            if payload.slot_a == "player_1":
                await conn.execute(
                    "UPDATE social.tournament_matches SET player_1_user_id = $1 WHERE id = $2",
                    value_b,
                    payload.match_a_id,
                )
            else:
                await conn.execute(
                    "UPDATE social.tournament_matches SET player_2_user_id = $1 WHERE id = $2",
                    value_b,
                    payload.match_a_id,
                )
            if payload.slot_b == "player_1":
                await conn.execute(
                    "UPDATE social.tournament_matches SET player_1_user_id = $1 WHERE id = $2",
                    value_a,
                    payload.match_b_id,
                )
            else:
                await conn.execute(
                    "UPDATE social.tournament_matches SET player_2_user_id = $1 WHERE id = $2",
                    value_a,
                    payload.match_b_id,
                )

            # Recompute status for whichever matches were actually touched
            # (dedupe in case match_a_id == match_b_id) — 'ready' once at
            # least one side is filled, 'pending' if both ended up empty.
            for match_id in {payload.match_a_id, payload.match_b_id}:
                row = await conn.fetchrow(
                    "SELECT player_1_user_id, player_2_user_id, status FROM social.tournament_matches WHERE id = $1",
                    match_id,
                )
                if row["status"] not in ("in_progress", "completed", "walkover"):
                    new_status = (
                        "ready" if (row["player_1_user_id"] or row["player_2_user_id"]) else "pending"
                    )
                    await conn.execute(
                        "UPDATE social.tournament_matches SET status = $1 WHERE id = $2",
                        new_status,
                        match_id,
                    )

    return await get_bracket(tournament_id, current_user_id)


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


@router.post("/{tournament_id}/matches/{slot_id}/start", response_model=TournamentMatchOut)
async def start_tournament_match(
    tournament_id: uuid.UUID,
    slot_id: uuid.UUID,
    payload: StartMatchRequest = StartMatchRequest(),
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Turns a 'ready' bracket slot into a real, live-scorable
    social.matches row — from this point on, scoring it uses the exact same
    /matches/{id}/points, /undo, /complete endpoints as any other match.
    Accepts the same per-match scoring overrides (points_to_win, max_boards,
    num_sets) as a regular match, since a tournament match should have the
    same configurability as any other."""
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

        # A TBD opponent (one side null) resolves as a walkover the moment
        # someone tries to start it — no real match, no scoring, just an
        # immediate advance. This is the one moment a standing bye actually
        # takes effect; before this, the slot stays editable.
        if slot["player_1_user_id"] is None or slot["player_2_user_id"] is None:
            winner_id = slot["player_1_user_id"] or slot["player_2_user_id"]
            if winner_id is None:
                raise HTTPException(
                    status_code=409, detail="This match has no players yet"
                )
            async with conn.transaction():
                await conn.execute(
                    """
                    UPDATE social.tournament_matches
                    SET status = 'walkover', winner_user_id = $1
                    WHERE id = $2
                    """,
                    winner_id,
                    slot_id,
                )
                await propagate_winner(conn, slot_id, winner_id)
            return await _fetch_tournament_match_out(slot_id)

        sport_row = await conn.fetchrow(
            "SELECT name, scoring_config FROM core.sports WHERE id = $1", t["sport_id"]
        )
        sport_name = sport_row["name"]
        default_config = sport_row["scoring_config"]
        if isinstance(default_config, str):
            default_config = json.loads(default_config)

        # Same override-merging pattern as the regular create_match endpoint
        # — start from the sport's default config, then apply whatever the
        # caller explicitly overrode.
        match_config = dict(default_config)
        if payload.points_to_win is not None:
            match_config["points_to_win"] = payload.points_to_win
        if payload.max_boards is not None:
            match_config["max_boards"] = payload.max_boards
        if payload.num_sets is not None:
            match_config["num_sets"] = payload.num_sets

        engine = get_engine(sport_name)
        initial_score = engine.initial_score(match_config)

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
