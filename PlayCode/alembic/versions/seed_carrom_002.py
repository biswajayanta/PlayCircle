"""seed carrom sport and a starter venue

Revision ID: seed_carrom_002
Revises: tighten_nullability_001
Create Date: 2026-08-17 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "seed_carrom_002"
down_revision = "tighten_nullability_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO core.sports (code, name, indoor_outdoor, min_players, max_players, scoring_config, calorie_coefficient, is_active)
        VALUES ('carrom', 'Carrom', 'indoor', 2, 4, '{"win_score": 25}'::jsonb, 3.50, true)
    """)

    # Placeholder starter venue so a Carrom game can actually be created —
    # edit name/address below to your real clubhouse details before relying
    # on this in a live environment.
    op.execute("""
        INSERT INTO core.venues (sport_id, name, address, city, is_active)
        SELECT id, 'SNN Etternia Society Clubhouse', 'Silver County Road', 'Bengaluru', true
        FROM core.sports WHERE code = 'carrom'
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM core.venues
        WHERE sport_id = (SELECT id FROM core.sports WHERE code = 'carrom')
    """)
    op.execute("DELETE FROM core.sports WHERE code = 'carrom'")
