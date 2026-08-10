"""drop erroneous duplicate columns from core.users

Revision ID: a1cf3370a0b7
Revises: 1985d7e49272
Create Date: 2026-07-25 12:29:48.623814

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1cf3370a0b7'
down_revision: Union[str, Sequence[str], None] = '1985d7e49272'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # These were mistakenly added directly to core.users at some point during
    # manual troubleshooting. The real, correct columns of the same names
    # already live on social.profiles — the app never reads or writes these
    # ones on core.users. IF EXISTS makes this safe to run whether or not a
    # given environment actually has them.
    op.execute("ALTER TABLE core.users DROP COLUMN IF EXISTS bio")
    op.execute("ALTER TABLE core.users DROP COLUMN IF EXISTS city")
    op.execute("ALTER TABLE core.users DROP COLUMN IF EXISTS is_public")


def downgrade() -> None:
    op.execute("ALTER TABLE core.users ADD COLUMN bio text")
    op.execute("ALTER TABLE core.users ADD COLUMN city text")
    op.execute("ALTER TABLE core.users ADD COLUMN is_public boolean")
