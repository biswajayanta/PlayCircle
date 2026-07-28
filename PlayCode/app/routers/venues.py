"""
Second practice endpoint — same pattern as sports.py, but adds one new
thing: an optional query parameter (?sport=pickleball) to filter results.
This is the natural next step up from a plain "return everything" endpoint.
"""

from fastapi import APIRouter, Query
from app.db import get_pool
from app.schemas.venue import Venue

router = APIRouter(prefix="/venues", tags=["venues"])


@router.get("", response_model=list[Venue])
async def list_venues(sport: str | None = Query(default=None, description="Filter by sport code, e.g. 'pickleball'")):
    pool = get_pool()
    async with pool.acquire() as conn:
        if sport:
            rows = await conn.fetch(
                """
                SELECT v.id, v.sport_id, v.name, v.address, v.city,
                       v.latitude, v.longitude, v.is_active
                FROM core.venues v
                JOIN core.sports s ON s.id = v.sport_id
                WHERE v.is_active = true AND s.code = $1
                ORDER BY v.name
                """,
                sport,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, sport_id, name, address, city,
                       latitude, longitude, is_active
                FROM core.venues
                WHERE is_active = true
                ORDER BY name
                """
            )

    return [
        Venue(
            id=r["id"],
            sport_id=r["sport_id"],
            name=r["name"],
            address=r["address"],
            city=r["city"],
            latitude=float(r["latitude"]) if r["latitude"] is not None else None,
            longitude=float(r["longitude"]) if r["longitude"] is not None else None,
            is_active=r["is_active"],
        )
        for r in rows
    ]
