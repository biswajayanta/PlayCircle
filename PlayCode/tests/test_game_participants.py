from datetime import datetime, timedelta, timezone

from tests.conftest import auth_headers


def future_iso():
    return (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


async def _game_with_joined_player(client, circle_owner, a_venue, other_user):
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
        json={"user_id": other_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(other_user["token"])
    )
    return game


async def test_owner_removes_zero_footprint_participant(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_joined_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.delete(
        f"/games/{game['id']}/participants/{signed_up_user['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 204


async def test_self_leave_zero_footprint(client, circle_owner, a_venue, signed_up_user):
    game = await _game_with_joined_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.delete(
        f"/games/{game['id']}/participants/{signed_up_user['user']['user_id']}",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 204


async def test_non_owner_cannot_remove_someone_else(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_joined_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.delete(
        f"/games/{game['id']}/participants/{circle_owner['user']['user_id']}",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 403


async def test_creator_cannot_be_removed(client, circle_owner, a_venue, signed_up_user):
    game = await _game_with_joined_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.delete(
        f"/games/{game['id']}/participants/{circle_owner['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422


async def test_removal_blocked_once_theyve_played_a_match(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_joined_player(client, circle_owner, a_venue, signed_up_user)
    await client.post(
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
    resp = await client.delete(
        f"/games/{game['id']}/participants/{signed_up_user['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422


async def test_removal_blocked_if_part_of_an_expense_split(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_joined_player(client, circle_owner, a_venue, signed_up_user)
    await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Snacks", "amount": "100.00"},
        headers=auth_headers(circle_owner["token"]),
    )
    resp = await client.delete(
        f"/games/{game['id']}/participants/{signed_up_user['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422


async def test_removal_blocked_once_game_date_has_passed(
    client, circle_owner, a_venue, signed_up_user
):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    game_resp = await client.post(
        "/games",
        json={
            "circle_id": circle_owner["circle"]["id"],
            "sport_id": a_venue["sport_id"],
            "venue_id": a_venue["id"],
            "scheduled_at": past,
        },
        headers=auth_headers(circle_owner["token"]),
    )
    game = game_resp.json()
    # Manually seed a participant row (their own join would 409 on a past
    # date, same as the join tests already cover) to isolate this check.
    import asyncpg

    from app.config import settings

    async def _seed():
        conn = await asyncpg.connect(dsn=settings.db_dsn)
        try:
            await conn.execute(
                "INSERT INTO social.game_participants (game_id, user_id, status) VALUES ($1, $2, 'confirmed')",
                game["id"],
                signed_up_user["user"]["user_id"],
            )
        finally:
            await conn.close()

    await _seed()

    resp = await client.delete(
        f"/games/{game['id']}/participants/{signed_up_user['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 409
