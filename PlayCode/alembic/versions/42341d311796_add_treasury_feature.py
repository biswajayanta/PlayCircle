"""add treasury feature: circle treasurers, advance contributions, kitty tracking

Revision ID: 42341d311796
Revises: 81d8446155de
Create Date: 2026-08-05 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "42341d311796"
down_revision = "81d8446155de"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE financial.circle_treasurers (
            circle_id       uuid PRIMARY KEY REFERENCES social.circles(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES core.users(id),
            set_by_user_id  uuid NOT NULL REFERENCES core.users(id),
            created_at      timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE financial.advance_contributions (
            id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            circle_id             uuid NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
            contributor_user_id   uuid NOT NULL REFERENCES core.users(id),
            amount                numeric(10,2) NOT NULL CHECK (amount > 0),
            note                  text,
            recorded_by_user_id   uuid NOT NULL REFERENCES core.users(id),
            created_at            timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_advance_contributions_circle
        ON financial.advance_contributions (circle_id, contributor_user_id)
        """
    )

    op.execute(
        """
        ALTER TABLE financial.expense_splits
        ADD COLUMN drawn_from_kitty numeric(10,2) NOT NULL DEFAULT 0
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE financial.expense_splits DROP COLUMN drawn_from_kitty")
    op.execute("DROP INDEX IF EXISTS financial.ix_advance_contributions_circle")
    op.execute("DROP TABLE financial.advance_contributions")
    op.execute("DROP TABLE financial.circle_treasurers")
