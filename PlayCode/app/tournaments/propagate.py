"""
Shared winner-propagation logic for tournament brackets. Called from
whichever path just produced a winner for a tournament_matches row — a real
scored match auto-completing, a manual conclude, or a walkover — so all
three can't drift out of sync with each other by each implementing their
own copy of "find the next slot and fill it in."
"""
import uuid

from app.tournaments.bracket import next_slot


async def propagate_winner(conn, tournament_match_id: uuid.UUID, winner_user_id: uuid.UUID) -> None:
    tm = await conn.fetchrow(
        """
        SELECT tournament_id, round_number, position_in_round
        FROM social.tournament_matches WHERE id = $1
        """,
        tournament_match_id,
    )
    if tm is None:
        return

    next_round, next_position, slot = next_slot(tm["round_number"], tm["position_in_round"])

    next_row = await conn.fetchrow(
        """
        SELECT id, player_1_user_id, player_2_user_id
        FROM social.tournament_matches
        WHERE tournament_id = $1 AND round_number = $2 AND position_in_round = $3
        """,
        tm["tournament_id"],
        next_round,
        next_position,
    )

    if next_row is None:
        # No next round exists — this WAS the final. The tournament is done.
        await conn.execute(
            "UPDATE social.tournaments SET status = 'completed' WHERE id = $1",
            tm["tournament_id"],
        )
        return

    if slot == "p1":
        await conn.execute(
            "UPDATE social.tournament_matches SET player_1_user_id = $1 WHERE id = $2",
            winner_user_id,
            next_row["id"],
        )
        other_player = next_row["player_2_user_id"]
    else:
        await conn.execute(
            "UPDATE social.tournament_matches SET player_2_user_id = $1 WHERE id = $2",
            winner_user_id,
            next_row["id"],
        )
        other_player = next_row["player_1_user_id"]

    if other_player is not None:
        await conn.execute(
            "UPDATE social.tournament_matches SET status = 'ready' WHERE id = $1",
            next_row["id"],
        )
