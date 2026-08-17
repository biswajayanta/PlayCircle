"""enrich sports catalog, add health and skill rating features

Reproduces schema that was applied directly to local dev outside of Alembic
(sports.code/indoor_outdoor/min_players/max_players/scoring_config/
calorie_coefficient, the badminton row, health.*, social.skill_ratings).
Written to exactly match a schema-only pg_dump of local, not guessed.

Revision ID: enrich_sports_health_001
Revises: 42341d311796
Create Date: 2026-08-14 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "enrich_sports_health_001"
down_revision = "42341d311796"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Enrich core.sports -------------------------------------------------
    op.execute("ALTER TABLE core.sports ADD COLUMN code text")
    op.execute("ALTER TABLE core.sports ADD COLUMN indoor_outdoor text")
    op.execute("ALTER TABLE core.sports ADD COLUMN min_players smallint NOT NULL DEFAULT 2")
    op.execute("ALTER TABLE core.sports ADD COLUMN max_players smallint NOT NULL DEFAULT 4")
    op.execute("ALTER TABLE core.sports ADD COLUMN scoring_config jsonb NOT NULL DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE core.sports ADD COLUMN calorie_coefficient numeric(5,2) NOT NULL DEFAULT 6.0")
    op.execute("ALTER TABLE core.sports ADD COLUMN is_active boolean NOT NULL DEFAULT true")
    op.execute("ALTER TABLE core.sports ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()")

    # Backfill an existing pickleball row with real values before enforcing
    # NOT NULL. Matched case-insensitively — Azure Dev's actual row is
    # 'pickleball' (lowercase), local's is 'Pickleball' — and normalized to
    # 'Pickleball' everywhere so casing is consistent going forward. If no
    # row exists at all (e.g. a brand new environment), insert one instead
    # of silently doing nothing.
    op.execute("""
        UPDATE core.sports
        SET name = 'Pickleball',
            code = 'pickleball',
            indoor_outdoor = 'both',
            scoring_config = '{"win_by": 2, "best_of": 3, "win_score": 11, "serve_rule": "side_out"}'::jsonb,
            calorie_coefficient = 7.00
        WHERE lower(name) = 'pickleball'
    """)
    op.execute("""
        INSERT INTO core.sports (code, name, indoor_outdoor, min_players, max_players, scoring_config, calorie_coefficient, is_active)
        SELECT 'pickleball', 'Pickleball', 'both', 2, 4,
               '{"win_by": 2, "best_of": 3, "win_score": 11, "serve_rule": "side_out"}'::jsonb, 7.00, true
        WHERE NOT EXISTS (SELECT 1 FROM core.sports WHERE lower(name) = 'pickleball')
    """)

    op.execute("ALTER TABLE core.sports ALTER COLUMN code SET NOT NULL")
    op.execute("ALTER TABLE core.sports ALTER COLUMN indoor_outdoor SET NOT NULL")
    op.execute("""
        ALTER TABLE core.sports
        ADD CONSTRAINT sports_indoor_outdoor_check
        CHECK (indoor_outdoor = ANY (ARRAY['indoor','outdoor','both']))
    """)
    op.execute("ALTER TABLE core.sports ADD CONSTRAINT sports_code_key UNIQUE (code)")

    # Badminton — already exists as real data locally, never migrated.
    op.execute("""
        INSERT INTO core.sports (code, name, indoor_outdoor, min_players, max_players, scoring_config, calorie_coefficient, is_active)
        VALUES ('badminton', 'Badminton', 'indoor', 2, 4, '{}'::jsonb, 6.50, true)
    """)

    # --- health schema --------------------------------------------------
    op.execute("CREATE SCHEMA IF NOT EXISTS health")

    op.execute("""
        CREATE TABLE health.targets (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id      uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            sport_id     integer REFERENCES core.sports(id),
            target_type  text NOT NULL CHECK (target_type = ANY (ARRAY['sessions_per_week','calories_per_week'])),
            target_value numeric(8,2) NOT NULL,
            start_date   date NOT NULL DEFAULT CURRENT_DATE,
            end_date     date,
            is_active    boolean NOT NULL DEFAULT true,
            created_at   timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE health.target_progress (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            target_id       uuid NOT NULL REFERENCES health.targets(id) ON DELETE CASCADE,
            period_start    date NOT NULL,
            period_end      date NOT NULL,
            achieved_value  numeric(8,2) NOT NULL DEFAULT 0,
            UNIQUE (target_id, period_start)
        )
    """)

    op.execute("""
        CREATE TABLE health.calorie_logs (
            id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id              uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            match_id             uuid REFERENCES social.matches(id),
            duration_minutes     integer NOT NULL,
            estimated_calories   integer NOT NULL,
            source               text NOT NULL DEFAULT 'estimated' CHECK (source = ANY (ARRAY['estimated','wearable'])),
            created_at           timestamptz NOT NULL DEFAULT now()
        )
    """)

    # --- social.skill_ratings --------------------------------------------
    op.execute("""
        CREATE TABLE social.skill_ratings (
            user_id         uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            sport_id        integer NOT NULL REFERENCES core.sports(id),
            rating          numeric(6,1) NOT NULL DEFAULT 1000.0,
            matches_played  integer NOT NULL DEFAULT 0,
            updated_at      timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, sport_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS social.skill_ratings")
    op.execute("DROP TABLE IF EXISTS health.calorie_logs")
    op.execute("DROP TABLE IF EXISTS health.target_progress")
    op.execute("DROP TABLE IF EXISTS health.targets")
    op.execute("DROP SCHEMA IF EXISTS health")
    op.execute("DELETE FROM core.sports WHERE code = 'badminton'")
    op.execute("ALTER TABLE core.sports DROP CONSTRAINT IF EXISTS sports_code_key")
    op.execute("ALTER TABLE core.sports DROP CONSTRAINT IF EXISTS sports_indoor_outdoor_check")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS created_at")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS is_active")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS calorie_coefficient")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS scoring_config")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS max_players")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS min_players")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS indoor_outdoor")
    op.execute("ALTER TABLE core.sports DROP COLUMN IF EXISTS code")
