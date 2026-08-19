import json
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.report import (
    CircleLeaderboard,
    CircleReport,
    GameReport,
    LeaderboardEntry,
    MatchSummary,
    SettlementPlan,
    SettlementTransaction,
    VenueUsage,
)

router = APIRouter()


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    circle_row = await conn.fetchrow("SELECT name FROM social.circles WHERE id = $1", circle_id)
    if circle_row is None:
        raise HTTPException(status_code=404, detail="Circle not found")
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this circle")
    return circle_row["name"]


async def _require_circle_member_for_game(conn, game_id: uuid.UUID, user_id: uuid.UUID):
    game_row = await conn.fetchrow("SELECT circle_id FROM social.games WHERE id = $1", game_id)
    if game_row is None:
        raise HTTPException(status_code=404, detail="Game not found")
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        game_row["circle_id"],
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this game's circle")


def _simplify_debts(net_balances: dict[uuid.UUID, Decimal]) -> list[tuple[uuid.UUID, uuid.UUID, Decimal]]:
    """Standard greedy min-cash-flow settlement: repeatedly match the biggest
    creditor with the biggest debtor until everyone's balance is zero. Not
    guaranteed globally minimal in every edge case, but it's the well-known
    practical algorithm (same one Splitwise-style apps use) and always
    produces at most n-1 transactions for n people."""
    creditors = [[uid, bal] for uid, bal in net_balances.items() if bal > 0]
    debtors = [[uid, -bal] for uid, bal in net_balances.items() if bal < 0]
    creditors.sort(key=lambda x: x[1], reverse=True)
    debtors.sort(key=lambda x: x[1], reverse=True)

    transactions = []
    i, j = 0, 0
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt_amt = debtors[i]
        creditor_id, credit_amt = creditors[j]
        amount = min(debt_amt, credit_amt)
        if amount > 0:
            transactions.append((debtor_id, creditor_id, amount))
        debtors[i][1] -= amount
        creditors[j][1] -= amount
        if debtors[i][1] <= Decimal("0.00"):
            i += 1
        if creditors[j][1] <= Decimal("0.00"):
            j += 1
    return transactions


@router.get("/circles/{circle_id}/report", response_model=CircleReport)
async def get_circle_report(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        circle_name = await _require_circle_member(conn, circle_id, current_user_id)

        member_count = await conn.fetchval(
            "SELECT count(*) FROM social.circle_members WHERE circle_id = $1", circle_id
        )

        game_counts = await conn.fetchrow(
            """
            WITH classified AS (
                SELECT
                    g.id,
                    CASE
                        WHEN EXISTS (SELECT 1 FROM social.matches m WHERE m.game_id = g.id) THEN 'played'
                        WHEN g.status = 'cancelled' THEN 'cancelled'
                        WHEN g.scheduled_at >= now() THEN 'upcoming'
                        ELSE 'unplayed_past'
                    END AS bucket
                FROM social.games g
                WHERE g.circle_id = $1
            )
            SELECT
                count(*) FILTER (WHERE bucket = 'played') AS games_completed,
                count(*) FILTER (WHERE bucket = 'upcoming') AS games_upcoming,
                count(*) FILTER (WHERE bucket = 'cancelled') AS games_cancelled,
                count(*) FILTER (WHERE bucket = 'unplayed_past') AS games_unplayed_past,
                count(*) AS games_total
            FROM classified
            """,
            circle_id,
        )

        total_spent = await conn.fetchval(
            """
            SELECT COALESCE(sum(e.amount), 0)
            FROM financial.expenses e
            JOIN social.games g ON g.id = e.game_id
            WHERE g.circle_id = $1
            """,
            circle_id,
        )

        venue_rows = await conn.fetch(
            """
            SELECT v.name AS venue_name, count(*) AS games_count
            FROM social.games g
            JOIN core.venues v ON v.id = g.venue_id
            WHERE g.circle_id = $1
            GROUP BY v.name
            ORDER BY games_count DESC
            """,
            circle_id,
        )

    return CircleReport(
        circle_id=circle_id,
        circle_name=circle_name,
        member_count=member_count,
        games_completed=game_counts["games_completed"],
        games_upcoming=game_counts["games_upcoming"],
        games_cancelled=game_counts["games_cancelled"],
        games_unplayed_past=game_counts["games_unplayed_past"],
        games_total=game_counts["games_total"],
        total_spent=total_spent,
        venues=[VenueUsage(**dict(r)) for r in venue_rows],
    )


@router.get("/games/{game_id}/report", response_model=GameReport)
async def get_game_report(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member_for_game(conn, game_id, current_user_id)

        game_row = await conn.fetchrow(
            """
            SELECT g.scheduled_at, g.status, v.name AS venue_name
            FROM social.games g
            JOIN core.venues v ON v.id = g.venue_id
            WHERE g.id = $1
            """,
            game_id,
        )
        if game_row is None:
            raise HTTPException(status_code=404, detail="Game not found")

        total_expenses = await conn.fetchval(
            "SELECT COALESCE(sum(amount), 0) FROM financial.expenses WHERE game_id = $1",
            game_id,
        )

        match_rows = await conn.fetch(
            "SELECT id, format, started_at, ended_at, status, score FROM social.matches WHERE game_id = $1 ORDER BY started_at",
            game_id,
        )

        matches = []
        for m in match_rows:
            score = m["score"]
            if isinstance(score, str):
                score = json.loads(score)
            team_1_score = score.get("team_1", 0)
            team_2_score = score.get("team_2", 0)

            # Set-based sports (Pickleball) carry a "sets" array; board-based
            # sports (Carrom) carry their per-board detail in "history".
            # Plain rally sports have neither — nothing to drill into.
            breakdown = None
            if "sets" in score:
                breakdown = score["sets"]
            elif "boards_played" in score:
                breakdown = score.get("history", [])

            participant_rows = await conn.fetch(
                """
                SELECT u.display_name, mp.team
                FROM social.match_participants mp
                JOIN core.users u ON u.id = mp.user_id
                WHERE mp.match_id = $1
                ORDER BY u.display_name
                """,
                m["id"],
            )
            team_1_players = [p["display_name"] for p in participant_rows if p["team"] == 1]
            team_2_players = [p["display_name"] for p in participant_rows if p["team"] == 2]

            winning_team = None
            if m["status"] == "completed" and team_1_score != team_2_score:
                winning_team = team_1_players if team_1_score > team_2_score else team_2_players

            matches.append(
                MatchSummary(
                    match_id=m["id"],
                    format=m["format"],
                    started_at=m["started_at"],
                    ended_at=m["ended_at"],
                    status=m["status"],
                    team_1_players=team_1_players,
                    team_2_players=team_2_players,
                    team_1_score=team_1_score,
                    team_2_score=team_2_score,
                    winning_team=winning_team,
                    breakdown=breakdown,
                )
            )

    return GameReport(
        game_id=game_id,
        venue_name=game_row["venue_name"],
        scheduled_at=game_row["scheduled_at"],
        status=game_row["status"],
        total_expenses=total_expenses,
        matches=matches,
    )


@router.get("/games/{game_id}/settlement-plan", response_model=SettlementPlan)
async def get_settlement_plan(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member_for_game(conn, game_id, current_user_id)

        game_exists = await conn.fetchval("SELECT 1 FROM social.games WHERE id = $1", game_id)
        if not game_exists:
            raise HTTPException(status_code=404, detail="Game not found")

        # Every unsettled split is a debt: the split's user_id owes the
        # expense's paid_by_user_id that share_amount. Settled splits (the
        # payer's own share, or anything already marked paid) don't count —
        # they're already resolved.
        debt_rows = await conn.fetch(
            """
            SELECT es.user_id AS debtor_id, e.paid_by_user_id AS creditor_id, es.share_amount
            FROM financial.expense_splits es
            JOIN financial.expenses e ON e.id = es.expense_id
            WHERE e.game_id = $1 AND es.is_settled = false
            """,
            game_id,
        )

        net_balances: dict[uuid.UUID, Decimal] = {}
        for r in debt_rows:
            net_balances[r["creditor_id"]] = net_balances.get(r["creditor_id"], Decimal("0")) + r["share_amount"]
            net_balances[r["debtor_id"]] = net_balances.get(r["debtor_id"], Decimal("0")) - r["share_amount"]

        raw_transactions = _simplify_debts(net_balances)

        transactions = []
        for debtor_id, creditor_id, amount in raw_transactions:
            names = await conn.fetchrow(
                """
                SELECT
                    (SELECT display_name FROM core.users WHERE id = $1) AS from_name,
                    (SELECT display_name FROM core.users WHERE id = $2) AS to_name
                """,
                debtor_id,
                creditor_id,
            )
            transactions.append(
                SettlementTransaction(
                    from_user_id=debtor_id,
                    from_display_name=names["from_name"],
                    to_user_id=creditor_id,
                    to_display_name=names["to_name"],
                    amount=amount.quantize(Decimal("0.01")),
                )
            )

    return SettlementPlan(
        game_id=game_id,
        fully_settled=len(transactions) == 0,
        transactions=transactions,
    )


@router.get("/circles/{circle_id}/leaderboard", response_model=CircleLeaderboard)
async def get_circle_leaderboard(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, circle_id, current_user_id)

        rows = await conn.fetch(
            """
            SELECT
                u.id AS user_id,
                u.display_name,
                count(*) AS matches_played,
                count(*) FILTER (WHERE mp.result = 'win') AS wins,
                count(*) FILTER (WHERE mp.result = 'loss') AS losses
            FROM social.match_participants mp
            JOIN social.matches m ON m.id = mp.match_id
            JOIN social.games g ON g.id = m.game_id
            JOIN core.users u ON u.id = mp.user_id
            WHERE g.circle_id = $1 AND mp.result IS NOT NULL
            GROUP BY u.id, u.display_name
            ORDER BY wins DESC, matches_played DESC
            """,
            circle_id,
        )

    entries = [
        LeaderboardEntry(
            user_id=r["user_id"],
            display_name=r["display_name"],
            matches_played=r["matches_played"],
            wins=r["wins"],
            losses=r["losses"],
            win_rate=round((r["wins"] / r["matches_played"]) * 100, 1) if r["matches_played"] else 0.0,
        )
        for r in rows
    ]
    return CircleLeaderboard(circle_id=circle_id, entries=entries)
