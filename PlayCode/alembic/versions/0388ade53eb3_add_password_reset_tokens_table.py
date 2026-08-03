"""add password reset tokens table

Revision ID: 0388ade53eb3
Revises: a1cf3370a0b7
Create Date: 2026-08-01 07:41:46.917733

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0388ade53eb3'
down_revision: Union[str, Sequence[str], None] = 'a1cf3370a0b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE core.password_reset_tokens (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            token_hash  text NOT NULL UNIQUE,
            expires_at  timestamptz NOT NULL,
            used_at     timestamptz,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX ix_password_reset_tokens_user_id ON core.password_reset_tokens(user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.password_reset_tokens")
