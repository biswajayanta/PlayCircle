"""member profiles: extend social.profiles, add achievements table

Revision ID: profiles_001
Revises: tournaments_002
Create Date: 2026-08-25 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "profiles_001"
down_revision = "tournaments_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE social.profiles
        ADD COLUMN sports_interest text,
        ADD COLUMN age integer,
        ADD COLUMN age_verified boolean NOT NULL DEFAULT false,
        ADD COLUMN height_cm numeric(5,1),
        ADD COLUMN height_verified boolean NOT NULL DEFAULT false,
        ADD COLUMN weight_kg numeric(5,1),
        ADD COLUMN weight_verified boolean NOT NULL DEFAULT false
    """)

    op.execute("""
        CREATE TABLE social.achievements (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            sport_id    integer NOT NULL REFERENCES core.sports(id),
            level       text NOT NULL,
            event_name  text NOT NULL,
            rank        text NOT NULL,
            verified    boolean NOT NULL DEFAULT false,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX ix_achievements_user ON social.achievements (user_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS social.achievements")
    op.execute("""
        ALTER TABLE social.profiles
        DROP COLUMN IF EXISTS sports_interest,
        DROP COLUMN IF EXISTS age,
        DROP COLUMN IF EXISTS age_verified,
        DROP COLUMN IF EXISTS height_cm,
        DROP COLUMN IF EXISTS height_verified,
        DROP COLUMN IF EXISTS weight_kg,
        DROP COLUMN IF EXISTS weight_verified
    """)
