import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class CircleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class AddMemberRequest(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    @model_validator(mode="after")
    def exactly_one_identifier(self):
        if (self.user_id is None) == (self.email is None):
            raise ValueError("Provide exactly one of user_id or email")
        return self


class CircleOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_user_id: uuid.UUID
    my_role: str
    member_count: int
    created_at: datetime
