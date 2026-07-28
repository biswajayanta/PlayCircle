"""
The first *real* endpoint: reads from core.sports, the table we seeded
with pickleball. Deliberately simple — no auth, no writes — this exists
to prove the full chain works end to end: FastAPI -> asyncpg -> Postgres
running in Docker -> back out as validated JSON.
"""

from fastapi import APIRouter
from app.db import get_pool
from app.schemas.sport import Sport

router = APIRouter(prefix="/sports", tags=["sports"])


@router.get("", response_model=list[Sport])
async def list_sports():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, code, name, indoor_outdoor, min_players, max_players,
                   scoring_config, calorie_coefficient, is_active
            FROM core.sports
            WHERE is_active = true
            ORDER BY name
            """
        )
    # asyncpg returns Record objects; convert to dicts so Pydantic can
    # validate them. scoring_config comes back as a JSON string from
    # Postgres's jsonb column, so it needs an explicit parse.
    import json

    return [
        Sport(
            id=r["id"],
            code=r["code"],
            name=r["name"],
            indoor_outdoor=r["indoor_outdoor"],
            min_players=r["min_players"],
            max_players=r["max_players"],
            scoring_config=json.loads(r["scoring_config"]),
            calorie_coefficient=float(r["calorie_coefficient"]),
            is_active=r["is_active"],
        )
        for r in rows
    ]
