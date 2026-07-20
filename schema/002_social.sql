-- ============================================================
-- SOCIAL SCHEMA
-- Public-facing data: profiles, groups, games, matches, feed.
-- Public by default, with per-row visibility toggles.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS social;

-- Public profile is separate from core.users so that "identity" (phone,
-- email, auth) and "public presence" (bio, city, visibility toggles)
-- are two different concerns, controlled by two different access rules.
CREATE TABLE social.profiles (
    user_id         UUID PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
    bio             TEXT,
    city            TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT true,   -- master toggle for public visibility
    show_stats      BOOLEAN NOT NULL DEFAULT true,   -- fine-grained toggle: win/loss record
    show_activity   BOOLEAN NOT NULL DEFAULT true,   -- fine-grained toggle: recent matches
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Regulars" — the group of people someone plays with repeatedly.
CREATE TABLE social.circles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    owner_user_id   UUID NOT NULL REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE social.circle_members (
    circle_id       UUID NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'captain', 'member')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (circle_id, user_id)
);

-- A planned/open game — before it's played, this is just "who's in".
CREATE TABLE social.games (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id        INTEGER NOT NULL REFERENCES core.sports(id),
    venue_id        INTEGER REFERENCES core.venues(id),
    creator_user_id UUID NOT NULL REFERENCES core.users(id),
    circle_id       UUID REFERENCES social.circles(id),   -- null = open/public game
    scheduled_at    TIMESTAMPTZ NOT NULL,
    format          TEXT NOT NULL DEFAULT 'doubles' CHECK (format IN ('singles', 'doubles')),
    visibility      TEXT NOT NULL DEFAULT 'circle' CHECK (visibility IN ('open', 'circle', 'private')),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'completed', 'cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE social.game_participants (
    game_id         UUID NOT NULL REFERENCES social.games(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'confirmed', 'declined')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, user_id)
);

-- The actual played match, once a game has happened. Split from `games`
-- because a game can be scheduled/cancelled without ever becoming a match.
CREATE TABLE social.matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID REFERENCES social.games(id),
    sport_id        INTEGER NOT NULL REFERENCES core.sports(id),
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    score           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- shape defined by sports.scoring_config
    status          TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE social.match_participants (
    match_id        UUID NOT NULL REFERENCES social.matches(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    team            SMALLINT,             -- 1 or 2
    points_scored    SMALLINT,
    result          TEXT CHECK (result IN ('win', 'loss', 'draw')),
    PRIMARY KEY (match_id, user_id)
);

-- Skill rating evolves per sport, drives "find a game near your level".
CREATE TABLE social.skill_ratings (
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    sport_id        INTEGER NOT NULL REFERENCES core.sports(id),
    rating          NUMERIC(6,1) NOT NULL DEFAULT 1000.0,   -- simple ELO-style starting point
    matches_played  INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, sport_id)
);

-- Every post is anchored to a match or game — no open "write anything"
-- timeline. This structurally keeps content sports-only.
CREATE TABLE social.posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID REFERENCES social.matches(id),
    game_id         UUID REFERENCES social.games(id),
    author_user_id  UUID NOT NULL REFERENCES core.users(id),
    caption         TEXT,
    visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'circle', 'private')),
    moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'flagged')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT post_anchored_to_something CHECK (match_id IS NOT NULL OR game_id IS NOT NULL)
);

CREATE TABLE social.media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES social.posts(id) ON DELETE CASCADE,
    uploaded_by_user_id UUID NOT NULL REFERENCES core.users(id),
    media_type      TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
    url             TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE social.comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES social.posts(id) ON DELETE CASCADE,
    author_user_id  UUID NOT NULL REFERENCES core.users(id),
    body            TEXT NOT NULL,
    moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'flagged')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE social.likes (
    post_id         UUID NOT NULL REFERENCES social.posts(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
