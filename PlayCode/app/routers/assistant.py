import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from openai import AsyncOpenAI

from app.assistant.dispatcher import execute_tool
from app.assistant.tools import READ_ONLY_TOOLS, TOOLS
from app.config import settings
from app.deps import get_current_user_id
from app.schemas.assistant import (
    ChatRequest,
    ChatResponse,
    ConfirmRequest,
    ConfirmResponse,
    PendingAction,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])
_bearer_scheme = HTTPBearer(auto_error=False)
_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

# Adjust to whichever OpenAI model you actually have access to / prefer —
# this is just a reasonable default, not verified against your account.
_MODEL = "gpt-4o"

_SYSTEM_PROMPT = """You are PlayCircle's in-app assistant, helping a user \
manage sports games and matches by talking to them naturally. You have \
tools to look things up (circles, sports, venues, games, matches) and tools \
to take action (create a game, start a match, record a point, undo, \
conclude a match).

Rules:
- Use read tools freely and immediately to look up whatever you need before \
answering or acting.
- Never fabricate an ID (circle_id, venue_id, user_id, match_id, game_id) — \
always resolve it via a read tool, or from what's already in the \
conversation or the current screen context.
- When you're ready to take an action (create_game, start_match, \
record_point, undo_last_point, conclude_match), call that action tool \
IMMEDIATELY, in this same response, alongside a short plain-language \
sentence describing what you're about to do. Do NOT ask the user "do you \
want me to proceed?" in plain text and wait for them to reply "yes" before \
calling the tool — the app already shows the user a real Confirm/Cancel \
button the moment you call the tool, so asking for permission in words \
first just creates a second, confusing round of asking. If you describe an \
action without calling its tool in that same response, the user sees only \
your sentence and has no button to act on — always call the tool the \
moment you've decided to propose the action, never one turn later.
- Keep replies brief and conversational.
"""


async def _extract_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return credentials.credentials


def _fallback_description(tool_name: str, arguments: dict) -> str:
    """Only used if the model didn't write its own sentence, despite the
    system prompt telling it to — a genuinely readable message beats a bare
    tool name even in that fallback case."""
    if tool_name == "create_game":
        return f"Create a {arguments.get('sport_code', 'game')} game at venue {arguments.get('venue_id')}, {arguments.get('scheduled_at')}?"
    if tool_name == "start_match":
        return f"Start a {arguments.get('format', '')} match for game {arguments.get('game_id')}?"
    if tool_name == "record_point":
        return f"Record {arguments.get('points', 1)} point(s) for team {arguments.get('team')}?"
    if tool_name == "undo_last_point":
        return "Undo the last scoring event?"
    if tool_name == "conclude_match":
        return f"Conclude this match as '{arguments.get('outcome')}'?"
    return f"Run {tool_name}?"


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
):
    token = await _extract_token(credentials)

    context_note = ""
    if payload.context.circle_id:
        context_note += f" The user is currently viewing circle {payload.context.circle_id}."
    if payload.context.game_id:
        context_note += f" The user is currently viewing game {payload.context.game_id}."
    if payload.context.match_id:
        context_note += f" The user is currently viewing match {payload.context.match_id}."

    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    context_note += (
        f" The current date and time is {now_ist.strftime('%A, %B %d, %Y, %I:%M %p')} IST. "
        f"When the user gives a relative date or time ('tomorrow', 'next Saturday', 'in an "
        f"hour'), compute it from this exact value — never guess, and never reuse a date "
        f"from earlier in the conversation without re-checking it's still correct."
    )

    messages = [{"role": "system", "content": _SYSTEM_PROMPT + context_note}]
    messages.extend(payload.history)
    messages.append({"role": "user", "content": payload.message})

    # Keep letting the model call read tools until it either replies with
    # plain text, or proposes an action tool — which gets intercepted here
    # rather than executed, so the user gets a chance to confirm it first.
    for _ in range(6):  # hard cap so a confused model can't loop forever
        resp = await _client.chat.completions.create(
            model=_MODEL,
            messages=messages,
            tools=TOOLS,
        )
        choice = resp.choices[0]

        if choice.finish_reason != "tool_calls":
            messages.append({"role": "assistant", "content": choice.message.content or ""})
            return ChatResponse(
                reply=choice.message.content or "",
                pending_action=None,
                messages=messages[1:],  # drop the system prompt — rebuilt fresh next turn
            )

        messages.append(choice.message.model_dump(exclude_none=True))

        for tool_call in choice.message.tool_calls:
            name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            if name not in READ_ONLY_TOOLS:
                description = choice.message.content or _fallback_description(name, arguments)
                # Store a plain text summary in history, not the raw
                # tool-call message — that tool call never gets a matching
                # result (execution happens via /confirm, not by replaying
                # this history), and an unanswered tool_call left in history
                # can make a later request to the API invalid.
                messages_for_history = messages[1:-1] + [
                    {
                        "role": "system",
                        "content": f"(Internal note, not shown to the user: you just proposed "
                        f"this action, awaiting their confirmation via a button — {description})",
                    }
                ]
                return ChatResponse(
                    reply=description,
                    pending_action=PendingAction(
                        tool_name=name, arguments=arguments, description=description
                    ),
                    messages=messages_for_history,
                )

            try:
                result = await execute_tool(name, arguments, token)
            except Exception as e:
                result = {"error": str(e)}

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result, default=str),
                }
            )

    return ChatResponse(
        reply="Sorry, I couldn't figure that out — try rephrasing?",
        pending_action=None,
        messages=messages[1:],
    )


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm(
    payload: ConfirmRequest,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
):
    token = await _extract_token(credentials)

    if payload.tool_name in READ_ONLY_TOOLS:
        raise HTTPException(status_code=400, detail="This action doesn't need confirmation")

    try:
        result = await execute_tool(payload.tool_name, payload.arguments, token)
    except Exception as e:
        return ConfirmResponse(reply=f"That didn't work: {e}", success=False)

    return ConfirmResponse(reply="Done!", success=True, result=result)
