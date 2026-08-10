from tests.conftest import auth_headers


async def test_create_circle_auto_makes_creator_the_owner(circle_owner):
    circle = circle_owner["circle"]
    assert circle["owner_user_id"] == circle_owner["user"]["user_id"]
    assert circle["my_role"] == "owner"
    assert circle["member_count"] == 1


async def test_non_member_cannot_see_circle(client, circle_owner, signed_up_user):
    resp = await client.get(
        f"/circles/{circle_owner['circle']['id']}",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 404  # not 403 — existence isn't confirmed either


async def test_owner_adds_member_by_user_id(client, circle_owner, signed_up_user):
    resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["member_count"] == 2


async def test_owner_adds_member_by_email(client, circle_owner, signed_up_user):
    resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"email": signed_up_user["email"]},
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 201


async def test_adding_nonexistent_email_404s(client, circle_owner, unique):
    resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"email": f"ghost-{unique}@nowhere.com"},
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 404


async def test_non_owner_cannot_add_members(client, circle_owner, signed_up_user):
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    other_resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers(signed_up_user["token"]),
    )
    assert other_resp.status_code == 403


async def test_self_join_a_circle(client, circle_owner, signed_up_user):
    resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/join",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["my_role"] == "member"


async def test_search_only_returns_public_profiles(client, circle_owner, signed_up_user, unique):
    # signed_up_user is public by default
    search = await client.get(
        f"/users/search?q={signed_up_user['user']['display_name']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert search.status_code == 200
    assert any(u["user_id"] == signed_up_user["user"]["user_id"] for u in search.json())

    # make them private
    await client.patch(
        "/me", json={"is_public": False}, headers=auth_headers(signed_up_user["token"])
    )
    search2 = await client.get(
        f"/users/search?q={signed_up_user['user']['display_name']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert all(u["user_id"] != signed_up_user["user"]["user_id"] for u in search2.json())


async def test_list_members_shows_names_and_roles(client, circle_owner, signed_up_user):
    await client.post(
        f"/circles/{circle_owner['circle']['id']}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    resp = await client.get(
        f"/circles/{circle_owner['circle']['id']}/members",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 200
    roles = {m["user_id"]: m["role"] for m in resp.json()}
    assert roles[circle_owner["user"]["user_id"]] == "owner"
    assert roles[signed_up_user["user"]["user_id"]] == "member"


async def test_owner_cannot_be_removed(client, circle_owner):
    resp = await client.delete(
        f"/circles/{circle_owner['circle']['id']}/members/{circle_owner['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422


async def test_owner_removes_a_member_and_history_is_preserved(
    client, circle_owner, signed_up_user
):
    circle_id = circle_owner["circle"]["id"]
    await client.post(
        f"/circles/{circle_id}/members",
        json={"user_id": signed_up_user["user"]["user_id"]},
        headers=auth_headers(circle_owner["token"]),
    )
    remove_resp = await client.delete(
        f"/circles/{circle_id}/members/{signed_up_user['user']['user_id']}",
        headers=auth_headers(circle_owner["token"]),
    )
    assert remove_resp.status_code == 204

    members = await client.get(
        f"/circles/{circle_id}/members", headers=auth_headers(circle_owner["token"])
    )
    assert all(m["user_id"] != signed_up_user["user"]["user_id"] for m in members.json())

    # They can rejoin cleanly.
    rejoin = await client.post(
        f"/circles/{circle_id}/join", headers=auth_headers(signed_up_user["token"])
    )
    assert rejoin.status_code == 201


async def test_non_owner_cannot_remove_others(client, circle_owner, signed_up_user):
    circle_id = circle_owner["circle"]["id"]
    await client.post(
        f"/circles/{circle_id}/join", headers=auth_headers(signed_up_user["token"])
    )
    resp = await client.delete(
        f"/circles/{circle_id}/members/{circle_owner['user']['user_id']}",
        headers=auth_headers(signed_up_user["token"]),
    )
    assert resp.status_code == 403


async def test_member_can_leave_circle(client, circle_owner, signed_up_user):
    circle_id = circle_owner["circle"]["id"]
    await client.post(
        f"/circles/{circle_id}/join", headers=auth_headers(signed_up_user["token"])
    )
    leave_resp = await client.post(
        f"/circles/{circle_id}/leave", headers=auth_headers(signed_up_user["token"])
    )
    assert leave_resp.status_code == 204


async def test_owner_cannot_leave_own_circle(client, circle_owner):
    resp = await client.post(
        f"/circles/{circle_owner['circle']['id']}/leave",
        headers=auth_headers(circle_owner["token"]),
    )
    assert resp.status_code == 422
