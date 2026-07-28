import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.post import CommentCreate, CommentOut, PostCreate, PostDetail, PostMediaOut, PostOut

router = APIRouter()

# Flagged posts/comments are hidden from everyone but the author until a moderation
# workflow exists; pending and approved are both shown (no review queue built yet).
_HIDDEN_STATUSES = ("flagged",)

_POST_COLUMNS = """
    p.id, p.game_id, p.match_id, p.author_user_id, u.display_name AS author_display_name,
    p.caption, p.visibility, p.created_at,
    (SELECT count(*) FROM social.likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT count(*) FROM social.comments c
        WHERE c.post_id = p.id AND c.moderation_status <> 'flagged') AS comment_count,
    EXISTS (SELECT 1 FROM social.likes l2 WHERE l2.post_id = p.id AND l2.user_id = $1) AS liked_by_me
"""


async def _resolve_game_id(conn, game_id: uuid.UUID | None, match_id: uuid.UUID | None) -> uuid.UUID:
    if game_id is not None:
        return game_id
    match_row = await conn.fetchrow("SELECT game_id FROM social.matches WHERE id = $1", match_id)
    if match_row is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match_row["game_id"]


async def _require_circle_member_for_game(conn, game_id: uuid.UUID, user_id: uuid.UUID):
    game_row = await conn.fetchrow("SELECT circle_id FROM social.games WHERE id = $1", game_id)
    if game_row is None:
        raise HTTPException(status_code=404, detail="Game not found")
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        game_row["circle_id"],
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this game's circle")


async def _fetch_post_detail(pool, post_id: uuid.UUID, current_user_id: uuid.UUID) -> PostDetail:
    row = await pool.fetchrow(
        f"""
        SELECT {_POST_COLUMNS}
        FROM social.posts p
        JOIN core.users u ON u.id = p.author_user_id
        WHERE p.id = $2
        """,
        current_user_id,
        post_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")

    media_rows = await pool.fetch(
        "SELECT id, media_type, url FROM social.media WHERE post_id = $1 ORDER BY created_at",
        post_id,
    )
    comment_rows = await pool.fetch(
        """
        SELECT c.id, c.author_user_id, u.display_name AS author_display_name, c.body, c.created_at
        FROM social.comments c
        JOIN core.users u ON u.id = c.author_user_id
        WHERE c.post_id = $1 AND c.moderation_status <> 'flagged'
        ORDER BY c.created_at
        """,
        post_id,
    )
    post_out = PostOut(**dict(row))
    return PostDetail(
        **post_out.model_dump(),
        media=[PostMediaOut(**dict(m)) for m in media_rows],
        comments=[CommentOut(**dict(c)) for c in comment_rows],
    )


@router.post("/posts", response_model=PostDetail, status_code=201)
async def create_post(
    payload: PostCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            game_id = await _resolve_game_id(conn, payload.game_id, payload.match_id)
            await _require_circle_member_for_game(conn, game_id, current_user_id)

            if payload.match_id is not None and payload.game_id is not None:
                match_row = await conn.fetchrow(
                    "SELECT game_id FROM social.matches WHERE id = $1", payload.match_id
                )
                if match_row is None or match_row["game_id"] != payload.game_id:
                    raise HTTPException(
                        status_code=422, detail="match_id does not belong to game_id"
                    )

            post_row = await conn.fetchrow(
                """
                INSERT INTO social.posts (match_id, game_id, author_user_id, caption, visibility)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                """,
                payload.match_id,
                payload.game_id,
                current_user_id,
                payload.caption,
                payload.visibility,
            )
            post_id = post_row["id"]

            for m in payload.media:
                await conn.execute(
                    """
                    INSERT INTO social.media (post_id, uploaded_by_user_id, media_type, url)
                    VALUES ($1, $2, $3, $4)
                    """,
                    post_id,
                    current_user_id,
                    m.media_type,
                    m.url,
                )

    return await _fetch_post_detail(pool, post_id, current_user_id)


@router.get("/games/{game_id}/posts", response_model=list[PostOut])
async def list_posts_for_game(
    game_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member_for_game(conn, game_id, current_user_id)

    rows = await pool.fetch(
        f"""
        SELECT {_POST_COLUMNS}
        FROM social.posts p
        JOIN core.users u ON u.id = p.author_user_id
        LEFT JOIN social.matches m ON m.id = p.match_id
        WHERE (p.game_id = $2 OR m.game_id = $2)
          AND p.moderation_status <> ALL($3::text[])
        ORDER BY p.created_at DESC
        """,
        current_user_id,
        game_id,
        list(_HIDDEN_STATUSES),
    )
    return [PostOut(**dict(r)) for r in rows]


@router.get("/posts/{post_id}", response_model=PostDetail)
async def get_post(
    post_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    post_row = await pool.fetchrow(
        "SELECT game_id, match_id FROM social.posts WHERE id = $1", post_id
    )
    if post_row is None:
        raise HTTPException(status_code=404, detail="Post not found")

    async with pool.acquire() as conn:
        game_id = await _resolve_game_id(conn, post_row["game_id"], post_row["match_id"])
        await _require_circle_member_for_game(conn, game_id, current_user_id)

    return await _fetch_post_detail(pool, post_id, current_user_id)


@router.post("/posts/{post_id}/comments", response_model=PostDetail, status_code=201)
async def add_comment(
    post_id: uuid.UUID,
    payload: CommentCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            post_row = await conn.fetchrow(
                "SELECT game_id, match_id FROM social.posts WHERE id = $1", post_id
            )
            if post_row is None:
                raise HTTPException(status_code=404, detail="Post not found")
            game_id = await _resolve_game_id(conn, post_row["game_id"], post_row["match_id"])
            await _require_circle_member_for_game(conn, game_id, current_user_id)

            await conn.execute(
                "INSERT INTO social.comments (post_id, author_user_id, body) VALUES ($1, $2, $3)",
                post_id,
                current_user_id,
                payload.body,
            )

    return await _fetch_post_detail(pool, post_id, current_user_id)


@router.post("/posts/{post_id}/like", response_model=PostOut, status_code=201)
async def like_post(
    post_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            post_row = await conn.fetchrow(
                "SELECT game_id, match_id FROM social.posts WHERE id = $1", post_id
            )
            if post_row is None:
                raise HTTPException(status_code=404, detail="Post not found")
            game_id = await _resolve_game_id(conn, post_row["game_id"], post_row["match_id"])
            await _require_circle_member_for_game(conn, game_id, current_user_id)

            already_liked = await conn.fetchval(
                "SELECT 1 FROM social.likes WHERE post_id = $1 AND user_id = $2",
                post_id,
                current_user_id,
            )
            if already_liked:
                raise HTTPException(status_code=409, detail="Already liked this post")

            await conn.execute(
                "INSERT INTO social.likes (post_id, user_id) VALUES ($1, $2)",
                post_id,
                current_user_id,
            )

    row = await pool.fetchrow(
        f"""
        SELECT {_POST_COLUMNS}
        FROM social.posts p
        JOIN core.users u ON u.id = p.author_user_id
        WHERE p.id = $2
        """,
        current_user_id,
        post_id,
    )
    return PostOut(**dict(row))


@router.delete("/posts/{post_id}/like", response_model=PostOut)
async def unlike_post(
    post_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    result = await pool.execute(
        "DELETE FROM social.likes WHERE post_id = $1 AND user_id = $2", post_id, current_user_id
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="You haven't liked this post")

    row = await pool.fetchrow(
        f"""
        SELECT {_POST_COLUMNS}
        FROM social.posts p
        JOIN core.users u ON u.id = p.author_user_id
        WHERE p.id = $2
        """,
        current_user_id,
        post_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostOut(**dict(row))
