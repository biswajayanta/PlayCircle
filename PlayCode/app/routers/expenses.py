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
    game_row = await conn.fetchrow(
        "SELECT creator_user_id, circle_id FROM social.games WHERE id = $1", game_id
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
        SELECT es.id, es.user_id, u.display_name, es.share_amount
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
            game_row = await _require_circle_member_for_game(conn, game_id, current_user_id)
            circle_id = game_row["circle_id"]

            paid_by = payload.paid_by_user_id or current_user_id
            payer_is_circle_member = await conn.fetchval(
                "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                paid_by,
            )
            if not payer_is_circle_member:
                raise HTTPException(status_code=422, detail="paid_by_user_id must be a member of this circle")

            confirmed_rows = await conn.fetch(
                "SELECT user_id FROM social.game_participants WHERE game_id = $1 AND status = 'confirmed'",
                game_id,
            )
            confirmed_ids = {r["user_id"] for r in confirmed_rows}

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

            for user_id, share_amount in shares.items():
                await conn.execute(
                    """
                    INSERT INTO financial.expense_splits (expense_id, user_id, share_amount)
                    VALUES ($1, $2, $3)
                    """,
                    expense_id, user_id, share_amount,
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
