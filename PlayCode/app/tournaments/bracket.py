"""
Pure knockout-bracket generation. Deliberately has zero database access —
takes a list of participant IDs, returns a plain list of dicts describing
every social.tournament_matches row to insert. Keeping this separate from
the router makes the bracket math independently testable, the same way the
sport scoring engines are kept separate from their routers.

Bye placement is mechanical, not seeding-aware: real head-to-head matches
are filled first, then remaining players each get a bye. This guarantees no
two byes ever face each other (which would be an unplayable match), but it
does NOT try to protect top seeds from meeting early the way tournament-
standard bracket seeding does. Reasonable simplification for v1.
"""
import math
import random
import uuid
from typing import Any


def build_bracket(participant_ids: list[uuid.UUID], randomize: bool) -> list[dict[str, Any]]:
    if len(participant_ids) < 2:
        raise ValueError("A tournament needs at least 2 participants")

    players = list(participant_ids)
    if randomize:
        random.shuffle(players)

    n = len(players)
    bracket_size = 1
    while bracket_size < n:
        bracket_size *= 2
    total_rounds = int(math.log2(bracket_size))
    num_first_round_matches = bracket_size // 2
    num_byes = bracket_size - n
    num_real_matches = num_first_round_matches - num_byes

    rows: list[dict[str, Any]] = []
    # Keyed "{round-2 slot index}_{p1|p2}" -> the player advancing into it
    # from a round-1 bye, so round 2 can be pre-filled where applicable.
    round2_incoming: dict[str, uuid.UUID] = {}

    idx = 0
    for match_pos in range(num_first_round_matches):
        if match_pos < num_real_matches:
            p1, p2 = players[idx], players[idx + 1]
            idx += 2
            rows.append({
                "round_number": 1,
                "position_in_round": match_pos,
                "player_1_user_id": p1,
                "player_2_user_id": p2,
                "winner_user_id": None,
                "status": "ready",
            })
        else:
            p1 = players[idx]
            idx += 1
            rows.append({
                "round_number": 1,
                "position_in_round": match_pos,
                "player_1_user_id": p1,
                "player_2_user_id": None,
                "winner_user_id": p1,
                "status": "walkover",
            })
            next_pos = match_pos // 2
            slot = "p1" if match_pos % 2 == 0 else "p2"
            round2_incoming[f"{next_pos}_{slot}"] = p1

    for round_number in range(2, total_rounds + 1):
        matches_this_round = bracket_size // (2 ** round_number)
        for match_pos in range(matches_this_round):
            p1 = round2_incoming.get(f"{match_pos}_p1") if round_number == 2 else None
            p2 = round2_incoming.get(f"{match_pos}_p2") if round_number == 2 else None
            rows.append({
                "round_number": round_number,
                "position_in_round": match_pos,
                "player_1_user_id": p1,
                "player_2_user_id": p2,
                "winner_user_id": None,
                "status": "ready" if (p1 and p2) else "pending",
            })

    return rows


def next_slot(round_number: int, position_in_round: int) -> tuple[int, int, str]:
    """Given a completed slot's round/position, returns
    (next_round_number, next_position_in_round, 'p1'|'p2') identifying
    exactly where its winner should be written next — used when propagating
    a real match's result forward, not just during initial bracket
    generation."""
    next_round = round_number + 1
    next_position = position_in_round // 2
    slot = "p1" if position_in_round % 2 == 0 else "p2"
    return next_round, next_position, slot
