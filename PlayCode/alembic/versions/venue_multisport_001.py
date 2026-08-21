"""venues can host multiple sports (many-to-many)

Replaces core.venues.sport_id (one sport per venue) with a join table,
core.venue_sports, so a single physical venue can be tagged for multiple
sports (e.g. a clubhouse hosting both Carrom and Pickleball).

Revision ID: venue_multisport_001
Revises: seed_carrom_002
Create Date: 2026-08-17 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "venue_multisport_001"
down_revision = "seed_carrom_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE core.venue_sports (
            venue_id  integer NOT NULL REFERENCES core.venues(id) ON DELETE CASCADE,
            sport_id  integer NOT NULL REFERENCES core.sports(id),
            PRIMARY KEY (venue_id, sport_id)
        )
    """)

    # Backfill: every existing venue currently has exactly one sport via the
    # column we're about to drop — carry that over as its first row here.
    op.execute("""
        INSERT INTO core.venue_sports (venue_id, sport_id)
        SELECT id, sport_id FROM core.venues
    """)

    op.execute("ALTER TABLE core.venues DROP CONSTRAINT IF EXISTS venues_sport_id_fkey")
    op.execute("ALTER TABLE core.venues DROP COLUMN sport_id")


def downgrade() -> None:
    op.execute("ALTER TABLE core.venues ADD COLUMN sport_id integer")

    # A venue that ended up with multiple sports can only downgrade to one —
    # arbitrarily keep the lowest sport_id per venue rather than fail outright.
    op.execute("""
        UPDATE core.venues v
        SET sport_id = (
            SELECT MIN(vs.sport_id) FROM core.venue_sports vs WHERE vs.venue_id = v.id
        )
    """)

    op.execute("ALTER TABLE core.venues ALTER COLUMN sport_id SET NOT NULL")
    op.execute("""
        ALTER TABLE core.venues
        ADD CONSTRAINT venues_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES core.sports(id)
    """)
    op.execute("DROP TABLE core.venue_sports")
