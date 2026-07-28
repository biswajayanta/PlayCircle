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
    created_at: datetime
    updated_at: datetime


class ProfileUpdate(BaseModel):
    # core.users fields
    display_name: str | None = None
    avatar_url: str | None = None
    avatar_prompt: str | None = None
    # social.profiles fields
    bio: str | None = None
    city: str | None = None
    is_public: bool | None = None
    show_stats: bool | None = None
    show_activity: bool | None = None
