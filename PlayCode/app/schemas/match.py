import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

FORMAT_CAPACITY = {"singles": 1, "doubles": 2}  # players per TEAM (not per match)


class MatchParticipantIn(BaseModel):
    user_id: uuid.UUID
    team: int = Field(..., ge=1, le=2)


class MatchCreate(BaseModel):
    format: str = Field(..., pattern="^(singles|doubles)$")
    started_at: datetime | None = None  # defaults to now() if omitted
    participants: list[MatchParticipantIn] = Field(..., min_length=2)
    # Per-match overrides for sports with configurable rules. Sports that
    # don't use a given field simply ignore it. None means "use the
    # sport's default from core.sports.scoring_config".
    points_to_win: int | None = Field(default=None, ge=1)  # Carrom's board target, or Pickleball's points per set
    max_boards: int | None = Field(default=None, ge=1)  # Carrom only
    num_sets: int | None = Field(default=None, ge=1)  # Pickleball only

    @field_validator("participants")
    @classmethod
    def teams_must_be_used(cls, v: list[MatchParticipantIn]) -> list[MatchParticipantIn]:
        user_ids = [p.user_id for p in v]
        if len(user_ids) != len(set(user_ids)):
            raise ValueError("Duplicate user_id in participants")
        teams = {p.team for p in v}
        if len(teams) < 2:
            raise ValueError("A match needs participants on at least two teams")
        return v


class RecordPoint(BaseModel):
    team: int = Field(..., ge=1, le=2)
    # Defaults to 1 (pickleball's rally scoring, unchanged). Carrom sends
    # the actual board score here instead.
    points: int = Field(default=1, ge=1)


class MatchParticipantResult(BaseModel):
    user_id: uuid.UUID
    points_scored: int | None = Field(default=None, ge=0, le=200)
    result: str | None = Field(default=None, pattern="^(win|loss|draw)$")


class MatchComplete(BaseModel):
    status: str = Field(default="completed", pattern="^(completed|abandoned)$")
    ended_at: datetime | None = None  # defaults to now() if omitted
    score: dict[str, Any] | None = None
    participants: list[MatchParticipantResult] = Field(default_factory=list)


class MatchParticipantOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    team: int
    points_scored: int | None = None
    result: str | None = None


class MatchOut(BaseModel):
    id: uuid.UUID
    game_id: uuid.UUID
    sport_id: int
    sport_name: str
    format: str
    started_at: datetime
    ended_at: datetime | None = None
    score: dict[str, Any]
    status: str
    created_at: datetime


class MatchDetail(MatchOut):
    participants: list[MatchParticipantOut]
