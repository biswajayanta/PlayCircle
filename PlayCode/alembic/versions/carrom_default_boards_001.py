"""default carrom max_boards to 8

Revision ID: carrom_default_boards_001
Revises: venue_multisport_001
Create Date: 2026-08-18 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "carrom_default_boards_001"
down_revision = "venue_multisport_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE core.sports
        SET scoring_config = scoring_config || '{"max_boards": 8}'::jsonb
        WHERE code = 'carrom'
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE core.sports
        SET scoring_config = scoring_config - 'max_boards'
        WHERE code = 'carrom'
    """)
