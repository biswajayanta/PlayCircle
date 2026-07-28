import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class ExpenseSplitIn(BaseModel):
    user_id: uuid.UUID
    share_amount: Decimal = Field(..., gt=0, decimal_places=2)


class ExpenseCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=200)
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    match_id: uuid.UUID | None = None
    paid_by_user_id: uuid.UUID | None = None  # defaults to the current user
    # If omitted, the amount is split equally among the game's confirmed participants.
    splits: list[ExpenseSplitIn] | None = None

    @field_validator("splits")
    @classmethod
    def no_duplicate_split_users(
        cls, v: list[ExpenseSplitIn] | None
    ) -> list[ExpenseSplitIn] | None:
        if v is None:
            return v
        user_ids = [s.user_id for s in v]
        if len(user_ids) != len(set(user_ids)):
            raise ValueError("Duplicate user_id in splits")
        return v


class ExpenseSplitOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    share_amount: Decimal
    is_settled: bool
    settled_at: datetime | None = None


class ExpenseOut(BaseModel):
    id: uuid.UUID
    game_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    description: str
    amount: Decimal
    currency: str
    paid_by_user_id: uuid.UUID
    paid_by_display_name: str
    created_at: datetime


class ExpenseDetail(ExpenseOut):
    splits: list[ExpenseSplitOut]
