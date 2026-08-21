"""
Shared pytest fixtures for the regression suite.

Strategy:
- Tests run against a real, disposable Postgres database (PLAYCIRCLE_NAME
  below), built via the actual Alembic migration chain — not a mocked DB.
  This is deliberate: the point of a regression suite here is to catch real
  breakage in real SQL, not just Python logic in isolation.
- Every test creates its own uniquely-named users/circles/games (via the
  `unique` fixture) rather than relying on transaction rollback for
  isolation. This is slightly slower but far more robust against the
  connection-pooled async app grabbing a different DB connection than the
  test's own setup code.
- The FastAPI app is exercised via httpx's ASGI transport — real request
  routing, real dependency injection, real Pydantic validation — just
  without spinning up an actual uvicorn process.
"""
import os
import subprocess
import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_DB_NAME = "playcircle_test"
# Deliberately hardcoded, not read from PLAYCIRCLE_NAME — this is a safety
# net so the suite can never be pointed at a real-looking database by
# accident. Host/port/user/password below DO respect the environment,
# since those need to vary between local dev and CI's Postgres service.

# Must be set before any `app.*` module is imported, since app.config reads
# these once at import time.
os.environ["PLAYCIRCLE_DB_HOST"] = os.environ.get("PLAYCIRCLE_DB_HOST", "127.0.0.1")
os.environ["PLAYCIRCLE_PORT"] = os.environ.get("PLAYCIRCLE_PORT", "5432")
os.environ["PLAYCIRCLE_USER"] = os.environ.get("PLAYCIRCLE_USER", "postgres")
os.environ["PLAYCIRCLE_PASSWORD"] = os.environ.get("PLAYCIRCLE_PASSWORD", "Maddy14@")
os.environ["PLAYCIRCLE_NAME"] = TEST_DB_NAME
os.environ["PLAYCIRCLE_JWT_SECRET_KEY"] = "test-only-secret-not-for-real-use"

# Set by _build_test_database's _seed() step below, read by the a_venue
# fixture further down. Module-level so it survives outside that closure.
PICKLEBALL_SPORT_ID = None


@pytest.fixture(scope="session", autouse=True)
def _build_test_database():
    """Runs once per test session: drop/recreate the test DB, then run the
    real Alembic migration chain against it — the same chain that runs in
    production, so a broken migration fails the regression suite too."""
    admin_dsn_parts = dict(
        host=os.environ["PLAYCIRCLE_DB_HOST"],
        port=os.environ["PLAYCIRCLE_PORT"],
        user=os.environ["PLAYCIRCLE_USER"],
        password=os.environ["PLAYCIRCLE_PASSWORD"],
    )

    import asyncio

    async def _recreate():
        conn = await asyncpg.connect(**admin_dsn_parts, database="postgres")
        try:
            await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"')
            await conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
        finally:
            await conn.close()

    asyncio.run(_recreate())

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run(
        ["python", "-m", "alembic", "upgrade", "head"],
        cwd=repo_root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Migration failed while building the test database:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    async def _seed():
        conn = await asyncpg.connect(**admin_dsn_parts, database=TEST_DB_NAME)
        try:
            # The migration chain itself now creates the pickleball row
            # (with code/indoor_outdoor/etc. filled in) — look it up rather
            # than inserting a second, incomplete one.
            sport_id = await conn.fetchval(
                "SELECT id FROM core.sports WHERE lower(name) = 'pickleball'"
            )
            if sport_id is None:
                raise RuntimeError(
                    "No pickleball row found after migrations ran — "
                    "expected the migration chain to have created one."
                )
            global PICKLEBALL_SPORT_ID
            PICKLEBALL_SPORT_ID = sport_id
            venue_id = await conn.fetchval(
                """
                INSERT INTO core.venues (name, address, city)
                VALUES ('Test Court', '1 Test Street', 'Bengaluru')
                RETURNING id
                """
            )
            await conn.execute(
                "INSERT INTO core.venue_sports (venue_id, sport_id) VALUES ($1, $2)",
                venue_id,
                sport_id,
            )
        finally:
            await conn.close()

    asyncio.run(_seed())

    yield


@pytest_asyncio.fixture
async def client():
    """An httpx client wired directly to the FastAPI app's ASGI interface,
    with the app's real startup/shutdown (DB pool connect/disconnect) run
    around it."""
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # Lifespan isn't triggered by ASGITransport automatically in all
        # httpx versions, so drive it explicitly.
        async with app.router.lifespan_context(app):
            yield ac


@pytest.fixture
def unique():
    """A short unique token to build collision-free emails/names per test,
    e.g. f"user-{unique}@example.com"."""
    return uuid.uuid4().hex[:10]


@pytest_asyncio.fixture
async def signed_up_user(client, unique):
    """Creates a fresh user via the real signup endpoint and returns
    (token, user_dict). Using the real endpoint (not a DB insert) means
    this fixture also continuously regression-tests signup itself."""
    email = f"user-{unique}@example.com"
    resp = await client.post(
        "/auth/signup",
        json={
            "email": email,
            "password": "testpassword123",
            "display_name": f"Test {unique[:6]}",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return {"token": data["access_token"], "user": data["user"], "email": email}


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def circle_owner(client, unique):
    """A signed-up user who has also created a circle. Returns everything
    a test is likely to need: token, user, circle."""
    signup = await client.post(
        "/auth/signup",
        json={
            "email": f"owner-{unique}@example.com",
            "password": "testpassword123",
            "display_name": f"Owner {unique[:6]}",
        },
    )
    assert signup.status_code == 201, signup.text
    token = signup.json()["access_token"]
    user = signup.json()["user"]

    circle_resp = await client.post(
        "/circles",
        json={"name": f"Test Circle {unique[:6]}"},
        headers=auth_headers(token),
    )
    assert circle_resp.status_code == 201, circle_resp.text
    circle = circle_resp.json()

    return {"token": token, "user": user, "circle": circle}


@pytest_asyncio.fixture
async def a_venue(client, circle_owner):
    """The Pickleball test venue specifically — not just 'the first venue',
    since other sports (e.g. Carrom) are now also seeded via the migration
    chain itself and may land with a lower id depending on seed order.
    Filtering by the known pickleball sport_id keeps this fixture correct
    regardless of how many other sports/venues exist."""
    resp = await client.get("/venues", headers=auth_headers(circle_owner["token"]))
    assert resp.status_code == 200, resp.text
    venues = resp.json()
    pickleball_venues = [v for v in venues if PICKLEBALL_SPORT_ID in v["sport_ids"]]
    assert len(pickleball_venues) > 0, (
        "No pickleball venue found — the test database needs seed data. "
        "Run the seed step before the test suite."
    )
    venue = pickleball_venues[0]
    # Convenience key for existing test files that build request payloads
    # with venue['sport_id'] directly — a_venue is always filtered to a
    # pickleball venue, so this is unambiguous even though the real API
    # response only has sport_ids now.
    venue["sport_id"] = PICKLEBALL_SPORT_ID
    return venue
