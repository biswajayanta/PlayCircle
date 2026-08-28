import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class ExpenseSplitIn(BaseModel):
    user_id: uuid.UUID
    share_amount: Decimal


class ExpenseCreate(BaseModel):
    description: str
    amount: Decimal
    currency: str = "INR"
    match_id: uuid.UUID | None = None
    paid_by_user_id: uuid.UUID | None = None
    splits: list[ExpenseSplitIn] | None = None


class ExpenseOut(BaseModel):
    id: uuid.UUID
    game_id: uuid.UUID | None
    match_id: uuid.UUID | None
    description: str
    amount: Decimal
    currency: str
    paid_by_user_id: uuid.UUID
    paid_by_display_name: str
    created_at: datetime


class ExpenseSplitOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    share_amount: Decimal


class ExpenseDetail(ExpenseOut):
    splits: list[ExpenseSplitOut]
