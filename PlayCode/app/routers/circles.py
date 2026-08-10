import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.circle import AddMemberRequest, CircleCreate, CircleMemberOut, CircleOut

router = APIRouter()

_CIRCLE_COLUMNS = """
    c.id, c.name, c.owner_user_id, c.created_at,
    cm.role AS my_role,
    (SELECT count(*) FROM social.circle_members cm2 WHERE cm2.circle_id = c.id) AS member_count
"""


@router.post("/circles", response_model=CircleOut, status_code=201)
async def create_circle(
    payload: CircleCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            circle_row = await conn.fetchrow(
                "INSERT INTO social.circles (name, owner_user_id) VALUES ($1, $2) RETURNING id",
                payload.name,
                current_user_id,
            )
            circle_id = circle_row["id"]
            await conn.execute(
                """
                INSERT INTO social.circle_members (circle_id, user_id, role)
                VALUES ($1, $2, 'owner')
                """,
                circle_id,
                current_user_id,
            )
            row = await conn.fetchrow(
                f"""
                SELECT {_CIRCLE_COLUMNS}
                FROM social.circles c
                JOIN social.circle_members cm ON cm.circle_id = c.id AND cm.user_id = $2
                WHERE c.id = $1
                """,
                circle_id,
                current_user_id,
            )
    return CircleOut(**dict(row))


@router.get("/circles", response_model=list[CircleOut])
async def list_my_circles(current_user_id: uuid.UUID = Depends(get_current_user_id)):
    pool = get_pool()
    rows = await pool.fetch(
        f"""
        SELECT {_CIRCLE_COLUMNS}
        FROM social.circles c
        JOIN social.circle_members cm ON cm.circle_id = c.id AND cm.user_id = $1
        ORDER BY c.created_at DESC
        """,
        current_user_id,
    )
    return [CircleOut(**dict(r)) for r in rows]


@router.get("/circles/{circle_id}", response_model=CircleOut)
async def get_circle(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    row = await pool.fetchrow(
        f"""
        SELECT {_CIRCLE_COLUMNS}
        FROM social.circles c
        JOIN social.circle_members cm ON cm.circle_id = c.id AND cm.user_id = $2
        WHERE c.id = $1
        """,
        circle_id,
        current_user_id,
    )
    if row is None:
        # Same 404 whether the circle doesn't exist or you're not a member —
        # avoids confirming the existence of circles you can't see into.
        raise HTTPException(status_code=404, detail="Circle not found")
    return CircleOut(**dict(row))


@router.get("/circles/{circle_id}/members", response_model=list[CircleMemberOut])
async def list_circle_members(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    is_member = await pool.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        current_user_id,
    )
    if not is_member:
        # 404 here too, same reasoning as get_circle — don't confirm a
        # circle you can't see into even exists.
        raise HTTPException(status_code=404, detail="Circle not found")

    rows = await pool.fetch(
        """
        SELECT u.id AS user_id, u.display_name, cm.role, cm.joined_at
        FROM social.circle_members cm
        JOIN core.users u ON u.id = cm.user_id
        WHERE cm.circle_id = $1
        ORDER BY
            CASE cm.role WHEN 'owner' THEN 0 WHEN 'captain' THEN 1 ELSE 2 END,
            u.display_name
        """,
        circle_id,
    )
    return [CircleMemberOut(**dict(r)) for r in rows]


@router.post("/circles/{circle_id}/members", response_model=CircleOut, status_code=201)
async def add_member(
    circle_id: uuid.UUID,
    payload: AddMemberRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            my_role = await conn.fetchval(
                "SELECT role FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                current_user_id,
            )
            if my_role is None:
                raise HTTPException(status_code=404, detail="Circle not found")
            if my_role not in ("owner", "captain"):
                raise HTTPException(
                    status_code=403, detail="Only the circle owner or a captain can add members"
                )

            if payload.user_id is not None:
                target_id = payload.user_id
                target_exists = await conn.fetchval(
                    "SELECT 1 FROM core.users WHERE id = $1", target_id
                )
                if not target_exists:
                    raise HTTPException(status_code=404, detail="User not found")
            else:
                target_id = await conn.fetchval(
                    "SELECT id FROM core.users WHERE email = $1", payload.email
                )
                if target_id is None:
                    raise HTTPException(
                        status_code=404, detail="No registered user with that email"
                    )

            already_member = await conn.fetchval(
                "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                target_id,
            )
            if already_member:
                raise HTTPException(status_code=409, detail="Already a member of this circle")

            await conn.execute(
                "INSERT INTO social.circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')",
                circle_id,
                target_id,
            )

            row = await conn.fetchrow(
                f"""
                SELECT {_CIRCLE_COLUMNS}
                FROM social.circles c
                JOIN social.circle_members cm ON cm.circle_id = c.id AND cm.user_id = $2
                WHERE c.id = $1
                """,
                circle_id,
                current_user_id,
            )
    return CircleOut(**dict(row))


@router.post("/circles/{circle_id}/join", response_model=CircleOut, status_code=201)
async def join_circle(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    circle_exists = await pool.fetchval("SELECT 1 FROM social.circles WHERE id = $1", circle_id)
    if not circle_exists:
        raise HTTPException(status_code=404, detail="Circle not found")

    already_member = await pool.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        current_user_id,
    )
    if already_member:
        raise HTTPException(status_code=409, detail="Already a member of this circle")

    await pool.execute(
        "INSERT INTO social.circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')",
        circle_id,
        current_user_id,
    )
    row = await pool.fetchrow(
        f"""
        SELECT {_CIRCLE_COLUMNS}
        FROM social.circles c
        JOIN social.circle_members cm ON cm.circle_id = c.id AND cm.user_id = $2
        WHERE c.id = $1
        """,
        circle_id,
        current_user_id,
    )
    return CircleOut(**dict(row))


@router.delete("/circles/{circle_id}/members/{user_id}", status_code=204)
async def remove_member(
    circle_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Owner removes someone else from the circle. Their history (games,
    expenses, matches) is untouched — this only deletes the membership row,
    so they can rejoin later and everything they were part of is still
    there."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            circle_row = await conn.fetchrow(
                "SELECT owner_user_id FROM social.circles WHERE id = $1", circle_id
            )
            if circle_row is None:
                raise HTTPException(status_code=404, detail="Circle not found")
            if circle_row["owner_user_id"] != current_user_id:
                raise HTTPException(
                    status_code=403, detail="Only the circle owner can remove members"
                )
            if user_id == circle_row["owner_user_id"]:
                raise HTTPException(status_code=422, detail="The owner can't be removed")

            deleted = await conn.execute(
                "DELETE FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                user_id,
            )
            if deleted == "DELETE 0":
                raise HTTPException(status_code=404, detail="That person isn't a member")


@router.post("/circles/{circle_id}/leave", status_code=204)
async def leave_circle(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Self-leave. Same history-preservation as remove_member — only the
    membership row goes away."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            circle_row = await conn.fetchrow(
                "SELECT owner_user_id FROM social.circles WHERE id = $1", circle_id
            )
            if circle_row is None:
                raise HTTPException(status_code=404, detail="Circle not found")
            if circle_row["owner_user_id"] == current_user_id:
                raise HTTPException(
                    status_code=422, detail="Owners can't leave their own circle"
                )

            deleted = await conn.execute(
                "DELETE FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
                circle_id,
                current_user_id,
            )
            if deleted == "DELETE 0":
                raise HTTPException(status_code=404, detail="You're not a member of this circle")
