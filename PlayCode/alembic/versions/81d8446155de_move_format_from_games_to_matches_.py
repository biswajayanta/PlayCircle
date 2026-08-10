"""move format from games to matches, remove game capacity

Revision ID: 81d8446155de
Revises: 0388ade53eb3
Create Date: 2026-08-01 11:14:46.182104

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '81d8446155de'
down_revision: Union[str, Sequence[str], None] = '0388ade53eb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the column nullable first so we can backfill existing rows.
    op.execute("ALTER TABLE social.matches ADD COLUMN format text")

    # 2. Backfill every existing match's format from its parent game — this
    # preserves the correct historical value for matches created before this
    # change, since format used to live on the game.
    op.execute("""
        UPDATE social.matches m
        SET format = g.format
        FROM social.games g
        WHERE g.id = m.game_id
    """)

    # 3. Now that every row has a value, enforce it going forward.
    op.execute("ALTER TABLE social.matches ALTER COLUMN format SET NOT NULL")
    op.execute("""
        ALTER TABLE social.matches
        ADD CONSTRAINT matches_format_check CHECK (format = ANY (ARRAY['singles','doubles']))
    """)

    # 4. Games are no longer capped by singles/doubles capacity — any circle
    # member can join. Format is now a per-match decision made when the
    # owner starts each match.
    op.execute("ALTER TABLE social.games DROP COLUMN format")


def downgrade() -> None:
    op.execute("ALTER TABLE social.games ADD COLUMN format text NOT NULL DEFAULT 'doubles'")
    op.execute("""
        ALTER TABLE social.games
        ADD CONSTRAINT games_format_check CHECK (format = ANY (ARRAY['singles','doubles']))
    """)
    op.execute("ALTER TABLE social.matches DROP CONSTRAINT IF EXISTS matches_format_check")
    op.execute("ALTER TABLE social.matches DROP COLUMN IF EXISTS format")
