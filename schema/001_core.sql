-- ============================================================
-- CORE SCHEMA
-- Sport-agnostic foundation: identity, sport config, venues.
-- Everything else (social/financial/health) references these.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS core;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- needed for gen_random_uuid()

-- One row per sport. This is the key to "pickleball first, extend later" —
-- adding badminton later is a new row here, not a schema change.
CREATE TABLE core.sports (
    id              SERIAL PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,        -- 'pickleball', 'badminton', ...
    name            TEXT NOT NULL,
    indoor_outdoor  TEXT NOT NULL CHECK (indoor_outdoor IN ('indoor', 'outdoor', 'both')),
    min_players     SMALLINT NOT NULL DEFAULT 2,
    max_players      SMALLINT NOT NULL DEFAULT 4,
    -- scoring rules per sport, kept flexible on purpose (e.g. points-to-win,
    -- win-by-2, sets format) so the scorekeeping UI can read this instead of
    -- hardcoding pickleball rules into app logic
    scoring_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- rough MET-based multiplier used for the calorie estimate; refined per
    -- sport later, good enough to seed with a single number for MVP
    calorie_coefficient NUMERIC(5,2) NOT NULL DEFAULT 6.0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.venues (
    id              SERIAL PRIMARY KEY,
    sport_id        INTEGER NOT NULL REFERENCES core.sports(id),
    name            TEXT NOT NULL,
    address         TEXT,
    city            TEXT,
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The single identity table. Note what's deliberately NOT here:
-- no financial fields, no health fields — those live in their own
-- schemas so a bug in the public profile code can never expose them.
CREATE TABLE core.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           TEXT UNIQUE,
    email           TEXT UNIQUE,
    auth_provider   TEXT NOT NULL DEFAULT 'phone',   -- 'phone' | 'google' | 'apple'
    auth_provider_id TEXT,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,                -- AI-generated avatar image URL
    avatar_prompt   TEXT,                -- prompt used to generate it, for regeneration
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_identity_present CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
