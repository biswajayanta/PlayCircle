import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.ledger import (
    CircleLedger,
    LedgerBalance,
    LedgerEntry,
    SettlementSuggestion,
    TransferCreate,
    TransferOut,
)

router = APIRouter()


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    circle_row = await conn.fetchrow("SELECT id FROM social.circles WHERE id = $1", circle_id)
    if circle_row is None:
        raise HTTPException(status_code=404, detail="Circle not found")
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this circle")


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


@router.post("/circles/{circle_id}/transfers", response_model=TransferOut, status_code=201)
async def create_transfer(
    circle_id: uuid.UUID,
    payload: TransferCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    if payload.from_user_id == payload.to_user_id:
        raise HTTPException(status_code=422, detail="from_user_id and to_user_id must differ")

    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _require_circle_member(conn, circle_id, current_user_id)

            member_rows = await conn.fetch(
                "SELECT user_id FROM social.circle_members WHERE circle_id = $1 AND user_id = ANY($2::uuid[])",
                circle_id,
                [payload.from_user_id, payload.to_user_id],
            )
            member_ids = {r["user_id"] for r in member_rows}
            if payload.from_user_id not in member_ids or payload.to_user_id not in member_ids:
                raise HTTPException(
                    status_code=422, detail="Both from_user_id and to_user_id must be members of this circle"
                )

            row = await conn.fetchrow(
                """
                WITH inserted AS (
                    INSERT INTO financial.circle_transfers
                        (circle_id, from_user_id, to_user_id, amount, note, recorded_by_user_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id, circle_id, from_user_id, to_user_id, amount, note,
                        recorded_by_user_id, created_at
                )
                SELECT
                    inserted.id, inserted.circle_id,
                    inserted.from_user_id, uf.display_name AS from_display_name,
                    inserted.to_user_id, ut.display_name AS to_display_name,
                    inserted.amount, inserted.note, inserted.recorded_by_user_id, inserted.created_at
                FROM inserted
                JOIN core.users uf ON uf.id = inserted.from_user_id
                JOIN core.users ut ON ut.id = inserted.to_user_id
                """,
                circle_id,
                payload.from_user_id,
                payload.to_user_id,
                payload.amount,
                payload.note,
                current_user_id,
            )
    return TransferOut(**dict(row))


@router.get("/circles/{circle_id}/ledger", response_model=CircleLedger)
async def get_circle_ledger(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, circle_id, current_user_id)

        member_rows = await conn.fetch(
            """
            SELECT u.id AS user_id, u.display_name
            FROM social.circle_members cm
            JOIN core.users u ON u.id = cm.user_id
            WHERE cm.circle_id = $1
            ORDER BY u.display_name
            """,
            circle_id,
        )

        paid_rows = await conn.fetch(
            """
            SELECT e.paid_by_user_id AS user_id, sum(e.amount) AS total
            FROM financial.expenses e
            JOIN social.games g ON g.id = e.game_id
            WHERE g.circle_id = $1
            GROUP BY e.paid_by_user_id
            """,
            circle_id,
        )
        owed_rows = await conn.fetch(
            """
            SELECT es.user_id, sum(es.share_amount) AS total
            FROM financial.expense_splits es
            JOIN financial.expenses e ON e.id = es.expense_id
            JOIN social.games g ON g.id = e.game_id
            WHERE g.circle_id = $1
            GROUP BY es.user_id
            """,
            circle_id,
        )
        transferred_out_rows = await conn.fetch(
            """
            SELECT from_user_id AS user_id, sum(amount) AS total
            FROM financial.circle_transfers
            WHERE circle_id = $1
            GROUP BY from_user_id
            """,
            circle_id,
        )
        transferred_in_rows = await conn.fetch(
            """
            SELECT to_user_id AS user_id, sum(amount) AS total
            FROM financial.circle_transfers
            WHERE circle_id = $1
            GROUP BY to_user_id
            """,
            circle_id,
        )

        paid = {r["user_id"]: r["total"] for r in paid_rows}
        owed = {r["user_id"]: r["total"] for r in owed_rows}
        transferred_out = {r["user_id"]: r["total"] for r in transferred_out_rows}
        transferred_in = {r["user_id"]: r["total"] for r in transferred_in_rows}

        net_balances: dict[uuid.UUID, Decimal] = {}
        balances = []
        for m in member_rows:
            uid = m["user_id"]
            balance = (
                paid.get(uid, Decimal("0"))
                - owed.get(uid, Decimal("0"))
                + transferred_out.get(uid, Decimal("0"))
                - transferred_in.get(uid, Decimal("0"))
            )
            net_balances[uid] = balance
            balances.append(LedgerBalance(user_id=uid, display_name=m["display_name"], balance=balance))

        raw_transactions = _simplify_debts(net_balances)
        display_names = {m["user_id"]: m["display_name"] for m in member_rows}
        suggested_settlements = [
            SettlementSuggestion(
                from_user_id=debtor_id,
                from_display_name=display_names[debtor_id],
                to_user_id=creditor_id,
                to_display_name=display_names[creditor_id],
                amount=amount.quantize(Decimal("0.01")),
            )
            for debtor_id, creditor_id, amount in raw_transactions
        ]

        expense_rows = await conn.fetch(
            """
            SELECT e.id, e.game_id, e.description, e.amount, e.created_at, u.display_name AS paid_by_display_name
            FROM financial.expenses e
            JOIN social.games g ON g.id = e.game_id
            JOIN core.users u ON u.id = e.paid_by_user_id
            WHERE g.circle_id = $1
            """,
            circle_id,
        )
        transfer_rows = await conn.fetch(
            """
            SELECT ct.id, ct.amount, ct.note, ct.created_at,
                uf.display_name AS from_display_name, ut.display_name AS to_display_name
            FROM financial.circle_transfers ct
            JOIN core.users uf ON uf.id = ct.from_user_id
            JOIN core.users ut ON ut.id = ct.to_user_id
            WHERE ct.circle_id = $1
            """,
            circle_id,
        )

        entries = [
            LedgerEntry(
                kind="expense",
                id=r["id"],
                description=r["description"],
                amount=r["amount"],
                created_at=r["created_at"],
                game_id=r["game_id"],
                paid_by_display_name=r["paid_by_display_name"],
            )
            for r in expense_rows
        ] + [
            LedgerEntry(
                kind="transfer",
                id=r["id"],
                # The payer/recipient are already their own columns in the
                # ledger UI, so the fallback here is deliberately generic
                # rather than repeating "X to Y".
                description=r["note"] or "Payment",
                amount=r["amount"],
                created_at=r["created_at"],
                from_display_name=r["from_display_name"],
                to_display_name=r["to_display_name"],
            )
            for r in transfer_rows
        ]
        entries.sort(key=lambda e: e.created_at, reverse=True)

    return CircleLedger(
        circle_id=circle_id,
        balances=balances,
        suggested_settlements=suggested_settlements,
        fully_settled=len(suggested_settlements) == 0,
        entries=entries,
    )
