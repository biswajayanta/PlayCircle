"""
Executes a tool call by hitting the app's own REST API over loopback HTTP,
using the requesting user's own JWT — the same way the mobile app itself
would. Deliberately NOT calling internal route-handler functions directly:
that would require this file to track every handler's exact name and
signature by hand, and silently drift out of sync the moment a handler
changes. Going through the real HTTP contract means the assistant can never
do anything a human couldn't already do by tapping the equivalent button,
and it can never be wrong about how an endpoint currently behaves.
"""

import httpx

_BASE_URL = "http://127.0.0.1:8000"


async def _call(method: str, path: str, token: str, json_body: dict | None = None) -> dict:
    async with httpx.AsyncClient(base_url=_BASE_URL, timeout=10.0) as client:
        resp = await client.request(
            method, path, json=json_body, headers={"Authorization": f"Bearer {token}"}
        )
        resp.raise_for_status()
        return resp.json() if resp.content else {}


async def execute_tool(tool_name: str, arguments: dict, token: str) -> dict:
    if tool_name == "list_my_circles":
        return await _call("GET", "/circles", token)

    if tool_name == "list_sports":
        return await _call("GET", "/sports", token)

    if tool_name == "list_venues":
        query = f"?sport={arguments['sport_code']}" if arguments.get("sport_code") else ""
        return await _call("GET", f"/venues{query}", token)

    if tool_name == "list_circle_games":
        return await _call("GET", f"/games?circle_id={arguments['circle_id']}", token)

    if tool_name == "get_game_detail":
        return await _call("GET", f"/games/{arguments['game_id']}", token)

    if tool_name == "get_match_detail":
        return await _call("GET", f"/matches/{arguments['match_id']}", token)

    if tool_name == "create_game":
        # The model only ever supplies a sport_code (e.g. 'carrom'), never a
        # numeric sport_id — resolving that here means it can't hallucinate
        # a wrong ID even if it never called list_sports first.
        sports = await _call("GET", "/sports", token)
        matched = next((s for s in sports if s["code"] == arguments["sport_code"]), None)
        if matched is None:
            raise ValueError(f"Unknown sport code: {arguments['sport_code']}")
        return await _call(
            "POST",
            "/games",
            token,
            {
                "circle_id": arguments["circle_id"],
                "sport_id": matched["id"],
                "venue_id": arguments["venue_id"],
                "scheduled_at": arguments["scheduled_at"],
            },
        )

    if tool_name == "start_match":
        return await _call(
            "POST",
            f"/games/{arguments['game_id']}/matches",
            token,
            {"format": arguments["format"], "participants": arguments["participants"]},
        )

    if tool_name == "record_point":
        return await _call(
            "POST",
            f"/matches/{arguments['match_id']}/points",
            token,
            {"team": arguments["team"], "points": arguments.get("points", 1)},
        )

    if tool_name == "undo_last_point":
        return await _call("POST", f"/matches/{arguments['match_id']}/undo", token)

    if tool_name == "conclude_match":
        match_id = arguments["match_id"]
        outcome = arguments["outcome"]

        if outcome == "cancelled":
            return await _call(
                "PATCH", f"/matches/{match_id}/complete", token, {"status": "abandoned"}
            )

        # 'winner' / 'draw' need per-participant results computed from the
        # match's current score — fetch it first rather than trusting the
        # model to have tracked it accurately across the conversation.
        match = await _call("GET", f"/matches/{match_id}", token)
        t1 = match["score"].get("team_1", 0)
        t2 = match["score"].get("team_2", 0)
        leader = 1 if t1 > t2 else 2 if t2 > t1 else None

        participants = []
        for p in match["participants"]:
            team_score = t1 if p["team"] == 1 else t2
            if outcome == "draw":
                result = "draw"
            else:
                result = "win" if p["team"] == leader else "loss"
            participants.append(
                {"user_id": p["user_id"], "points_scored": team_score, "result": result}
            )

        return await _call(
            "PATCH",
            f"/matches/{match_id}/complete",
            token,
            {"status": "completed", "participants": participants},
        )

    raise ValueError(f"Unknown tool: {tool_name}")
