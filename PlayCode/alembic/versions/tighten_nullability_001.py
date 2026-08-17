"""tighten games/matches nullability back to original design

Local dev had these columns loosened to nullable outside of any tracked
migration; Azure environments were never loosened (built from tracked
migrations only), so this is a real fix on local and a safe no-op on Azure.

Revision ID: tighten_nullability_001
Revises: enrich_sports_health_001
Create Date: 2026-08-14 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "tighten_nullability_001"
down_revision = "enrich_sports_health_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # If this fails with a not-null-violation, it means real rows exist with
    # NULLs in one of these columns — stop and look at that data before
    # forcing the constraint, rather than picking a default blindly.
    op.execute("ALTER TABLE social.games ALTER COLUMN venue_id SET NOT NULL")
    op.execute("ALTER TABLE social.games ALTER COLUMN circle_id SET NOT NULL")
    op.execute("ALTER TABLE social.matches ALTER COLUMN game_id SET NOT NULL")
    op.execute("ALTER TABLE social.matches ALTER COLUMN started_at SET NOT NULL")
    op.execute("ALTER TABLE social.match_participants ALTER COLUMN team SET NOT NULL")

    # Restore the cascade-delete behavior the baseline originally had.
    op.execute("ALTER TABLE social.games DROP CONSTRAINT IF EXISTS games_circle_id_fkey")
    op.execute("""
        ALTER TABLE social.games
        ADD CONSTRAINT games_circle_id_fkey
        FOREIGN KEY (circle_id) REFERENCES social.circles(id) ON DELETE CASCADE
    """)

    op.execute("ALTER TABLE social.matches DROP CONSTRAINT IF EXISTS matches_game_id_fkey")
    op.execute("""
        ALTER TABLE social.matches
        ADD CONSTRAINT matches_game_id_fkey
        FOREIGN KEY (game_id) REFERENCES social.games(id)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE social.matches DROP CONSTRAINT IF EXISTS matches_game_id_fkey")
    op.execute("""
        ALTER TABLE social.matches
        ADD CONSTRAINT matches_game_id_fkey
        FOREIGN KEY (game_id) REFERENCES social.games(id)
    """)
    op.execute("ALTER TABLE social.games DROP CONSTRAINT IF EXISTS games_circle_id_fkey")
    op.execute("""
        ALTER TABLE social.games
        ADD CONSTRAINT games_circle_id_fkey
        FOREIGN KEY (circle_id) REFERENCES social.circles(id)
    """)

    op.execute("ALTER TABLE social.match_participants ALTER COLUMN team DROP NOT NULL")
    op.execute("ALTER TABLE social.matches ALTER COLUMN started_at DROP NOT NULL")
    op.execute("ALTER TABLE social.matches ALTER COLUMN game_id DROP NOT NULL")
    op.execute("ALTER TABLE social.games ALTER COLUMN circle_id DROP NOT NULL")
    op.execute("ALTER TABLE social.games ALTER COLUMN venue_id DROP NOT NULL")
