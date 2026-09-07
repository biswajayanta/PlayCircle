# PlayCircle

A social sports app for organizing games within trusted groups of players —
scheduling, live match scoring (Pickleball and Carrom, others pluggable),
knockout tournaments, expense splitting, an optional "treasury" system, an
in-app AI assistant, and member profiles with sport-specific achievements.

## Repo structure

```
PlayCircle/
├── PlayCode/                  # Backend — FastAPI + PostgreSQL (asyncpg, raw SQL)
│   ├── app/
│   │   ├── routers/           # One file per resource (circles, games, matches, tournaments, users, assistant, ...)
│   │   ├── schemas/           # Pydantic request/response models
│   │   ├── scoring/           # Pluggable per-sport scoring engines (base.py, carrom.py, pickleball.py, registry.py)
│   │   ├── tournaments/       # Knockout bracket generation + winner-propagation logic (bracket.py, propagate.py)
│   │   ├── assistant/         # In-app AI assistant: tool definitions + dispatcher that calls the app's own API
│   │   ├── main.py            # App entrypoint
│   │   ├── config.py          # Settings (reads from .env / env vars)
│   │   └── db.py              # asyncpg connection pool
│   ├── alembic/                # Database migrations — see "Database changes" below
│   ├── requirements.txt
│   ├── startup.sh              # Production start command (used by Azure App Service)
│   └── PlayCircleApp/          # Frontend — Expo (React Native + Expo Router), web-first
│       ├── app/                 # Screens (file-based routing) — includes app/tournaments/, app/profile/, app/search.tsx
│       ├── components/          # Shared components — includes AssistantBubble.tsx, BracketTree.tsx
│       ├── lib/                 # API client, auth, types
│       └── package.json
├── .github/workflows/          # CI/CD — see below
└── AZURE_DEV_SETUP.md          # Azure setup guide
```

Yes, the frontend lives *inside* `PlayCode/`. Not the cleanest layout, but
it's the real structure this project grew from — see `.github/workflows/`
for how CI correctly scopes backend vs. frontend triggers around it.

## What's here

- **Sports**: Carrom (board-based, race-to-target) and Pickleball
  (set-based, configurable sets/points-per-set) as working examples of the
  pluggable scoring engine pattern — see `app/scoring/`. Adding a new sport
  means implementing the `ScoringEngine` interface in `base.py` and
  registering it in `registry.py`; nothing else in the app needs to know
  the sport exists.
- **Tournaments** (`app/tournaments/`, `app/routers/tournaments.py`):
  single-elimination knockout brackets, scoped to one circle. Once a
  tournament match actually starts, it's a completely normal
  `social.matches` row using the same scoring engines as any other match —
  the only tournament-specific logic is bracket generation and propagating
  a winner into the next round. Round 1 participants can be added, removed,
  or swapped right up until every Round 1 match is decided; positions lock
  after that.
- **AI Assistant** (`app/assistant/`, `components/AssistantBubble.tsx`):
  an in-app chat assistant that can look things up and take actions
  (create a game, start a match, record a point, conclude, walkover) by
  calling the app's own REST API with the user's own JWT — so it can never
  do anything a human couldn't already do by tapping the equivalent
  button. Every action requires explicit user confirmation before it
  executes; nothing runs on the model's say-so alone.
- **Member profiles** (`app/routers/users.py`, `app/profile/[userId].tsx`):
  search circle members, view a profile with auto-computed performance
  stats (wins/losses/win-rate per sport, tournaments played) and
  user-added achievements (sport, level, event, rank). Achievements carry
  a `verified` flag that always defaults false — verification logic
  itself isn't built yet.

## Local setup

**Backend:**
```bash
cd PlayCode
pip install -r requirements.txt
cp .env.example .env   # fill in your local Postgres credentials
python -m alembic upgrade head
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd PlayCode/PlayCircleApp
npm install
cp .env.example .env   # points at your local backend
npx expo start --web
```

## Database changes

Never edit the schema by hand with `psql`. Always use a migration:

```bash
cd PlayCode
python -m alembic revision -m "describe your change"
# edit the generated file in alembic/versions/
python -m alembic upgrade head
```

**Always dry-run a migration against a scratch database before applying it
for real** — create a throwaway DB, run the full chain against it, verify
with `\d` in psql, then drop it. This has caught real mistakes before they
touched real data; treat it as non-negotiable for anything beyond a trivial
additive column.

## Branching & workflow

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Deployment

Backend deploys to Azure App Service, frontend to Azure Static Web Apps,
both via GitHub Actions on merge to `main` (UAT) and further promotion to
Prod behind manual approval. `main` requires a Pull Request — direct
pushes are rejected by branch protection, even for the repo owner. See
`AZURE_DEV_SETUP.md` for one-time setup and `.github/workflows/` for the
pipelines themselves.
