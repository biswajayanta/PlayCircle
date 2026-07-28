import uuid
from decimal import ROUND_DOWN, Decimal

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.expense import ExpenseCreate, ExpenseDetail, ExpenseOut, ExpenseSplitOut

router = APIRouter()

_EXPENSE_COLUMNS = """
    e.id, e.game_id, e.match_id, e.description, e.amount, e.currency,
    e.paid_by_user_id, u.display_name AS paid_by_display_name, e.created_at
"""


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


def _equal_split(amount: Decimal, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    """Split amount into len(user_ids) shares of 2dp each, summing exactly to amount.
    Extra cents (from rounding) go to the first users, sorted for determinism."""
    n = len(user_ids)
    cents_total = int((amount * 100).to_integral_value(rounding=ROUND_DOWN))
    base_cents, remainder = divmod(cents_total, n)
    ordered = sorted(user_ids, key=str)
    shares = {}
    for i, uid in enumerate(ordered):
        cents = base_cents + (1 if i < remainder else 0)
        shares[uid] = (Decimal(cents) / 100).quantize(Decimal("0.01"))
    return shares


async def _fetch_expense_detail(pool, expense_id: uuid.UUID) -> ExpenseDetail:
    row = await pool.fetchrow(
        f"""
        SELECT {_EXPENSE_COLUMNS}
        FROM financial.expenses e
        JOIN core.users u ON u.id = e.paid_by_user_id
        WHERE e.id = $1
        """,
        expense_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Expense not found")

    split_rows = await pool.fetch(
        """
        SELECT es.id, es.user_id, u.display_name, es.share_amount, es.is_settled, es.settled_at
        FROM financial.expense_splits es
        JOIN core.users u ON u.id = es.user_id
        WHERE es.expense_id = $1
        ORDER BY u.display_name
        """,
        expense_id,
    )
    expense_out = ExpenseOut(**dict(row))
    return ExpenseDetail(
        **expense_out.model_dump(),
        splits=[ExpenseSplitOut(**dict(s)) for s in split_rows],
    )


@router.post("/games/{game_id}/expenses", response_model=ExpenseDetail, status_code=201)
async def create_expense(
    game_id: uuid.UUID,
    payload: ExpenseCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _require_circle_member_for_game(conn, game_id, current_user_id)

            paid_by = payload.paid_by_user_id or current_user_id
            confirmed_rows = await conn.fetch(
                "SELECT user_id FROM social.game_participants WHERE game_id = $1 AND status = 'confirmed'",
                game_id,
            )
            confirmed_ids = {r["user_id"] for r in confirmed_rows}
            if paid_by not in confirmed_ids:
                raise HTTPException(
                    status_code=422, detail="paid_by_user_id must be a confirmed participant"
                )

            if payload.match_id is not None:
                match_row = await conn.fetchrow(
                    "SELECT game_id FROM social.matches WHERE id = $1", payload.match_id
                )
                if match_row is None or match_row["game_id"] != game_id:
                    raise HTTPException(
                        status_code=422, detail="match_id does not belong to this game"
                    )

            if payload.splits is not None:
                split_user_ids = {s.user_id for s in payload.splits}
                missing = split_user_ids - confirmed_ids
                if missing:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Not confirmed participants of this game: {sorted(str(m) for m in missing)}",
                    )
                total = sum((s.share_amount for s in payload.splits), Decimal("0"))
                if total != payload.amount:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Splits sum to {total}, expected {payload.amount}",
                    )
                shares = {s.user_id: s.share_amount for s in payload.splits}
            else:
                if not confirmed_ids:
                    raise HTTPException(
                        status_code=422, detail="No confirmed participants to split the expense among"
                    )
                shares = _equal_split(payload.amount, list(confirmed_ids))

            expense_row = await conn.fetchrow(
                """
                INSERT INTO financial.expenses
                    (game_id, match_id, description, amount, currency, paid_by_user_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
                """,
                game_id,
                payload.match_id,
                payload.description,
                payload.amount,
                payload.currency.upper(),
                paid_by,
            )
            expense_id = expense_row["id"]

            for user_id, share_amount in shares.items():
                await conn.execute(
                    """
                    INSERT INTO financial.expense_splits (expense_id, user_id, share_amount)
                    VALUES ($1, $2, $3)
                    """,
                    expense_id,
                    user_id,
                    share_amount,
                )

    return await _fetch_expense_detail(pool, expense_id)


@router.get("/games/{game_id}/expenses", response_model=list[ExpenseOut])
async def list_expenses_for_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member_for_game(conn, game_id, current_user_id)

    rows = await pool.fetch(
        f"""
        SELECT {_EXPENSE_COLUMNS}
        FROM financial.expenses e
        JOIN core.users u ON u.id = e.paid_by_user_id
        WHERE e.game_id = $1
        ORDER BY e.created_at
        """,
        game_id,
    )
    return [ExpenseOut(**dict(r)) for r in rows]


@router.get("/expenses/{expense_id}", response_model=ExpenseDetail)
async def get_expense(
    expense_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    expense_row = await pool.fetchrow(
        "SELECT game_id FROM financial.expenses WHERE id = $1", expense_id
    )
    if expense_row is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    if expense_row["game_id"] is not None:
        async with pool.acquire() as conn:
            await _require_circle_member_for_game(conn, expense_row["game_id"], current_user_id)

    return await _fetch_expense_detail(pool, expense_id)


@router.patch("/expenses/{expense_id}/splits/{user_id}/settle", response_model=ExpenseDetail)
async def settle_split(
    expense_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            expense_row = await conn.fetchrow(
                "SELECT paid_by_user_id FROM financial.expenses WHERE id = $1", expense_id
            )
            if expense_row is None:
                raise HTTPException(status_code=404, detail="Expense not found")

            # Either the person who owes the split, or the person who paid the expense
            # (confirming they received the money), can mark it settled.
            if current_user_id not in (user_id, expense_row["paid_by_user_id"]):
                raise HTTPException(
                    status_code=403,
                    detail="Only the split owner or the payer can settle this split",
                )

            split_row = await conn.fetchrow(
                "SELECT is_settled FROM financial.expense_splits WHERE expense_id = $1 AND user_id = $2",
                expense_id,
                user_id,
            )
            if split_row is None:
                raise HTTPException(status_code=404, detail="Split not found for this user")
            if split_row["is_settled"]:
                raise HTTPException(status_code=409, detail="Split already settled")

            await conn.execute(
                """
                UPDATE financial.expense_splits
                SET is_settled = true, settled_at = now()
                WHERE expense_id = $1 AND user_id = $2
                """,
                expense_id,
                user_id,
            )

    return await _fetch_expense_detail(pool, expense_id)
