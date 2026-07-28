"""
A single asyncpg connection pool, created once at app startup and reused
for every request — this is the standard pattern for async Postgres access.
No ORM here on purpose: raw SQL, same as the schema files, so there's no
extra layer translating between "what Postgres does" and "what the code
says it does."
"""

import asyncpg
from app.config import settings

# Populated on startup, torn down on shutdown — see main.py's lifespan handler.
pool: asyncpg.Pool | None = None


async def connect_db() -> None:
    global pool
    pool = await asyncpg.create_pool(
        dsn=settings.db_dsn,
        min_size=1,
        max_size=5,
    )


async def disconnect_db() -> None:
    global pool
    if pool is not None:
        await pool.close()


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("Database pool not initialized — did startup run?")
    return pool
