import uuid
from typing import Any

from pydantic import BaseModel, Field


class AssistantContext(BaseModel):
    """Whatever screen the chat bubble was opened from — lets the assistant
    skip asking 'which game?' when it's obvious from where the user is."""

    circle_id: uuid.UUID | None = None
    game_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None


class ChatRequest(BaseModel):
    message: str
    # The exact `messages` list returned by the previous /chat response —
    # opaque to the frontend, just stored and echoed back. This has to be
    # the *raw* message/tool-call exchange, not a simplified text history:
    # without it, the model only remembers the words of its last reply
    # ("Carrom in testMaddy, Aug 21"), not the actual game_id it looked up
    # to say that — so a follow-up like "start a match in this game" would
    # have nothing real to act on.
    history: list[dict[str, Any]] = Field(default_factory=list)
    context: AssistantContext = Field(default_factory=AssistantContext)


class PendingAction(BaseModel):
    tool_name: str
    arguments: dict[str, Any]
    description: str  # human-readable, shown in the confirm prompt


class ChatResponse(BaseModel):
    reply: str
    pending_action: PendingAction | None = None
    # Everything after the system prompt from this turn — echo this back
    # as `history` on the next request to preserve real context.
    messages: list[dict[str, Any]] = Field(default_factory=list)


class ConfirmRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any]


class ConfirmResponse(BaseModel):
    reply: str
    success: bool
    result: dict[str, Any] | None = None
