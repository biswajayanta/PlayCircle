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
    # A single rally doesn't close a set, so sets-won (team_1) stays 0 —
    # it's the current set's live tally that actually moved.
    assert point_resp.json()["score"]["team_1"] == 0
    assert point_resp.json()["score"]["current_set_team_1"] == 1


async def test_pickleball_match_completes_after_all_sets_played(
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
    for set_num in range(3):  # default num_sets=3, all always played
        for _ in range(11):
            last = await client.post(
                f"/matches/{match_id}/points",
                json={"team": 1},
                headers=auth_headers(circle_owner["token"]),
            )
        if set_num < 2:
            # Team 1 already has an insurmountable lead after set 1, but
            # every configured set is always played — no early stop.
            assert last.json()["status"] == "in_progress"
            assert last.json()["score"]["team_1"] == set_num + 1

    assert last.json()["score"]["team_1"] == 3
    assert last.json()["score"]["team_2"] == 0
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
    last = None
    for _ in range(33):  # 3 sets x 11 points, all to team 1
        last = await client.post(
            f"/matches/{match_id}/points",
            json={"team": 1},
            headers=auth_headers(circle_owner["token"]),
        )
    assert last.json()["status"] == "completed"
    assert last.json()["score"]["team_1"] == 3

    undo = await client.post(
        f"/matches/{match_id}/undo", headers=auth_headers(circle_owner["token"])
    )
    assert undo.status_code == 200
    assert undo.json()["status"] == "in_progress"
    # The undone point is the one that just closed set 3 — that set
    # reopens with 10 points instead of counting as a win.
    assert undo.json()["score"]["team_1"] == 2
    assert undo.json()["score"]["current_set_team_1"] == 10


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
    listed = matches_list.json()
    assert len(listed) == 1
    # The list endpoint carries participants too — the game screen shows
    # "who's playing who" for every match without an extra fetch per row.
    participant_ids = {p["user_id"] for p in listed[0]["participants"]}
    assert participant_ids == {
        circle_owner["user"]["user_id"],
        signed_up_user["user"]["user_id"],
    }
