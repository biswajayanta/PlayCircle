import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    # Exactly one of email/phone must be supplied to satisfy the
    # users_identity_present CHECK constraint (phone IS NOT NULL OR email IS NOT NULL).
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str | None = None
    auth_provider: str
    auth_provider_id: str
    display_name: str
    avatar_url: str | None = None
    avatar_prompt: str | None = None
    bio: str = "" 
    city: str | None = None
    is_public: bool = True


class UserPublic(BaseModel):
    """Public-facing profile view. Excludes email/phone/auth details, respects is_public."""

    user_id: uuid.UUID
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None
    city: str | None = None


class UserMe(BaseModel):
    """Full self-view, returned only to the profile's own owner."""

    user_id: uuid.UUID
    email: str | None = None
    phone: str | None = None
    auth_provider: str
    display_name: str
    avatar_url: str | None = None
    avatar_prompt: str | None = None
    bio: str | None = None
    city: str | None = None
    is_public: bool
    show_stats: bool
    show_activity: bool
    sports_interest: str | None = None
    age: int | None = None
    age_verified: bool
    height_cm: float | None = None
    height_verified: bool
    weight_kg: float | None = None
    weight_verified: bool
    created_at: datetime
    updated_at: datetime


class ProfileUpdate(BaseModel):
    # core.users fields
    display_name: str | None = None
    avatar_url: str | None = None
    avatar_prompt: str | None = None
    # social.profiles fields — deliberately NOT including the _verified
    # flags here: nothing lets a user set their own verification status.
    bio: str | None = None
    city: str | None = None
    is_public: bool | None = None
    show_stats: bool | None = None
    show_activity: bool | None = None
    sports_interest: str | None = None
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None


class Achievement(BaseModel):
    id: uuid.UUID
    sport_id: int
    sport_name: str
    level: str
    event_name: str
    rank: str
    verified: bool
    created_at: datetime


class AchievementCreate(BaseModel):
    sport_id: int
    level: str = Field(..., min_length=1, max_length=50)
    event_name: str = Field(..., min_length=1, max_length=200)
    rank: str = Field(..., min_length=1, max_length=50)


class SportPerformance(BaseModel):
    sport_id: int
    sport_name: str
    matches_played: int
    wins: int
    losses: int
    win_rate: float
    tournaments_played: int


class UserProfile(BaseModel):
    """The richer profile view any circle-mate can see (subject to the same
    is_public check as the existing /users/{id} endpoint) — adds the sports
    details, achievements, and live-computed performance stats on top of
    what UserPublic already shows."""

    user_id: uuid.UUID
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None
    city: str | None = None
    sports_interest: str | None = None
    age: int | None = None
    age_verified: bool
    height_cm: float | None = None
    height_verified: bool
    weight_kg: float | None = None
    weight_verified: bool
    performance: list[SportPerformance]
    achievements: list[Achievement]
