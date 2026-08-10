"""baseline schema

Revision ID: a1689223576a
Revises: a1cf3370a0b7
Create Date: 2026-07-29 05:10:43.687348

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1689223576a'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute("CREATE SCHEMA IF NOT EXISTS social")
    op.execute("CREATE SCHEMA IF NOT EXISTS financial")

    op.execute("""
        CREATE TABLE IF NOT EXISTS core.sports (
            id      SERIAL PRIMARY KEY,
            name    text NOT NULL
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS core.users (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            phone               text UNIQUE,
            email               text UNIQUE,
            auth_provider       text NOT NULL DEFAULT 'phone',
            auth_provider_id    text NOT NULL,
            display_name        text NOT NULL,
            avatar_url          text,
            avatar_prompt       text,
            created_at          timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT users_identity_present CHECK (phone IS NOT NULL OR email IS NOT NULL)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS core.venues (
            id          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            sport_id    integer NOT NULL REFERENCES core.sports(id),
            name        text NOT NULL,
            address     text NOT NULL,
            city        text NOT NULL,
            latitude    numeric(9,6),
            longitude   numeric(9,6),
            is_active   boolean NOT NULL DEFAULT true,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.profiles (
            user_id         uuid PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
            bio             text NOT NULL DEFAULT '',
            city            text,
            is_public       boolean NOT NULL DEFAULT true,
            show_stats      boolean NOT NULL DEFAULT true,
            show_activity   boolean NOT NULL DEFAULT true,
            updated_at      timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.circles (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name            text NOT NULL,
            owner_user_id   uuid NOT NULL REFERENCES core.users(id),
            created_at      timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.circle_members (
            circle_id   uuid NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
            user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            role        text NOT NULL DEFAULT 'member' CHECK (role = ANY (ARRAY['owner','captain','member'])),
            joined_at   timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (circle_id, user_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.games (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            sport_id            integer NOT NULL REFERENCES core.sports(id),
            venue_id            integer NOT NULL REFERENCES core.venues(id),
            creator_user_id     uuid NOT NULL REFERENCES core.users(id),
            circle_id           uuid NOT NULL REFERENCES social.circles(id) ON DELETE CASCADE,
            scheduled_at        timestamptz NOT NULL,
            format              text NOT NULL DEFAULT 'doubles' CHECK (format = ANY (ARRAY['singles','doubles'])),
            visibility          text NOT NULL DEFAULT 'circle' CHECK (visibility = ANY (ARRAY['open','circle','private'])),
            status              text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open','full','completed','cancelled'])),
            created_at          timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.game_participants (
            game_id     uuid NOT NULL REFERENCES social.games(id) ON DELETE CASCADE,
            user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            status      text NOT NULL DEFAULT 'invited' CHECK (status = ANY (ARRAY['invited','confirmed','declined'])),
            joined_at   timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (game_id, user_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.matches (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            game_id     uuid NOT NULL REFERENCES social.games(id),
            sport_id    integer NOT NULL REFERENCES core.sports(id),
            started_at  timestamptz NOT NULL,
            ended_at    timestamptz,
            score       jsonb NOT NULL DEFAULT '{}'::jsonb,
            status      text NOT NULL DEFAULT 'in_progress' CHECK (status = ANY (ARRAY['in_progress','completed','abandoned'])),
            created_at  timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.match_participants (
            match_id        uuid NOT NULL REFERENCES social.matches(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            team            smallint NOT NULL,
            points_scored   smallint,
            result          text CHECK (result = ANY (ARRAY['win','loss','draw'])),
            PRIMARY KEY (match_id, user_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.posts (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            match_id            uuid REFERENCES social.matches(id),
            game_id             uuid REFERENCES social.games(id),
            author_user_id      uuid NOT NULL REFERENCES core.users(id),
            caption             text,
            visibility          text NOT NULL DEFAULT 'public' CHECK (visibility = ANY (ARRAY['public','circle','private'])),
            moderation_status   text NOT NULL DEFAULT 'pending' CHECK (moderation_status = ANY (ARRAY['pending','approved','flagged'])),
            created_at          timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT post_anchored_to_something CHECK (match_id IS NOT NULL OR game_id IS NOT NULL)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.comments (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id             uuid NOT NULL REFERENCES social.posts(id) ON DELETE CASCADE,
            author_user_id      uuid NOT NULL REFERENCES core.users(id),
            body                text NOT NULL,
            moderation_status   text NOT NULL DEFAULT 'pending' CHECK (moderation_status = ANY (ARRAY['pending','approved','flagged'])),
            created_at          timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.likes (
            post_id     uuid NOT NULL REFERENCES social.posts(id) ON DELETE CASCADE,
            user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
            created_at  timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (post_id, user_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS social.media (
            id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id                 uuid NOT NULL REFERENCES social.posts(id) ON DELETE CASCADE,
            uploaded_by_user_id     uuid NOT NULL REFERENCES core.users(id),
            media_type              text NOT NULL CHECK (media_type = ANY (ARRAY['photo','video'])),
            url                     text NOT NULL,
            created_at              timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS financial.expenses (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            game_id             uuid REFERENCES social.games(id),
            match_id            uuid REFERENCES social.matches(id),
            description         text NOT NULL,
            amount              numeric(10,2) NOT NULL,
            currency            character(3) NOT NULL DEFAULT 'INR',
            paid_by_user_id     uuid NOT NULL REFERENCES core.users(id),
            created_at          timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS financial.expense_splits (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            expense_id      uuid NOT NULL REFERENCES financial.expenses(id) ON DELETE CASCADE,
            user_id         uuid NOT NULL REFERENCES core.users(id),
            share_amount    numeric(10,2) NOT NULL,
            is_settled      boolean NOT NULL DEFAULT false,
            settled_at      timestamptz,
            UNIQUE (expense_id, user_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS financial.settlements (
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


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS financial CASCADE")
    op.execute("DROP SCHEMA IF EXISTS social CASCADE")
    op.execute("DROP SCHEMA IF EXISTS core CASCADE")
