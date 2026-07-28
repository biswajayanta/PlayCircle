from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import connect_db, disconnect_db
from app.routers import circles, expenses, games, health, matches, posts, settlements, sports, users, venues


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await disconnect_db()


app = FastAPI(title="PlayCircle API", lifespan=lifespan)

# Dev-only CORS: Expo's web dev server runs on a different port (usually 8081 or 19006)
# than this API (8000), so the browser blocks fetches unless we explicitly allow it.
# Tighten allow_origins to your real frontend URL(s) before shipping to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(sports.router)
app.include_router(venues.router)
app.include_router(users.router)
app.include_router(circles.router)
app.include_router(games.router)
app.include_router(matches.router)
app.include_router(expenses.router)
app.include_router(settlements.router)
app.include_router(posts.router)
