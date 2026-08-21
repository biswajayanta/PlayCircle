"""
Second practice endpoint — same pattern as sports.py. Since a venue can now
host more than one sport (core.venue_sports, a many-to-many join table),
this returns each venue's full list of sport_ids, and supports an optional
?sport=<code> filter that matches venues hosting that sport specifically
without dropping their other sports from the response.
"""

from fastapi import APIRouter, Query
from app.db import get_pool
from app.schemas.venue import Venue

router = APIRouter(prefix="/venues", tags=["venues"])


@router.get("", response_model=list[Venue])
async def list_venues(sport: str | None = Query(default=None, description="Filter by sport code, e.g. 'pickleball'")):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT v.id, v.name, v.address, v.city, v.latitude, v.longitude, v.is_active,
               (
                   SELECT array_agg(vs.sport_id ORDER BY vs.sport_id)
                   FROM core.venue_sports vs
                   WHERE vs.venue_id = v.id
               ) AS sport_ids
        FROM core.venues v
        WHERE v.is_active = true
          AND (
              $1::text IS NULL
              OR EXISTS (
                  SELECT 1 FROM core.venue_sports vs
                  JOIN core.sports s ON s.id = vs.sport_id
                  WHERE vs.venue_id = v.id AND s.code = $1
              )
          )
        ORDER BY v.name
        """,
        sport,
    )

    return [
        Venue(
            id=r["id"],
            sport_ids=list(r["sport_ids"]) if r["sport_ids"] else [],
            name=r["name"],
            address=r["address"],
            city=r["city"],
            latitude=float(r["latitude"]) if r["latitude"] is not None else None,
            longitude=float(r["longitude"]) if r["longitude"] is not None else None,
            is_active=r["is_active"],
        )
        for r in rows
    ]
