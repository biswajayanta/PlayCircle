import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.treasury import (
    AdvanceContributionCreate,
    AdvanceContributionOut,
    MemberKittyBalance,
    SetTreasurerRequest,
    TreasurerOut,
    TreasuryOut,
)

router = APIRouter()


async def _require_circle_owner(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    owner_id = await conn.fetchval(
        "SELECT owner_user_id FROM social.circles WHERE id = $1", circle_id
    )
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Circle not found")
    if owner_id != user_id:
        raise HTTPException(status_code=403, detail="Only the circle owner can do this")


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=404, detail="Circle not found")


async def _get_treasurer_row(conn, circle_id: uuid.UUID):
    return await conn.fetchrow(
        """
        SELECT t.circle_id, t.user_id, u.display_name, t.set_by_user_id, t.created_at
        FROM financial.circle_treasurers t
        JOIN core.users u ON u.id = t.user_id
        WHERE t.circle_id = $1
        """,
        circle_id,
    )


async def _get_pool_liability(conn, circle_id: uuid.UUID):
    """The treasurer's balance isn't tied to a specific person's identity —
    it's a circle-level pool: how much of everyone's advance money is still
    outstanding. Whoever currently holds the treasurer role inherits this
    automatically, which is exactly why changing treasurers doesn't need any
    explicit balance-transfer bookkeeping."""
    total_contributed = await conn.fetchval(
        "SELECT COALESCE(sum(amount), 0) FROM financial.advance_contributions WHERE circle_id = $1",
        circle_id,
    )
    total_drawn = await conn.fetchval(
        """
        SELECT COALESCE(sum(es.drawn_from_kitty), 0)
        FROM financial.expense_splits es
        JOIN financial.expenses e ON e.id = es.expense_id
        JOIN social.games g ON g.id = e.game_id
        WHERE g.circle_id = $1
        """,
        circle_id,
    )
    return -total_contributed + total_drawn


@router.post("/circles/{circle_id}/treasurer", response_model=TreasurerOut, status_code=201)
async def set_treasurer(
    circle_id: uuid.UUID,
    payload: SetTreasurerRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _require_circle_owner(conn, circle_id, current_user_id)

            is_member = await conn.fetchval(
                "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                payload.user_id,
            )
            if not is_member:
                raise HTTPException(
                    status_code=422, detail="The treasurer must be a member of this circle"
                )

            await conn.execute(
                """
                INSERT INTO financial.circle_treasurers (circle_id, user_id, set_by_user_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (circle_id) DO UPDATE
                SET user_id = $2, set_by_user_id = $3, created_at = now()
                """,
                circle_id,
                payload.user_id,
                current_user_id,
            )
            row = await _get_treasurer_row(conn, circle_id)
    return TreasurerOut(**dict(row))


@router.delete("/circles/{circle_id}/treasurer", status_code=204)
async def remove_treasurer(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _require_circle_owner(conn, circle_id, current_user_id)
            deleted = await conn.execute(
                "DELETE FROM financial.circle_treasurers WHERE circle_id = $1", circle_id
            )
            if deleted == "DELETE 0":
                raise HTTPException(status_code=404, detail="This circle has no treasurer set")


@router.post(
    "/circles/{circle_id}/advance-contributions",
    response_model=AdvanceContributionOut,
    status_code=201,
)
async def add_advance_contribution(
    circle_id: uuid.UUID,
    payload: AdvanceContributionCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            treasurer_row = await _get_treasurer_row(conn, circle_id)
            if treasurer_row is None:
                raise HTTPException(
                    status_code=422, detail="This circle doesn't have a treasurer set"
                )
            circle_owner_id = await conn.fetchval(
                "SELECT owner_user_id FROM social.circles WHERE id = $1", circle_id
            )
            if current_user_id not in (treasurer_row["user_id"], circle_owner_id):
                raise HTTPException(
                    status_code=403,
                    detail="Only the circle owner or the treasurer can record a contribution",
                )

            is_member = await conn.fetchval(
                "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                payload.contributor_user_id,
            )
            if not is_member:
                raise HTTPException(
                    status_code=422, detail="The contributor must be a member of this circle"
                )

            row = await conn.fetchrow(
                """
                INSERT INTO financial.advance_contributions
                    (circle_id, contributor_user_id, amount, note, recorded_by_user_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, contributor_user_id, amount, note, recorded_by_user_id, created_at
                """,
                circle_id,
                payload.contributor_user_id,
                payload.amount,
                payload.note,
                current_user_id,
            )
            contributor_name = await conn.fetchval(
                "SELECT display_name FROM core.users WHERE id = $1", payload.contributor_user_id
            )
    return AdvanceContributionOut(
        **dict(row), contributor_display_name=contributor_name
    )


@router.get("/circles/{circle_id}/treasury", response_model=TreasuryOut)
async def get_treasury(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, circle_id, current_user_id)
        treasurer_row = await _get_treasurer_row(conn, circle_id)

        contribution_rows = await conn.fetch(
            """
            SELECT ac.id, ac.contributor_user_id, u.display_name AS contributor_display_name,
                ac.amount, ac.note, ac.recorded_by_user_id, ac.created_at
            FROM financial.advance_contributions ac
            JOIN core.users u ON u.id = ac.contributor_user_id
            WHERE ac.circle_id = $1
            ORDER BY ac.created_at DESC
            """,
            circle_id,
        )

        balance_rows = await conn.fetch(
            """
            SELECT
                u.id AS user_id,
                u.display_name,
                COALESCE(contrib.total, 0) AS total_contributed,
                COALESCE(drawn.total, 0) AS total_drawn
            FROM social.circle_members cm
            JOIN core.users u ON u.id = cm.user_id
            LEFT JOIN (
                SELECT contributor_user_id, sum(amount) AS total
                FROM financial.advance_contributions
                WHERE circle_id = $1
                GROUP BY contributor_user_id
            ) contrib ON contrib.contributor_user_id = u.id
            LEFT JOIN (
                SELECT es.user_id, sum(es.drawn_from_kitty) AS total
                FROM financial.expense_splits es
                JOIN financial.expenses e ON e.id = es.expense_id
                JOIN social.games g ON g.id = e.game_id
                WHERE g.circle_id = $1
                GROUP BY es.user_id
            ) drawn ON drawn.user_id = u.id
            WHERE cm.circle_id = $1
                AND (contrib.total IS NOT NULL OR drawn.total IS NOT NULL)
                AND ($2::uuid IS NULL OR u.id != $2::uuid)
            ORDER BY u.display_name
            """,
            circle_id,
            treasurer_row["user_id"] if treasurer_row else None,
        )

        treasurer_pool_balance = (
            await _get_pool_liability(conn, circle_id) if treasurer_row else None
        )

    balances = [
        MemberKittyBalance(
            user_id=r["user_id"],
            display_name=r["display_name"],
            total_contributed=r["total_contributed"],
            total_drawn=r["total_drawn"],
            balance=r["total_contributed"] - r["total_drawn"],
        )
        for r in balance_rows
    ]

    return TreasuryOut(
        circle_id=circle_id,
        treasurer=TreasurerOut(**dict(treasurer_row)) if treasurer_row else None,
        treasurer_pool_balance=treasurer_pool_balance,
        balances=balances,
        contributions=[AdvanceContributionOut(**dict(r)) for r in contribution_rows],
    )
