# PlayCircle — Regression Test Plan

## Purpose

Catch real breakage before it reaches Dev (and later, UAT/Prod) — not just
syntax errors, but actual business-logic regressions: a permission check
that stops working, a scoring rule that drifts, a settlement calculation
that comes out wrong.

## Strategy

**Backend: real integration tests, not mocks.** Every test runs against a
genuine, disposable PostgreSQL database, built through the actual Alembic
migration chain — the same chain that runs in production. Requests go
through the real FastAPI app (routing, dependency injection, Pydantic
validation) via HTTP, not by calling Python functions directly. If a
migration is broken, the suite won't even get to run. If a query is wrong,
a real error comes back, not a mock's assumption.

**Isolation via unique data, not transaction rollback.** Each test creates
its own uniquely-named users/circles/games rather than relying on
per-test transaction rollback. This is deliberate: the app uses a
connection pool, and a test's setup code may not grab the same DB
connection as the code under test, which makes transactional isolation
unreliable in an async pooled context. Unique data sidesteps that
entirely, at the cost of a slightly slower, slightly messier (but
disposable) test database.

**Frontend: real browser, real backend.** The Playwright suite drives an
actual Chromium browser against the real web build and a real running
backend — the same tool and the same patterns used throughout this
project's manual verification, just formalized into a repeatable suite.

## Scope — what's covered

| Area | File | What it protects against |
|---|---|---|
| Auth | `test_auth.py` | Signup/login breaking, password reset token misuse, duplicate accounts |
| Circles | `test_circles.py` | Membership permission drift, owner-only actions leaking, remove/leave breaking history |
| Games | `test_games.py` | Capacity limits creeping back in, day-cutoff logic drifting, reschedule/cancel rules loosening |
| Matches | `test_matches.py` | Scoring engine regressions, format validation gaps, mixed singles/doubles breaking |
| Expenses | `test_expenses.py` | Owner-only creation bypassed, payer auto-settle breaking, debt-simplification math going wrong |
| Game participants | `test_game_participants.py` | Footprint checks being bypassed, creator becoming removable |
| Reports | `test_reports.py` | Bucket counts no longer summing correctly, access control gaps |

**Deliberately out of scope for now:** load/performance testing, and
exhaustive edge-case fuzzing. This suite is aimed at "did we break
something we already built," not "how much traffic can this take."

## Running locally

Backend:
```bash
cd PlayCode
pip install -r requirements-test.txt
python -m pytest tests/ -v
```
Needs a local Postgres reachable with the same credentials as your normal
`.env` (or override via `PLAYCIRCLE_DB_HOST`/`PORT`/`USER`/`PASSWORD` env
vars) — the suite builds and tears down its own `playcircle_test` database
automatically, your real `playcircle` database is never touched.

Frontend (see `PlayCircleApp/e2e/README.md` once that's added):
```bash
cd PlayCircleApp
npx playwright test
```

## CI/CD integration

The backend suite runs automatically in `deploy-backend.yml` on every push
to `dev`/`main` and every PR targeting them, using a real ephemeral
Postgres service container (not SQLite, not mocks — the same database
engine as production). The deploy step to Azure only runs if the full
suite passes first — a regression blocks the deploy, it doesn't just get
logged after the fact.

## Maintenance

When you add a feature, add its test in the same PR — the pattern in any
existing test file (fixtures from `conftest.py`, unique data via the
`unique` fixture, real HTTP calls via `client`) is meant to be copied
directly. A feature without a regression test is a feature that can silently
break later without anyone noticing until a user reports it.
