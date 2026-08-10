from datetime import datetime, timedelta, timezone

from tests.conftest import auth_headers


def future_iso():
    return (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


async def _game_with_two_players(client, circle_owner, a_venue, signed_up_user):
    game_resp = await client.post(
        "/games",
        json={
            "circle_id": circle_owner["circle"]["id"],
            "sport_id": a_venue["sport_id"],
            "venue_id": a_venue["id"],
            "scheduled_at": future_iso(),
        },
        headers=auth_headers(circle_owner["token"]),
    )
    game = game_resp.json()
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
    return game


async def test_singles_match_requires_exactly_1v1(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "singles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 1},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422


async def test_start_singles_match_initializes_score_at_zero(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "singles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 2},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 201
    match = resp.json()
    assert match["format"] == "singles"
    assert match["score"]["team_1"] == 0
    assert match["score"]["team_2"] == 0
    assert match["status"] == "in_progress"


async def test_scoring_a_point_updates_the_score(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    match_resp = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "singles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 2},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    match_id = match_resp.json()["id"]

    point_resp = await client.post(
        f"/matches/{match_id}/points",
        json={"team": 1},
        headers=auth_headers(circle_owner["token"]),
    )
    assert point_resp.status_code == 200
    assert point_resp.json()["score"]["team_1"] == 1


async def test_pickleball_match_auto_completes_at_11_win_by_2(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    match_resp = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "singles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 2},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    match_id = match_resp.json()["id"]

    last = None
    for _ in range(11):
        last = await client.post(
            f"/matches/{match_id}/points",
            json={"team": 1},
            headers=auth_headers(circle_owner["token"]),
        )
    assert last.json()["score"]["team_1"] == 11
    assert last.json()["status"] == "completed"

    detail = await client.get(
        f"/matches/{match_id}", headers=auth_headers(circle_owner["token"])
    )
    winner = next(
        p for p in detail.json()["participants"] if p["user_id"] == circle_owner["user"]["user_id"]
    )
    assert winner["result"] == "win"


async def test_undo_reopens_a_completed_match(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    match_resp = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "singles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 2},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    match_id = match_resp.json()["id"]
    for _ in range(11):
        last = await client.post(
            f"/matches/{match_id}/points",
            json={"team": 1},
            headers=auth_headers(circle_owner["token"]),
        )
    assert last.json()["status"] == "completed"

    undo = await client.post(
        f"/matches/{match_id}/undo", headers=auth_headers(circle_owner["token"])
    )
    assert undo.status_code == 200
    assert undo.json()["status"] == "in_progress"
    assert undo.json()["score"]["team_1"] == 10


async def test_doubles_match_requires_2v2(client, circle_owner, a_venue, signed_up_user):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "doubles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 2},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422


async def test_a_game_can_mix_singles_and_doubles_matches(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_two_players(client, circle_owner, a_venue, signed_up_user)
    singles = await client.post(
        f"/games/{game['id']}/matches",
        json={
            "format": "singles",
            "participants": [
                {"user_id": circle_owner["user"]["user_id"], "team": 1},
                {"user_id": signed_up_user["user"]["user_id"], "team": 2},
            ],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert singles.status_code == 201
    assert singles.json()["format"] == "singles"

    matches_list = await client.get(
        f"/games/{game['id']}/matches", headers=auth_headers(circle_owner["token"])
    )
    assert len(matches_list.json()) == 1
