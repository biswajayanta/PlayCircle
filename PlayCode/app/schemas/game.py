import uuid
from datetime import datetime

from pydantic import BaseModel, Field

FORMAT_CAPACITY = {"singles": 2, "doubles": 4}


class GameCreate(BaseModel):
    sport_id: int
    venue_id: int
    circle_id: uuid.UUID
    scheduled_at: datetime
    format: str = Field(default="doubles", pattern="^(singles|doubles)$")
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
    format: str
    visibility: str
    status: str
    confirmed_count: int
    capacity: int
    created_at: datetime


class GameParticipantOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    status: str
    joined_at: datetime


class GameDetail(GameOut):
    participants: list[GameParticipantOut]
