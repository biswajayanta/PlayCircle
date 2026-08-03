from datetime import datetime, timedelta, timezone

from tests.conftest import auth_headers


def future_iso():
    return (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


async def test_circle_report_bucket_counts_sum_to_total(client, circle_owner, a_venue):
    circle_id = circle_owner["circle"]["id"]
    for _ in range(3):
        await client.post(
            "/games",
            json={
                "circle_id": circle_id,
                "sport_id": a_venue["sport_id"],
                "venue_id": a_venue["id"],
                "scheduled_at": future_iso(),
            },
            headers=auth_headers(circle_owner["token"]),
        )

    resp = await client.get(
        f"/circles/{circle_id}/report", headers=auth_headers(circle_owner["token"])
    )
    assert resp.status_code == 200
    data = resp.json()
    assert (
        data["games_completed"]
        + data["games_upcoming"]
        + data["games_cancelled"]
        + data["games_unplayed_past"]
        == data["games_total"]
    )
    assert data["games_total"] == 3


async def test_non_member_cannot_see_circle_report(client, circle_owner, signed_up_user):
    resp = await client.get(
        f"/circles/{circle_owner['circle']['id']}/report",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 403


async def test_game_report_shows_match_with_winner(
    client, circle_owner, a_venue, signed_up_user
):
    circle_id = circle_owner["circle"]["id"]
    game_resp = await client.post(
        "/games",
        json={
            "circle_id": circle_id,
            "sport_id": a_venue["sport_id"],
            "venue_id": a_venue["id"],
            "scheduled_at": future_iso(),
        },
        headers=auth_headers(circle_owner["token"]),
    )
    game = game_resp.json()
    await client.post(
        f"/circles/{circle_id}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
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
        await client.post(
            f"/matches/{match_id}/points",
            json={"team": 1},
            headers=auth_headers(circle_owner["token"]),
        )

    report = await client.get(
        f"/games/{game['id']}/report", headers=auth_headers(circle_owner["token"])
    )
    assert report.status_code == 200
    match_summary = report.json()["matches"][0]
    assert match_summary["team_1_score"] == 11
    assert circle_owner["user"]["display_name"] in match_summary["winning_team"]


async def test_leaderboard_reflects_win_loss_record(
    client, circle_owner, a_venue, signed_up_user
):
    circle_id = circle_owner["circle"]["id"]
    game_resp = await client.post(
        "/games",
        json={
            "circle_id": circle_id,
            "sport_id": a_venue["sport_id"],
            "venue_id": a_venue["id"],
            "scheduled_at": future_iso(),
        },
        headers=auth_headers(circle_owner["token"]),
    )
    game = game_resp.json()
    await client.post(
        f"/circles/{circle_id}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    await client.post(
        f"/games/{game['id']}/join", headers=auth_headers(signed_up_user["token"])
    )
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
        await client.post(
            f"/matches/{match_id}/points",
            json={"team": 1},
            headers=auth_headers(circle_owner["token"]),
        )

    leaderboard = await client.get(
        f"/circles/{circle_id}/leaderboard", headers=auth_headers(circle_owner["token"])
    )
    entries = {e["user_id"]: e for e in leaderboard.json()["entries"]}
    assert entries[circle_owner["user"]["user_id"]]["wins"] == 1
    assert entries[signed_up_user["user"]["user_id"]]["losses"] == 1
