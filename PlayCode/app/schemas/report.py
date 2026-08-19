import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel


class VenueUsage(BaseModel):
    venue_name: str
    games_count: int


class CircleReport(BaseModel):
    circle_id: uuid.UUID
    circle_name: str
    member_count: int
    games_completed: int
    games_upcoming: int
    games_cancelled: int
    games_unplayed_past: int
    games_total: int
    total_spent: Decimal
    venues: list[VenueUsage]


class MatchSummary(BaseModel):
    match_id: uuid.UUID
    format: str
    started_at: datetime
    ended_at: datetime | None
    status: str
    team_1_players: list[str]
    team_2_players: list[str]
    team_1_score: int
    team_2_score: int
    winning_team: list[str] | None  # display names of the winning team, if decided
    # Per-set breakdown for set-based sports (Pickleball: [{"team_1":..,
    # "team_2":.., "winner":..}]) or per-board breakdown for board-based
    # sports (Carrom: [{"team":.., "points":..}]). None for sports with no
    # sub-match detail to drill into.
    breakdown: list[dict[str, Any]] | None = None


class GameReport(BaseModel):
    game_id: uuid.UUID
    venue_name: str
    scheduled_at: datetime
    status: str
    total_expenses: Decimal
    matches: list[MatchSummary]


class SettlementTransaction(BaseModel):
    from_user_id: uuid.UUID
    from_display_name: str
    to_user_id: uuid.UUID
    to_display_name: str
    amount: Decimal


class SettlementPlan(BaseModel):
    game_id: uuid.UUID
    fully_settled: bool
    transactions: list[SettlementTransaction]


class LeaderboardEntry(BaseModel):
    user_id: uuid.UUID
    display_name: str
    matches_played: int
    wins: int
    losses: int
    win_rate: float


class CircleLeaderboard(BaseModel):
    circle_id: uuid.UUID
    entries: list[LeaderboardEntry]
