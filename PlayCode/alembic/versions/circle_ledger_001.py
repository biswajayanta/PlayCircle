"""circle ledger: date of birth, drop treasurer/kitty, transfers replace settlements

Revision ID: circle_ledger_001
Revises: profiles_001
Create Date: 2026-08-27 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "circle_ledger_001"
down_revision = "profiles_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE social.profiles
        DROP COLUMN age,
        DROP COLUMN age_verified,
        ADD COLUMN date_of_birth date,
        ADD COLUMN date_of_birth_verified boolean NOT NULL DEFAULT false
    """)

    op.execute("DROP TABLE financial.circle_treasurers")
    op.execute("DROP TABLE financial.advance_contributions")
    op.execute("""
        ALTER TABLE financial.expense_splits
        DROP COLUMN drawn_from_kitty,
        DROP COLUMN is_settled,
        DROP COLUMN settled_at
    """)

    op.execute("DROP TABLE financial.settlements")
    op.execute("""
        CREATE TABLE financial.circle_transfers (
            id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            circle_id             uuid NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
            from_user_id          uuid NOT NULL REFERENCES core.users(id),
            to_user_id            uuid NOT NULL REFERENCES core.users(id),
            amount                numeric(10,2) NOT NULL CHECK (amount > 0),
            note                  text,
            recorded_by_user_id   uuid NOT NULL REFERENCES core.users(id),
            created_at            timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT no_self_transfer CHECK (from_user_id <> to_user_id)
        )
    """)
    op.execute("""
        CREATE INDEX ix_circle_transfers_circle ON financial.circle_transfers (circle_id)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS financial.ix_circle_transfers_circle")
    op.execute("DROP TABLE financial.circle_transfers")
    op.execute("""
        CREATE TABLE financial.settlements (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            from_user_id    uuid NOT NULL REFERENCES core.users(id),
            to_user_id      uuid NOT NULL REFERENCES core.users(id),
            amount          numeric(10,2) NOT NULL,
            method          text NOT NULL DEFAULT 'upi' CHECK (method = ANY (ARRAY['upi','cash','other'])),
            status          text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','completed','failed'])),
            provider_ref    text,
            created_at      timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT no_self_settlement CHECK (from_user_id <> to_user_id)
        )
    """)

    op.execute("""
        ALTER TABLE financial.expense_splits
        ADD COLUMN drawn_from_kitty numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN is_settled boolean NOT NULL DEFAULT false,
        ADD COLUMN settled_at timestamptz
    """)
    op.execute("""
        CREATE TABLE financial.circle_treasurers (
            circle_id       uuid PRIMARY KEY REFERENCES social.circles(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES core.users(id),
            set_by_user_id  uuid NOT NULL REFERENCES core.users(id),
            created_at      timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE financial.advance_contributions (
            id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            circle_id             uuid NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
            contributor_user_id   uuid NOT NULL REFERENCES core.users(id),
            amount                numeric(10,2) NOT NULL CHECK (amount > 0),
            note                  text,
            recorded_by_user_id   uuid NOT NULL REFERENCES core.users(id),
            created_at            timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX ix_advance_contributions_circle
        ON financial.advance_contributions (circle_id, contributor_user_id)
    """)

    op.execute("""
        ALTER TABLE social.profiles
        DROP COLUMN date_of_birth,
        DROP COLUMN date_of_birth_verified,
        ADD COLUMN age integer,
        ADD COLUMN age_verified boolean NOT NULL DEFAULT false
    """)
