from tests.conftest import auth_headers


async def test_signup_creates_a_working_account(client, unique):
    resp = await client.post(
        "/auth/signup",
        json={
            "email": f"newuser-{unique}@example.com",
            "password": "testpassword123",
            "display_name": "New User",
            "city": "Bengaluru",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["display_name"] == "New User"
    assert data["user"]["city"] == "Bengaluru"


async def test_signup_rejects_duplicate_email(client, unique):
    email = f"dup-{unique}@example.com"
    payload = {"email": email, "password": "testpassword123", "display_name": "First"}
    first = await client.post("/auth/signup", json=payload)
    assert first.status_code == 201

    second = await client.post("/auth/signup", json=payload)
    assert second.status_code >= 400


async def test_signup_rejects_short_password(client, unique):
    resp = await client.post(
        "/auth/signup",
        json={
            "email": f"shortpw-{unique}@example.com",
            "password": "short",
            "display_name": "Someone",
        },
    )
    assert resp.status_code == 422


async def test_login_with_correct_credentials(client, signed_up_user):
    resp = await client.post(
        "/auth/login",
        json={"email": signed_up_user["email"], "password": "testpassword123"},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


async def test_login_with_wrong_password_fails(client, signed_up_user):
    resp = await client.post(
        "/auth/login",
        json={"email": signed_up_user["email"], "password": "wrongpassword"},
    )
    assert resp.status_code == 401


async def test_login_with_nonexistent_email_fails(client, unique):
    resp = await client.post(
        "/auth/login",
        json={"email": f"nobody-{unique}@example.com", "password": "whatever123"},
    )
    assert resp.status_code == 401


async def test_me_requires_a_valid_token(client):
    resp = await client.get("/me")
    assert resp.status_code == 401


async def test_me_returns_the_current_user(client, signed_up_user):
    resp = await client.get("/me", headers=auth_headers(signed_up_user["token"]))
    assert resp.status_code == 200
    assert resp.json()["user_id"] == signed_up_user["user"]["user_id"]


async def test_forgot_password_gives_same_response_for_real_and_fake_emails(
    client, signed_up_user, unique
):
    real = await client.post(
        "/auth/forgot-password", json={"email": signed_up_user["email"]}
    )
    fake = await client.post(
        "/auth/forgot-password", json={"email": f"totallyfake-{unique}@nowhere.com"}
    )
    assert real.status_code == 200
    assert fake.status_code == 200
    assert real.json() == fake.json()


async def test_reset_password_full_cycle(client, signed_up_user):
    """The token itself isn't returned by the API (by design — it's only
    ever logged server-side), so this test goes around that via a direct
    DB lookup to get a token to exercise the reset endpoint with."""
    import hashlib

    import asyncpg

    from app.config import settings
    from app.security import generate_reset_token

    raw_token, token_hash = generate_reset_token()
    assert hashlib.sha256(raw_token.encode()).hexdigest() == token_hash

    conn = await asyncpg.connect(dsn=settings.db_dsn)
    try:
        user_id = await conn.fetchval(
            "SELECT id FROM core.users WHERE email = $1", signed_up_user["email"]
        )
        await conn.execute(
            """
            INSERT INTO core.password_reset_tokens (user_id, token_hash, expires_at)
            VALUES ($1, $2, now() + interval '30 minutes')
            """,
            user_id,
            token_hash,
        )
    finally:
        await conn.close()

    reset_resp = await client.post(
        "/auth/reset-password",
        json={"token": raw_token, "new_password": "brandnewpassword456"},
    )
    assert reset_resp.status_code == 200

    old_login = await client.post(
        "/auth/login",
        json={"email": signed_up_user["email"], "password": "testpassword123"},
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/auth/login",
        json={"email": signed_up_user["email"], "password": "brandnewpassword456"},
    )
    assert new_login.status_code == 200

    # Same token used again must fail — single use.
    replay = await client.post(
        "/auth/reset-password",
        json={"token": raw_token, "new_password": "shouldnotwork789"},
    )
    assert replay.status_code == 400
