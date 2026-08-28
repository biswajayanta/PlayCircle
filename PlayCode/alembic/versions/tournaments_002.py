"""link tournaments to a real game (matches need a real game_id)

Revision ID: tournaments_002
Revises: tournaments_001
Create Date: 2026-08-23 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "tournaments_002"
down_revision = "tournaments_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE social.tournaments
        ADD COLUMN game_id uuid REFERENCES social.games(id)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE social.tournaments DROP COLUMN IF EXISTS game_id")
