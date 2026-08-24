import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TournamentCreate(BaseModel):
    circle_id: uuid.UUID
    sport_id: int
    name: str = Field(..., min_length=1, max_length=200)


class TournamentOut(BaseModel):
    id: uuid.UUID
    circle_id: uuid.UUID
    circle_name: str
    sport_id: int
    sport_name: str
    name: str
    creator_user_id: uuid.UUID
    format: str
    status: str
    game_id: uuid.UUID | None
    participant_count: int
    created_at: datetime


class AddParticipantRequest(BaseModel):
    user_id: uuid.UUID


class TournamentParticipantOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    joined_at: datetime


class GenerateBracketRequest(BaseModel):
    # Exactly one of these two — validated in the router, not here, since
    # the error needs to reference both fields together.
    seeding: list[uuid.UUID] | None = None
    random_seed: bool = False


class TournamentMatchOut(BaseModel):
    id: uuid.UUID
    round_number: int
    position_in_round: int
    player_1_user_id: uuid.UUID | None
    player_1_display_name: str | None
    player_2_user_id: uuid.UUID | None
    player_2_display_name: str | None
    winner_user_id: uuid.UUID | None
    match_id: uuid.UUID | None
    status: str


class BracketOut(BaseModel):
    tournament_id: uuid.UUID
    total_rounds: int
    matches: list[TournamentMatchOut]


class WalkoverRequest(BaseModel):
    winner_user_id: uuid.UUID


class ScheduleTournamentRequest(BaseModel):
    venue_id: int
    scheduled_at: datetime
