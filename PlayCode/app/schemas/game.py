import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GameCreate(BaseModel):
    sport_id: int
    venue_id: int
    circle_id: uuid.UUID
    scheduled_at: datetime
    visibility: str = Field(default="circle", pattern="^(open|circle|private)$")


class GameOut(BaseModel):
    id: uuid.UUID
    sport_id: int
    sport_name: str
    venue_id: int
    venue_name: str
    circle_id: uuid.UUID
    circle_name: str
    creator_user_id: uuid.UUID
    scheduled_at: datetime
    visibility: str
    status: str
    confirmed_count: int
    already_joined: bool
    is_past: bool
    has_expenses: bool
    all_settled: bool
    created_at: datetime


class GameReschedule(BaseModel):
    scheduled_at: datetime


class AddParticipantRequest(BaseModel):
    user_id: uuid.UUID


class GameParticipantOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    status: str
    joined_at: datetime


class GameDetail(GameOut):
    participants: list[GameParticipantOut]
