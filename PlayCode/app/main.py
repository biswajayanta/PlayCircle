import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import connect_db, disconnect_db
from app.routers import auth, circles, expenses, games, health, matches, posts, reports, settlements, sports, treasury, users, venues, assistant, tournaments

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await disconnect_db()


app = FastAPI(title="PlayCircle API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(sports.router)
app.include_router(venues.router)
app.include_router(users.router)
app.include_router(circles.router)
app.include_router(games.router)
app.include_router(matches.router)
app.include_router(expenses.router)
app.include_router(settlements.router)
app.include_router(posts.router)
app.include_router(reports.router)
app.include_router(treasury.router)
app.include_router(assistant.router)
app.include_router(tournaments.router)
