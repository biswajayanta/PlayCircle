import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.settlement import SettlementCreate, SettlementOut

router = APIRouter()

_SETTLEMENT_COLUMNS = """
    s.id, s.from_user_id, uf.display_name AS from_display_name,
    s.to_user_id, ut.display_name AS to_display_name,
    s.amount, s.method, s.status, s.provider_ref, s.created_at
"""


@router.post("/settlements", response_model=SettlementOut, status_code=201)
async def create_settlement(
    payload: SettlementCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    if payload.to_user_id == current_user_id:
        raise HTTPException(status_code=422, detail="Cannot settle up with yourself")

    pool = get_pool()
    to_user_exists = await pool.fetchval(
        "SELECT 1 FROM core.users WHERE id = $1", payload.to_user_id
    )
    if not to_user_exists:
        raise HTTPException(status_code=404, detail="to_user_id not found")

    row = await pool.fetchrow(
        f"""
        WITH inserted AS (
            INSERT INTO financial.settlements (from_user_id, to_user_id, amount, method, provider_ref)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, from_user_id, to_user_id, amount, method, status, provider_ref, created_at
        )
        SELECT
            inserted.id, inserted.from_user_id, uf.display_name AS from_display_name,
            inserted.to_user_id, ut.display_name AS to_display_name,
            inserted.amount, inserted.method, inserted.status, inserted.provider_ref, inserted.created_at
        FROM inserted
        JOIN core.users uf ON uf.id = inserted.from_user_id
        JOIN core.users ut ON ut.id = inserted.to_user_id
        """,
        current_user_id,
        payload.to_user_id,
        payload.amount,
        payload.method,
        payload.provider_ref,
    )
    return SettlementOut(**dict(row))


@router.get("/settlements", response_model=list[SettlementOut])
async def list_my_settlements(current_user_id: uuid.UUID = Depends(get_current_user_id)):
    pool = get_pool()
    rows = await pool.fetch(
        f"""
        SELECT {_SETTLEMENT_COLUMNS}
        FROM financial.settlements s
        JOIN core.users uf ON uf.id = s.from_user_id
        JOIN core.users ut ON ut.id = s.to_user_id
        WHERE s.from_user_id = $1 OR s.to_user_id = $1
        ORDER BY s.created_at DESC
        """,
        current_user_id,
    )
    return [SettlementOut(**dict(r)) for r in rows]


@router.patch("/settlements/{settlement_id}/complete", response_model=SettlementOut)
async def complete_settlement(
    settlement_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT from_user_id, to_user_id, status FROM financial.settlements WHERE id = $1 FOR UPDATE",
                settlement_id,
            )
            if row is None:
                raise HTTPException(status_code=404, detail="Settlement not found")
            if current_user_id not in (row["from_user_id"], row["to_user_id"]):
                raise HTTPException(status_code=403, detail="Not a party to this settlement")
            if row["status"] != "pending":
                raise HTTPException(status_code=409, detail=f"Settlement is already {row['status']}")

            await conn.execute(
                "UPDATE financial.settlements SET status = 'completed' WHERE id = $1",
                settlement_id,
            )

    result = await pool.fetchrow(
        f"""
        SELECT {_SETTLEMENT_COLUMNS}
        FROM financial.settlements s
        JOIN core.users uf ON uf.id = s.from_user_id
        JOIN core.users ut ON ut.id = s.to_user_id
        WHERE s.id = $1
        """,
        settlement_id,
    )
    return SettlementOut(**dict(result))
