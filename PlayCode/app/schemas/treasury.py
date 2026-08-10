import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SetTreasurerRequest(BaseModel):
    user_id: uuid.UUID


class TreasurerOut(BaseModel):
    circle_id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    set_by_user_id: uuid.UUID
    created_at: datetime


class AdvanceContributionCreate(BaseModel):
    contributor_user_id: uuid.UUID
    amount: Decimal = Field(..., gt=0)
    note: str | None = None


class AdvanceContributionOut(BaseModel):
    id: uuid.UUID
    contributor_user_id: uuid.UUID
    contributor_display_name: str
    amount: Decimal
    note: str | None
    recorded_by_user_id: uuid.UUID
    created_at: datetime


class MemberKittyBalance(BaseModel):
    user_id: uuid.UUID
    display_name: str
    total_contributed: Decimal
    total_drawn: Decimal
    balance: Decimal


class TreasuryOut(BaseModel):
    circle_id: uuid.UUID
    treasurer: TreasurerOut | None
    treasurer_pool_balance: Decimal | None
    balances: list[MemberKittyBalance]
    contributions: list[AdvanceContributionOut]
