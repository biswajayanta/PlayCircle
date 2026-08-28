"""add tournaments (phase 1: closed, single-sport, knockout only)

Revision ID: tournaments_001
Revises: carrom_default_boards_001
Create Date: 2026-08-21 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "tournaments_001"
down_revision = "carrom_default_boards_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE social.tournaments (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            circle_id           uuid NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
            sport_id            integer NOT NULL REFERENCES core.sports(id),
            name                text NOT NULL,
            creator_user_id     uuid NOT NULL REFERENCES core.users(id),
            format              text NOT NULL DEFAULT 'knockout' CHECK (format = ANY (ARRAY['knockout'])),
            status              text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','fixture_set','in_progress','completed','cancelled'])),
            created_at          timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE social.tournament_participants (
            tournament_id   uuid NOT NULL REFERENCES social.tournaments(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            joined_at       timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (tournament_id, user_id)
        )
    """)

    op.execute("""
        CREATE TABLE social.tournament_matches (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id       uuid NOT NULL REFERENCES social.tournaments(id) ON DELETE CASCADE,
            round_number        integer NOT NULL,
            position_in_round   integer NOT NULL,
            player_1_user_id    uuid REFERENCES core.users(id),
            player_2_user_id    uuid REFERENCES core.users(id),
            winner_user_id      uuid REFERENCES core.users(id),
            match_id            uuid REFERENCES social.matches(id),
            status              text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','ready','in_progress','completed','walkover'])),
            created_at          timestamptz NOT NULL DEFAULT now(),
            UNIQUE (tournament_id, round_number, position_in_round)
        )
    """)
    op.execute("""
        CREATE INDEX ix_tournament_matches_tournament
        ON social.tournament_matches (tournament_id, round_number)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS social.tournament_matches")
    op.execute("DROP TABLE IF EXISTS social.tournament_participants")
    op.execute("DROP TABLE IF EXISTS social.tournaments")
