# PlayCircle — Backend (FastAPI, Dev MVP Step 2)

## Why this structure

```
backend/
  app/
    main.py              -- entrypoint: creates the FastAPI app, wires DB lifecycle
    config.py             -- typed settings, reads env vars via pydantic-settings
    db.py                 -- asyncpg connection pool (raw SQL, no ORM)
    routers/
      health.py           -- GET /health
      sports.py            -- GET /sports (first real endpoint, reads core.sports)
    schemas/
      sport.py             -- Pydantic response model for a Sport
  requirements.txt
  .env.example
```

**No ORM, same as the database layer.** Queries in `routers/sports.py` are
raw SQL via `asyncpg`, matching the philosophy from the schema README —
nothing hidden between you and what Postgres is actually doing. Pydantic
models (`schemas/`) are only for validating/shaping what goes *out* over
the API, not for building queries.

**Why a connection pool instead of connecting per-request:** opening a
new Postgres connection on every request is slow and wastes resources.
`db.py` opens a small pool (1–5 connections) once when the app starts
(`connect_db()`, wired into FastAPI's `lifespan` in `main.py`), and every
request borrows a connection from that pool for the duration of its query.

## Setup

1. Make sure your Dockerized Postgres is running (see the `db/` folder —
   `docker compose up -d`) and the schema + seed files have been run
   against it.

2. Create a virtual environment and install dependencies:
   ```
   python -m venv venv
   venv\Scripts\activate          (Windows)
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and adjust if your Docker Postgres
   settings differ from the defaults:
   ```
   copy .env.example .env
   ```

4. Run the server:
   ```
   uvicorn app.main:app --reload
   ```
   `--reload` restarts the server automatically when you edit code —
   useful while learning/iterating, turn it off in production.

5. Open http://127.0.0.1:8000/docs — FastAPI auto-generates interactive
   API docs from the Pydantic models. Try `/sports` right from the browser.

## What's validated so far

Both endpoints were run end-to-end in a sandboxed dev environment against
a real local Postgres with the pickleball seed data — `/health` returns
`{"status": "ok"}`, and `/sports` returns the seeded pickleball row as
validated JSON, confirming the full chain: FastAPI → asyncpg → Postgres →
Pydantic → JSON response.

## Next steps (your call which order)

- **Auth** — the next real piece of infrastructure everything else needs.
  Given Azure AD B2C was the plan, this is a good next session's focus.
- **Profile endpoints** — CRUD against `social.profiles`, tied to a
  logged-in user once auth exists.
- **A second real endpoint without auth** — e.g. `POST /sports` isn't
  useful yet, but `GET /venues` (reading `core.venues`) would be a good
  low-stakes way to practice the same pattern (router + schema + query)
  a second time before auth complexity gets added.
