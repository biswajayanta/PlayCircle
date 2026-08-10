from datetime import datetime, timedelta, timezone

from tests.conftest import auth_headers


def future_iso(days=10):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def past_iso(days=1):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def _make_game(client, circle_owner, venue, scheduled_at=None):
    resp = await client.post(
        "/games",
        json={
            "circle_id": circle_owner["circle"]["id"],
            "sport_id": venue["sport_id"],
            "venue_id": venue["id"],
            "scheduled_at": scheduled_at or future_iso(),
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_game_has_no_format_or_capacity_fields(client, circle_owner, a_venue):
    game = await _make_game(client, circle_owner, a_venue)
    assert "format" not in game
    assert "capacity" not in game
    assert game["confirmed_count"] == 1  # creator auto-joins
    assert game["already_joined"] is True


async def test_unlimited_members_can_join_a_game(client, circle_owner, a_venue, signed_up_user):
    game = await _make_game(client, circle_owner, a_venue)
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    join = await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
    assert join.status_code == 201
    assert join.json()["confirmed_count"] == 2
    assert join.json()["status"] == "open"  # never auto-flips to 'full'


async def test_already_joined_flag_flips_correctly(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _make_game(client, circle_owner, a_venue)
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    before = await client.get(
        f"/games?circle_id={circle_owner['circle']['id']}",
        headers=auth_headers(signed_up_user["token"]),
    )
    this_game = next(g for g in before.json() if g["id"] == game["id"])
    assert this_game["already_joined"] is False

    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
    after = await client.get(
        f"/games?circle_id={circle_owner['circle']['id']}",
        headers=auth_headers(signed_up_user["token"]),
    )
    this_game_after = next(g for g in after.json() if g["id"] == game["id"])
    assert this_game_after["already_joined"] is True


async def test_cannot_join_a_game_dated_in_the_past(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _make_game(client, circle_owner, a_venue, scheduled_at=past_iso())
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    resp = await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
    assert resp.status_code == 409


async def test_reschedule_success(client, circle_owner, a_venue):
    game = await _make_game(client, circle_owner, a_venue)
    new_time = future_iso(days=20)
    resp = await client.patch(
        f"/games/{game['id']}/reschedule",
        json={"scheduled_at": new_time},
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 200


async def test_non_owner_cannot_reschedule(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _make_game(client, circle_owner, a_venue)
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    resp = await client.patch(
        f"/games/{game['id']}/reschedule",
        json={"scheduled_at": future_iso(days=5)},
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 403


async def test_cannot_reschedule_after_original_time_passed(client, circle_owner, a_venue):
    game = await _make_game(client, circle_owner, a_venue, scheduled_at=past_iso())
    resp = await client.patch(
        f"/games/{game['id']}/reschedule",
        json={"scheduled_at": future_iso()},
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 409


async def test_cancel_a_clean_game_succeeds(client, circle_owner, a_venue):
    game = await _make_game(client, circle_owner, a_venue)
    resp = await client.post(
        f"/games/{game['id']}/cancel", headers=auth_headers(circle_owner["token"])
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


async def test_cancel_blocked_when_matches_played(client, circle_owner, a_venue, signed_up_user):
    game = await _make_game(client, circle_owner, a_venue)
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
    match = await client.post(
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
    assert match.status_code == 201

    cancel = await client.post(
        f"/games/{game['id']}/cancel", headers=auth_headers(circle_owner["token"])
    )
    assert cancel.status_code == 422


async def test_cancelled_game_rejects_new_matches(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _make_game(client, circle_owner, a_venue)
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
    await client.post(
        f"/games/{game['id']}/cancel", headers=auth_headers(circle_owner["token"])
    )
    match = await client.post(
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
    assert match.status_code == 409
