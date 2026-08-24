"""
Pure knockout-bracket generation. Deliberately has zero database access —
takes a list of participant IDs, returns a plain list of dicts describing
every social.tournament_matches row to insert. Keeping this separate from
the router makes the bracket math independently testable, the same way the
sport scoring engines are kept separate from their routers.

Byes are NOT resolved at generation time. A round with an odd player out
just gets a slot with player_2 left null (a "TBD" opponent) and status
'ready' — startable immediately, but also editable: a new participant can
fill that TBD slot right up until someone actually starts it. The bye only
becomes a real win the moment the match is actually started with the
opponent still TBD — see start_tournament_match in the router, which is
where that resolution actually happens, not here.
"""
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
    total_rounds = _log2(bracket_size)
    num_first_round_matches = bracket_size // 2
    num_byes = bracket_size - n
    num_real_matches = num_first_round_matches - num_byes

    rows: list[dict[str, Any]] = []

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
            # Odd player out — a TBD opponent slot, not an auto-resolved
            # bye. Startable as-is, but a new joiner can also fill it.
            p1 = players[idx]
            idx += 1
            rows.append({
                "round_number": 1,
                "position_in_round": match_pos,
                "player_1_user_id": p1,
                "player_2_user_id": None,
                "winner_user_id": None,
                "status": "ready",
            })

    # Every later round starts fully empty and pending — nothing propagates
    # in until a real round-1 (or later) match actually gets started,
    # whether that's a genuine two-player match or a TBD walkover.
    for round_number in range(2, total_rounds + 1):
        matches_this_round = bracket_size // (2 ** round_number)
        for match_pos in range(matches_this_round):
            rows.append({
                "round_number": round_number,
                "position_in_round": match_pos,
                "player_1_user_id": None,
                "player_2_user_id": None,
                "winner_user_id": None,
                "status": "pending",
            })

    return rows


def _log2(n: int) -> int:
    count = 0
    while n > 1:
        n //= 2
        count += 1
    return count


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
