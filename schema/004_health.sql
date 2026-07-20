-- ============================================================
-- HEALTH SCHEMA
-- Calorie estimates and personal targets. Private by default —
-- a user can choose to surface a *summary* stat to their public
-- profile (handled in the social.profiles toggles), but the raw
-- data here never becomes public itself.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS health;

CREATE TABLE health.calorie_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    match_id            UUID REFERENCES social.matches(id),
    duration_minutes    INTEGER NOT NULL,
    estimated_calories  INTEGER NOT NULL,   -- duration * sport.calorie_coefficient, refined later by wearable data
    source              TEXT NOT NULL DEFAULT 'estimated' CHECK (source IN ('estimated', 'wearable')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE health.targets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    sport_id        INTEGER REFERENCES core.sports(id),   -- null = across all sports
    target_type     TEXT NOT NULL CHECK (target_type IN ('sessions_per_week', 'calories_per_week')),
    target_value    NUMERIC(8,2) NOT NULL,
    start_date      DATE NOT NULL DEFAULT current_date,
    end_date        DATE,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rolling progress per target per period, computed by the app
-- (not a live query every time) so the profile screen stays fast.
CREATE TABLE health.target_progress (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id       UUID NOT NULL REFERENCES health.targets(id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    achieved_value  NUMERIC(8,2) NOT NULL DEFAULT 0,
    UNIQUE (target_id, period_start)
);
