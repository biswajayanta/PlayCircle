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


async def _add_circle_member_only(client, circle_owner, member):
    """Adds `member` to the circle without joining the game — a circle
    member who isn't a participant of any particular game."""
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": member["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )


async def test_any_circle_member_can_add_expense(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Court fee", "amount": "500.00"},
        headers=auth_headers(signed_up_user["token"]),  # not the creator
    )
    assert resp.status_code == 201


async def test_non_circle_member_cannot_add_expense(
    client, circle_owner, a_venue, signed_up_user, unique
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    outsider = await client.post(
        "/auth/signup",
        json={
            "email": f"outsider-{unique}@example.com",
            "password": "testpassword123",
            "display_name": f"Outsider {unique[:6]}",
        },
    )
    outsider_token = outsider.json()["access_token"]

    resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Court fee", "amount": "500.00"},
        headers=auth_headers(outsider_token),
    )
    assert resp.status_code == 403


async def test_payer_can_be_a_circle_member_who_is_not_a_participant(
    client, circle_owner, a_venue, signed_up_user, unique
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    bystander = await client.post(
        "/auth/signup",
        json={
            "email": f"bystander-{unique}@example.com",
            "password": "testpassword123",
            "display_name": f"Bystander {unique[:6]}",
        },
    )
    bystander_user = bystander.json()["user"]
    await _add_circle_member_only(client, circle_owner, {"user": bystander_user})

    resp = await client.post(
        f"/games/{game['id']}/expenses",
        json={
            "description": "Court fee",
            "amount": "500.00",
            "paid_by_user_id": bystander_user["user_id"],
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 201, resp.text
    expense = resp.json()
    assert expense["paid_by_user_id"] == bystander_user["user_id"]
    # Split is still only among the game's actual (confirmed) participants —
    # the bystander paid but isn't one, so they get no split row.
    split_user_ids = {s["user_id"] for s in expense["splits"]}
    assert bystander_user["user_id"] not in split_user_ids
    assert split_user_ids == {
        circle_owner["user"]["user_id"],
        signed_up_user["user"]["user_id"],
    }


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


async def test_ledger_reflects_expense_balances(
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

    ledger = await client.get(
        f"/circles/{circle_owner['circle']['id']}/ledger",
        headers=auth_headers(circle_owner["token"]),
    )
    assert ledger.status_code == 200
    balances = {b["user_id"]: b["balance"] for b in ledger.json()["balances"]}
    # Payer is credited the full 500, debited their own 250 share -> net +250.
    assert balances[signed_up_user["user"]["user_id"]] == "250.00"
    # The other participant just owes their 250 share -> net -250.
    assert balances[circle_owner["user"]["user_id"]] == "-250.00"
    assert ledger.json()["fully_settled"] is False
    suggestion = ledger.json()["suggested_settlements"][0]
    assert suggestion["from_user_id"] == circle_owner["user"]["user_id"]
    assert suggestion["to_user_id"] == signed_up_user["user"]["user_id"]
    assert suggestion["amount"] == "250.00"


async def test_transfer_updates_balances_immediately(
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

    # circle_owner (net -250) settles up with signed_up_user (net +250) by
    # recording a direct transfer — anyone in the circle can record it.
    transfer_resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/transfers",
        json={
            "from_user_id": circle_owner["user"]["user_id"],
            "to_user_id": signed_up_user["user"]["user_id"],
            "amount": "250.00",
            "note": "Settling up",
        },
        headers=auth_headers(signed_up_user["token"]),  # recorded by someone else in the circle
    )
    assert transfer_resp.status_code == 201, transfer_resp.text

    ledger = await client.get(
        f"/circles/{circle_owner['circle']['id']}/ledger",
        headers=auth_headers(circle_owner["token"]),
    )
    balances = {b["user_id"]: b["balance"] for b in ledger.json()["balances"]}
    assert balances[circle_owner["user"]["user_id"]] == "0.00"
    assert balances[signed_up_user["user"]["user_id"]] == "0.00"
    assert ledger.json()["fully_settled"] is True
    assert ledger.json()["suggested_settlements"] == []


async def test_transfer_requires_both_parties_to_be_circle_members(
    client, circle_owner, unique
):
    outsider = await client.post(
        "/auth/signup",
        json={
            "email": f"outsider2-{unique}@example.com",
            "password": "testpassword123",
            "display_name": f"Outsider2 {unique[:6]}",
        },
    )
    outsider_user = outsider.json()["user"]

    resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/transfers",
        json={
            "from_user_id": circle_owner["user"]["user_id"],
            "to_user_id": outsider_user["user_id"],
            "amount": "100.00",
        },
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422
