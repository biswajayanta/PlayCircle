# OpenAI function-calling tool definitions for the PlayCircle assistant.
#
# READ_ONLY_TOOLS execute immediately when the model calls them — they can't
# change anything, so there's nothing to confirm. Any tool NOT in that set is
# treated as an action: the chat endpoint intercepts it and hands it back to
# the frontend as a "pending_action" instead of running it, so the user gets
# a chance to confirm before anything actually happens in the app.

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_my_circles",
            "description": "List the circles (groups) the current user belongs to.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_sports",
            "description": "List all active sports available in the app, with their codes "
            "(e.g. 'carrom', 'pickleball') and rules.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_venues",
            "description": "List venues, optionally filtered to ones that host a specific sport.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sport_code": {
                        "type": "string",
                        "description": "e.g. 'carrom'. Omit to list every venue.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_circle_games",
            "description": "List games in a circle, optionally only upcoming ones.",
            "parameters": {
                "type": "object",
                "properties": {
                    "circle_id": {"type": "string", "description": "UUID of the circle."},
                    "only_upcoming": {"type": "boolean", "default": True},
                },
                "required": ["circle_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_game_detail",
            "description": "Get full detail for a specific game, including its confirmed "
            "participants (needed to know who can be assigned to a match).",
            "parameters": {
                "type": "object",
                "properties": {"game_id": {"type": "string"}},
                "required": ["game_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_match_detail",
            "description": "Get full detail for a specific match: current score, status, "
            "and participants with their team assignments.",
            "parameters": {
                "type": "object",
                "properties": {"match_id": {"type": "string"}},
                "required": ["match_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_game",
            "description": "Create a new game in a circle. This is an ACTION — describe "
            "what you're about to create in your reply, then call this; the app will ask "
            "the user to confirm before it actually happens.",
            "parameters": {
                "type": "object",
                "properties": {
                    "circle_id": {"type": "string"},
                    "sport_code": {"type": "string", "description": "e.g. 'carrom'"},
                    "venue_id": {"type": "integer"},
                    "scheduled_at": {
                        "type": "string",
                        "description": "ISO 8601 datetime, e.g. 2026-08-22T18:00:00",
                    },
                },
                "required": ["circle_id", "sport_code", "venue_id", "scheduled_at"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "start_match",
            "description": "Start a new match within a game, assigning confirmed "
            "participants to teams. This is an ACTION — requires confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "game_id": {"type": "string"},
                    "format": {"type": "string", "enum": ["singles", "doubles"]},
                    "participants": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "user_id": {"type": "string"},
                                "team": {"type": "integer", "enum": [1, 2]},
                            },
                            "required": ["user_id", "team"],
                        },
                    },
                },
                "required": ["game_id", "format", "participants"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_point",
            "description": "Record a scoring event in a live match. This is an ACTION — "
            "requires confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "match_id": {"type": "string"},
                    "team": {"type": "integer", "enum": [1, 2]},
                    "points": {
                        "type": "integer",
                        "default": 1,
                        "description": "Usually 1. For board-based sports like Carrom, "
                        "this is the actual number of points that board was worth.",
                    },
                },
                "required": ["match_id", "team"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "undo_last_point",
            "description": "Undo the most recent scoring event in a live match. This is "
            "an ACTION — requires confirmation.",
            "parameters": {
                "type": "object",
                "properties": {"match_id": {"type": "string"}},
                "required": ["match_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "conclude_match",
            "description": "End a match early, before it would normally complete. This "
            "is an ACTION — requires confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "match_id": {"type": "string"},
                    "outcome": {
                        "type": "string",
                        "enum": ["winner", "draw", "cancelled"],
                        "description": "'winner' awards the win to whichever team "
                        "currently has more points.",
                    },
                },
                "required": ["match_id", "outcome"],
            },
        },
    },
]

READ_ONLY_TOOLS = {
    "list_my_circles",
    "list_sports",
    "list_venues",
    "list_circle_games",
    "get_game_detail",
    "get_match_detail",
}
