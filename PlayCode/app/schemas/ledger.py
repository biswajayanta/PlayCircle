import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class TransferCreate(BaseModel):
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    note: str | None = None


class TransferOut(BaseModel):
    id: uuid.UUID
    circle_id: uuid.UUID
    from_user_id: uuid.UUID
    from_display_name: str
    to_user_id: uuid.UUID
    to_display_name: str
    amount: Decimal
    note: str | None
    recorded_by_user_id: uuid.UUID
    created_at: datetime


class LedgerBalance(BaseModel):
    user_id: uuid.UUID
    display_name: str
    # Positive = the circle owes them money. Negative = they owe the circle.
    balance: Decimal


class LedgerEntry(BaseModel):
    """One line in the merged, chronological expense+transfer feed."""

    kind: str  # "expense" | "transfer"
    id: uuid.UUID
    description: str
    amount: Decimal
    created_at: datetime
    game_id: uuid.UUID | None = None
    paid_by_display_name: str | None = None
    from_display_name: str | None = None
    to_display_name: str | None = None


class SettlementSuggestion(BaseModel):
    from_user_id: uuid.UUID
    from_display_name: str
    to_user_id: uuid.UUID
    to_display_name: str
    amount: Decimal


class CircleLedger(BaseModel):
    circle_id: uuid.UUID
    balances: list[LedgerBalance]
    suggested_settlements: list[SettlementSuggestion]
    fully_settled: bool
    entries: list[LedgerEntry]
