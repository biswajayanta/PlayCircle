# PlayCircle

A social sports app for organizing pickleball games — circles, games,
live scoring, expense splitting, and a feed — starting with pickleball,
built to extend to other sports.

## Repo structure

```
PlayCircle/
├── PlayCode/                  # Backend — FastAPI + PostgreSQL (asyncpg, raw SQL)
│   ├── app/
│   │   ├── routers/           # One file per resource (circles, games, matches, ...)
│   │   ├── schemas/           # Pydantic request/response models
│   │   ├── scoring/           # Pluggable per-sport scoring engines
│   │   ├── main.py            # App entrypoint
│   │   ├── config.py          # Settings (reads from .env / env vars)
│   │   └── db.py              # asyncpg connection pool
│   ├── alembic/                # Database migrations — see "Database changes" below
│   ├── requirements.txt
│   ├── startup.sh              # Production start command (used by Azure App Service)
│   └── PlayCircleApp/          # Frontend — Expo (React Native + Expo Router), web-first
│       ├── app/                 # Screens (file-based routing)
│       ├── lib/                 # API client, auth, types
│       └── package.json
├── .github/workflows/          # CI/CD — see below
└── AZURE_DEPLOYMENT.md         # Azure setup guide
```

Yes, the frontend lives *inside* `PlayCode/`. Not the cleanest layout, but
it's the real structure this project grew from — see `.github/workflows/`
for how CI correctly scopes backend vs. frontend triggers around it.

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

## Branching & workflow

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Deployment

Backend deploys to Azure App Service, frontend to Azure Static Web Apps,
both via GitHub Actions on merge to `main`. See `AZURE_DEPLOYMENT.md` for
one-time setup and `.github/workflows/` for the pipelines themselves.
