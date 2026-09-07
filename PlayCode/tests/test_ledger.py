from tests.conftest import auth_headers
from tests.test_expenses import _game_with_player


async def _signup(client, unique, label):
    resp = await client.post(
        "/auth/signup",
        json={
            "email": f"{label}-{unique}@example.com",
            "password": "testpassword123",
            "display_name": f"{label.title()} {unique[:6]}",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return {"token": data["access_token"], "user": data["user"]}


async def test_export_xlsx_returns_the_right_content_type(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Court fee", "amount": "500.00"},
        headers=auth_headers(circle_owner["token"]),
    )

    resp = await client.get(
        f"/circles/{circle_owner['circle']['id']}/ledger/export?format=xlsx",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    # .xlsx files are zip archives — check the magic bytes rather than
    # parsing the whole workbook, just to confirm real content came back.
    assert resp.content[:2] == b"PK"


async def test_export_pdf_returns_the_right_content_type(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Court fee", "amount": "500.00"},
        headers=auth_headers(circle_owner["token"]),
    )

    resp = await client.get(
        f"/circles/{circle_owner['circle']['id']}/ledger/export?format=pdf",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


async def test_export_requires_circle_membership(client, circle_owner, unique):
    outsider = await _signup(client, unique, "outsider")
    resp = await client.get(
        f"/circles/{circle_owner['circle']['id']}/ledger/export?format=xlsx",
        headers=auth_headers(outsider["token"]),
    )
    assert resp.status_code == 403


async def test_personal_ledger_visible_to_self(
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

    resp = await client.get(
        f"/users/{signed_up_user['user']['user_id']}/ledger",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 200
    circles = resp.json()["circles"]
    assert len(circles) == 1
    assert circles[0]["circle_id"] == circle_owner["circle"]["id"]
    # Paid 500, owes their own 250 share -> net +250.
    assert circles[0]["balance"] == "250.00"


async def test_personal_ledger_visible_to_circle_owner(
    client, circle_owner, a_venue, signed_up_user
):
    await _game_with_player(client, circle_owner, a_venue, signed_up_user)

    resp = await client.get(
        f"/users/{signed_up_user['user']['user_id']}/ledger",
        headers=auth_headers(circle_owner["token"]),  # the circle's owner, not the target user
    )
    assert resp.status_code == 200
    circles = resp.json()["circles"]
    assert len(circles) == 1
    assert circles[0]["circle_id"] == circle_owner["circle"]["id"]


async def test_personal_ledger_hidden_from_a_non_owner_member(
    client, circle_owner, a_venue, signed_up_user, unique
):
    await _game_with_player(client, circle_owner, a_venue, signed_up_user)

    # A third member of the same circle, who does NOT own it, shouldn't see
    # signed_up_user's personal ledger for that circle.
    bystander = await _signup(client, unique, "bystander")
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": bystander["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )

    resp = await client.get(
        f"/users/{signed_up_user['user']['user_id']}/ledger",
        headers=auth_headers(bystander["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["circles"] == []


async def test_personal_ledger_entry_amount_is_the_users_own_share(
    client, circle_owner, a_venue, signed_up_user
):
    game = await _game_with_player(client, circle_owner, a_venue, signed_up_user)
    await client.post(
        f"/games/{game['id']}/expenses",
        json={"description": "Court fee", "amount": "500.00"},
        headers=auth_headers(circle_owner["token"]),
    )

    resp = await client.get(
        f"/users/{signed_up_user['user']['user_id']}/ledger",
        headers=auth_headers(signed_up_user["token"]),
    )
    entries = resp.json()["circles"][0]["entries"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["kind"] == "expense_share"
    # Their split share (250), not the game's 500 total.
    assert entry["amount"] == "250.00"
    assert entry["is_payer"] is False
    assert entry["counterparty_display_name"] == circle_owner["user"]["display_name"]
