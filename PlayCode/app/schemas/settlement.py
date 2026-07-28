import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SettlementCreate(BaseModel):
    to_user_id: uuid.UUID
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    method: str = Field(default="upi", pattern="^(upi|cash|other)$")
    provider_ref: str | None = None


class SettlementOut(BaseModel):
    id: uuid.UUID
    from_user_id: uuid.UUID
    from_display_name: str
    to_user_id: uuid.UUID
    to_display_name: str
    amount: Decimal
    method: str
    status: str
    provider_ref: str | None = None
    created_at: datetime
