import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class PostMediaIn(BaseModel):
    media_type: str = Field(..., pattern="^(photo|video)$")
    url: str = Field(..., min_length=1, max_length=2000)


class PostCreate(BaseModel):
    caption: str | None = Field(default=None, max_length=2000)
    game_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    visibility: str = Field(default="public", pattern="^(public|circle|private)$")
    media: list[PostMediaIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def anchored_to_something(self):
        if self.game_id is None and self.match_id is None:
            raise ValueError("A post must be anchored to a game_id or match_id")
        return self


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


class CommentOut(BaseModel):
    id: uuid.UUID
    author_user_id: uuid.UUID
    author_display_name: str
    body: str
    created_at: datetime


class PostMediaOut(BaseModel):
    id: uuid.UUID
    media_type: str
    url: str


class PostOut(BaseModel):
    id: uuid.UUID
    game_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    author_user_id: uuid.UUID
    author_display_name: str
    caption: str | None = None
    visibility: str
    created_at: datetime
    like_count: int
    comment_count: int
    liked_by_me: bool


class PostDetail(PostOut):
    media: list[PostMediaOut]
    comments: list[CommentOut]
