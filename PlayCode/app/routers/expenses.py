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


async def _require_game_owner(conn, game_id: uuid.UUID, user_id: uuid.UUID):
    game_row = await conn.fetchrow(
        "SELECT creator_user_id, circle_id FROM social.games WHERE id = $1", game_id
    )
    if game_row is None:
        raise HTTPException(status_code=404, detail="Game not found")
    if game_row["creator_user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only the game's creator can do this")
    return game_row


async def _get_treasurer_user_id(conn, circle_id: uuid.UUID) -> uuid.UUID | None:
    return await conn.fetchval(
        "SELECT user_id FROM financial.circle_treasurers WHERE circle_id = $1", circle_id
    )


async def _get_kitty_balance(conn, circle_id: uuid.UUID, user_id: uuid.UUID) -> Decimal:
    contributed = await conn.fetchval(
        """
        SELECT COALESCE(sum(amount), 0) FROM financial.advance_contributions
        WHERE circle_id = $1 AND contributor_user_id = $2
        """,
        circle_id,
        user_id,
    )
    drawn = await conn.fetchval(
        """
        SELECT COALESCE(sum(es.drawn_from_kitty), 0)
        FROM financial.expense_splits es
        JOIN financial.expenses e ON e.id = es.expense_id
        JOIN social.games g ON g.id = e.game_id
        WHERE g.circle_id = $1 AND es.user_id = $2
        """,
        circle_id,
        user_id,
    )
    return contributed - drawn


def _equal_split(amount: Decimal, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
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
        FROM financial.expenses e JOIN core.users u ON u.id = e.paid_by_user_id
        WHERE e.id = $1
        """,
        expense_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    split_rows = await pool.fetch(
        """
        SELECT es.id, es.user_id, u.display_name, es.share_amount, es.is_settled,
            es.settled_at, es.drawn_from_kitty
        FROM financial.expense_splits es JOIN core.users u ON u.id = es.user_id
        WHERE es.expense_id = $1 ORDER BY u.display_name
        """,
        expense_id,
    )
    expense_out = ExpenseOut(**dict(row))
    return ExpenseDetail(
        **expense_out.model_dump(),
        splits=[ExpenseSplitOut(**dict(s)) for s in split_rows],
    )


@router.get("/expenses/{expense_id}", response_model=ExpenseDetail)
async def get_expense(
    expense_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    return await _fetch_expense_detail(pool, expense_id)


@router.post("/games/{game_id}/expenses", response_model=ExpenseDetail, status_code=201)
async def create_expense(
    game_id: uuid.UUID,
    payload: ExpenseCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_row = await _require_game_owner(conn, game_id, current_user_id)
            circle_id = game_row["circle_id"]

            paid_by = payload.paid_by_user_id or current_user_id
            confirmed_rows = await conn.fetch(
                "SELECT user_id FROM social.game_participants WHERE game_id = $1 AND status = 'confirmed'",
                game_id,
            )
            confirmed_ids = {r["user_id"] for r in confirmed_rows}
            if paid_by not in confirmed_ids:
                raise HTTPException(status_code=422, detail="paid_by_user_id must be a confirmed participant")

            if payload.splits is not None:
                shares = {s.user_id: s.share_amount for s in payload.splits}
            else:
                shares = _equal_split(payload.amount, list(confirmed_ids))

            expense_id = await conn.fetchval(
                """
                INSERT INTO financial.expenses (game_id, match_id, description, amount, currency, paid_by_user_id)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
                """,
                game_id, payload.match_id, payload.description, payload.amount,
                payload.currency.upper(), paid_by,
            )

            # If the treasurer is the one who paid, each other participant's
            # share is drawn from their prepaid kitty balance first — no
            # transfer needed unless their balance can't cover it. This is
            # deliberately all-or-nothing per split: either the kitty covers
            # the whole share, or the split behaves exactly like normal.
            treasurer_id = await _get_treasurer_user_id(conn, circle_id)

            for user_id, share_amount in shares.items():
                is_payer = user_id == paid_by
                drawn_from_kitty = Decimal("0")
                is_settled = is_payer

                if not is_payer and treasurer_id is not None and paid_by == treasurer_id:
                    balance = await _get_kitty_balance(conn, circle_id, user_id)
                    if balance >= share_amount:
                        drawn_from_kitty = share_amount
                        is_settled = True

                await conn.execute(
                    """
                    INSERT INTO financial.expense_splits
                        (expense_id, user_id, share_amount, is_settled, settled_at, drawn_from_kitty)
                    VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END, $5)
                    """,
                    expense_id, user_id, share_amount, is_settled, drawn_from_kitty,
                )
    return await _fetch_expense_detail(pool, expense_id)


@router.get("/games/{game_id}/expenses", response_model=list[ExpenseOut])
async def list_expenses_for_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    rows = await pool.fetch(
        f"""
        SELECT {_EXPENSE_COLUMNS}
        FROM financial.expenses e JOIN core.users u ON u.id = e.paid_by_user_id
        WHERE e.game_id = $1 ORDER BY e.created_at
        """,
        game_id,
    )
    return [ExpenseOut(**dict(r)) for r in rows]


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
                "SELECT game_id FROM financial.expenses WHERE id = $1", expense_id
            )
            if expense_row is None:
                raise HTTPException(status_code=404, detail="Expense not found")
            await _require_game_owner(conn, expense_row["game_id"], current_user_id)

            split_row = await conn.fetchrow(
                "SELECT is_settled FROM financial.expense_splits WHERE expense_id = $1 AND user_id = $2 FOR UPDATE",
                expense_id, user_id,
            )
            if split_row is None:
                raise HTTPException(status_code=404, detail="Split not found")
            if split_row["is_settled"]:
                raise HTTPException(status_code=409, detail="Already settled")

            await conn.execute(
                "UPDATE financial.expense_splits SET is_settled = true, settled_at = now() WHERE expense_id = $1 AND user_id = $2",
                expense_id, user_id,
            )
    return await _fetch_expense_detail(pool, expense_id)
