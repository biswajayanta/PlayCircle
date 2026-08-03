from datetime import datetime, timedelta, timezone

from tests.conftest import auth_headers


def future_iso():
    return (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()


async def _game_with_player(client, circle_owner, a_venue, other_user):
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


async def test_only_game_creator_can_add_expense(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Court fee", "amount": "500.00"},
        headers=auth_headers(signed_up_user["token"]),  # not the creator
    )
    assert resp.status_code == 403


async def test_creator_can_choose_a_different_payer(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={
            "description": "Court fee",
            "amount": "500.00",
            "paid_by_user_id": signed_up_user["user"]["user_id"],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 201
    expense = resp.json()
    assert expense["paid_by_user_id"] == signed_up_user["user"]["user_id"]

    splits = {s["user_id"]: s for s in expense["splits"]}
    # The payer's own share auto-settles...
    assert splits[signed_up_user["user"]["user_id"]]["is_settled"] is True
    # ...even though the payer isn't the creator, the creator (who didn't pay) owes.
    assert splits[circle_owner["user"]["user_id"]]["is_settled"] is False


async def test_expense_splits_equally_among_confirmed_participants(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Snacks", "amount": "100.00"},
        headers=auth_headers(circle_owner["token"]),
    )
    expense = resp.json()
    amounts = {s["share_amount"] for s in expense["splits"]}
    assert amounts == {"50.00"}


async def test_only_owner_can_settle_a_split(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    expense_resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={
            "description": "Court fee",
            "amount": "500.00",
            "paid_by_user_id": signed_up_user["user"]["user_id"],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    expense = expense_resp.json()

    # The payer (not the owner... wait, owner IS circle_owner who created the
    # game) tries to settle their own already-settled share pointlessly, but
    # more importantly: a non-owner (signed_up_user, the payer) trying to
    # settle someone else's pending split must be rejected.
    pending_user_id = circle_owner["user"]["user_id"]
    resp = await client.patch(
        f"/expenses/{expense['id']}/splits/{pending_user_id}/settle",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 403

    owner_resp = await client.patch(
        f"/expenses/{expense['id']}/splits/{pending_user_id}/settle",
        headers=auth_headers(circle_owner["token"]),
    )
    assert owner_resp.status_code == 200


async def test_double_settle_is_rejected(client, circle_owner, a_venue, signed_up_user):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    expense_resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={
            "description": "Court fee",
            "amount": "500.00",
            "paid_by_user_id": signed_up_user["user"]["user_id"],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    expense = expense_resp.json()
    pending_user_id = circle_owner["user"]["user_id"]

    first = await client.patch(
        f"/expenses/{expense['id']}/splits/{pending_user_id}/settle",
        headers=auth_headers(circle_owner["token"]),
    )
    assert first.status_code == 200

    second = await client.patch(
        f"/expenses/{expense['id']}/splits/{pending_user_id}/settle",
        headers=auth_headers(circle_owner["token"]),
    )
    assert second.status_code == 409


async def test_settlement_plan_reflects_unsettled_debt(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    await client.post(
        f"/games/{game['id']}/expenses",
        json={
            "description": "Court fee",
            "amount": "500.00",
            "paid_by_user_id": signed_up_user["user"]["user_id"],
        },
        headers=auth_headers(circle_owner["token"]),
    )

    plan = await client.get(
        f"/games/{game['id']}/settlement-plan", headers=auth_headers(circle_owner["token"])
    )
    assert plan.status_code == 200
    data = plan.json()
    assert data["fully_settled"] is False
    assert len(data["transactions"]) == 1
    txn = data["transactions"][0]
    assert txn["from_user_id"] == circle_owner["user"]["user_id"]
    assert txn["to_user_id"] == signed_up_user["user"]["user_id"]
    assert txn["amount"] == "250.00"


async def test_settlement_plan_shows_fully_settled_once_all_paid(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    expense_resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={
            "description": "Court fee",
            "amount": "500.00",
            "paid_by_user_id": signed_up_user["user"]["user_id"],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    expense = expense_resp.json()
    await client.patch(
        f"/expenses/{expense['id']}/splits/{circle_owner['user']['user_id']}/settle",
        headers=auth_headers(circle_owner["token"]),
    )

    plan = await client.get(
        f"/games/{game['id']}/settlement-plan", headers=auth_headers(circle_owner["token"])
    )
    assert plan.json()["fully_settled"] is True
    assert plan.json()["transactions"] == []
