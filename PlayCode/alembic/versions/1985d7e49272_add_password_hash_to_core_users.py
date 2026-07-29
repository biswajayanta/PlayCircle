"""add password_hash to core.users

Revision ID: 1985d7e49272
Revises: 
Create Date: 2026-07-23 06:48:49.627004

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1985d7e49272'
down_revision: Union[str, Sequence[str], None] = 'a1689223576a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE core.users ADD COLUMN password_hash text")


def downgrade() -> None:
    op.execute("ALTER TABLE core.users DROP COLUMN password_hash")
