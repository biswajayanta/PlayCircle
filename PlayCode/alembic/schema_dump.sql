--
-- PostgreSQL database dump
--

\restrict 0akl4psCDshxQPEkXkaBk5A1EyMhnByvgIAEKpl24Oc4aDz5ArV1SjNd2eSPwwx

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA core;


--
-- Name: financial; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA financial;


--
-- Name: health; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA health;


--
-- Name: social; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA social;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sports; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sports (
    id integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    indoor_outdoor text NOT NULL,
    min_players smallint DEFAULT 2 NOT NULL,
    max_players smallint DEFAULT 4 NOT NULL,
    scoring_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    calorie_coefficient numeric(5,2) DEFAULT 6.0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sports_indoor_outdoor_check CHECK ((indoor_outdoor = ANY (ARRAY['indoor'::text, 'outdoor'::text, 'both'::text])))
);


--
-- Name: sports_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.sports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sports_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.sports_id_seq OWNED BY core.sports.id;


--
-- Name: users; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    email text,
    auth_provider text DEFAULT 'phone'::text NOT NULL,
    auth_provider_id text,
    display_name text NOT NULL,
    avatar_url text,
    avatar_prompt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash text,
    CONSTRAINT users_identity_present CHECK (((phone IS NOT NULL) OR (email IS NOT NULL)))
);


--
-- Name: venues; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.venues (
    id integer NOT NULL,
    sport_id integer NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venues_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.venues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venues_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.venues_id_seq OWNED BY core.venues.id;


--
-- Name: advance_contributions; Type: TABLE; Schema: financial; Owner: -
--

CREATE TABLE financial.advance_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    circle_id uuid NOT NULL,
    contributor_user_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    note text,
    recorded_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT advance_contributions_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: circle_treasurers; Type: TABLE; Schema: financial; Owner: -
--

CREATE TABLE financial.circle_treasurers (
    circle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    set_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: expense_splits; Type: TABLE; Schema: financial; Owner: -
--

CREATE TABLE financial.expense_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expense_id uuid NOT NULL,
    user_id uuid NOT NULL,
    share_amount numeric(10,2) NOT NULL,
    is_settled boolean DEFAULT false NOT NULL,
    settled_at timestamp with time zone,
    drawn_from_kitty numeric(10,2) DEFAULT 0 NOT NULL
);


--
-- Name: expenses; Type: TABLE; Schema: financial; Owner: -
--

CREATE TABLE financial.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid,
    match_id uuid,
    description text NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    paid_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settlements; Type: TABLE; Schema: financial; Owner: -
--

CREATE TABLE financial.settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    method text DEFAULT 'upi'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    provider_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT no_self_settlement CHECK ((from_user_id <> to_user_id)),
    CONSTRAINT settlements_method_check CHECK ((method = ANY (ARRAY['upi'::text, 'cash'::text, 'other'::text]))),
    CONSTRAINT settlements_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: calorie_logs; Type: TABLE; Schema: health; Owner: -
--

CREATE TABLE health.calorie_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    match_id uuid,
    duration_minutes integer NOT NULL,
    estimated_calories integer NOT NULL,
    source text DEFAULT 'estimated'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calorie_logs_source_check CHECK ((source = ANY (ARRAY['estimated'::text, 'wearable'::text])))
);


--
-- Name: target_progress; Type: TABLE; Schema: health; Owner: -
--

CREATE TABLE health.target_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    achieved_value numeric(8,2) DEFAULT 0 NOT NULL
);


--
-- Name: targets; Type: TABLE; Schema: health; Owner: -
--

CREATE TABLE health.targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sport_id integer,
    target_type text NOT NULL,
    target_value numeric(8,2) NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT targets_target_type_check CHECK ((target_type = ANY (ARRAY['sessions_per_week'::text, 'calories_per_week'::text])))
);


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: circle_members; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.circle_members (
    circle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT circle_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'captain'::text, 'member'::text])))
);


--
-- Name: circles; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.circles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comments; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    author_user_id uuid NOT NULL,
    body text NOT NULL,
    moderation_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comments_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'flagged'::text])))
);


--
-- Name: game_participants; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.game_participants (
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_participants_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'confirmed'::text, 'declined'::text])))
);


--
-- Name: games; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sport_id integer NOT NULL,
    venue_id integer,
    creator_user_id uuid NOT NULL,
    circle_id uuid,
    scheduled_at timestamp with time zone NOT NULL,
    visibility text DEFAULT 'circle'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT games_status_check CHECK ((status = ANY (ARRAY['open'::text, 'full'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT games_visibility_check CHECK ((visibility = ANY (ARRAY['open'::text, 'circle'::text, 'private'::text])))
);


--
-- Name: likes; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.likes (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: match_participants; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.match_participants (
    match_id uuid NOT NULL,
    user_id uuid NOT NULL,
    team smallint,
    points_scored smallint,
    result text,
    CONSTRAINT match_participants_result_check CHECK ((result = ANY (ARRAY['win'::text, 'loss'::text, 'draw'::text])))
);


--
-- Name: matches; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid,
    sport_id integer NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    score jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    format text NOT NULL,
    CONSTRAINT matches_format_check CHECK ((format = ANY (ARRAY['singles'::text, 'doubles'::text]))),
    CONSTRAINT matches_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: media; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    uploaded_by_user_id uuid NOT NULL,
    media_type text NOT NULL,
    url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_media_type_check CHECK ((media_type = ANY (ARRAY['photo'::text, 'video'::text])))
);


--
-- Name: posts; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_id uuid,
    game_id uuid,
    author_user_id uuid NOT NULL,
    caption text,
    visibility text DEFAULT 'public'::text NOT NULL,
    moderation_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_anchored_to_something CHECK (((match_id IS NOT NULL) OR (game_id IS NOT NULL))),
    CONSTRAINT posts_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'flagged'::text]))),
    CONSTRAINT posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'circle'::text, 'private'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.profiles (
    user_id uuid NOT NULL,
    bio text,
    city text,
    is_public boolean DEFAULT true NOT NULL,
    show_stats boolean DEFAULT true NOT NULL,
    show_activity boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: skill_ratings; Type: TABLE; Schema: social; Owner: -
--

CREATE TABLE social.skill_ratings (
    user_id uuid NOT NULL,
    sport_id integer NOT NULL,
    rating numeric(6,1) DEFAULT 1000.0 NOT NULL,
    matches_played integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sports id; Type: DEFAULT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sports ALTER COLUMN id SET DEFAULT nextval('core.sports_id_seq'::regclass);


--
-- Name: venues id; Type: DEFAULT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.venues ALTER COLUMN id SET DEFAULT nextval('core.venues_id_seq'::regclass);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: sports sports_code_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sports
    ADD CONSTRAINT sports_code_key UNIQUE (code);


--
-- Name: sports sports_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sports
    ADD CONSTRAINT sports_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: advance_contributions advance_contributions_pkey; Type: CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.advance_contributions
    ADD CONSTRAINT advance_contributions_pkey PRIMARY KEY (id);


--
-- Name: circle_treasurers circle_treasurers_pkey; Type: CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.circle_treasurers
    ADD CONSTRAINT circle_treasurers_pkey PRIMARY KEY (circle_id);


--
-- Name: expense_splits expense_splits_expense_id_user_id_key; Type: CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expense_splits
    ADD CONSTRAINT expense_splits_expense_id_user_id_key UNIQUE (expense_id, user_id);


--
-- Name: expense_splits expense_splits_pkey; Type: CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expense_splits
    ADD CONSTRAINT expense_splits_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: settlements settlements_pkey; Type: CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.settlements
    ADD CONSTRAINT settlements_pkey PRIMARY KEY (id);


--
-- Name: calorie_logs calorie_logs_pkey; Type: CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.calorie_logs
    ADD CONSTRAINT calorie_logs_pkey PRIMARY KEY (id);


--
-- Name: target_progress target_progress_pkey; Type: CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.target_progress
    ADD CONSTRAINT target_progress_pkey PRIMARY KEY (id);


--
-- Name: target_progress target_progress_target_id_period_start_key; Type: CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.target_progress
    ADD CONSTRAINT target_progress_target_id_period_start_key UNIQUE (target_id, period_start);


--
-- Name: targets targets_pkey; Type: CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.targets
    ADD CONSTRAINT targets_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: circle_members circle_members_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.circle_members
    ADD CONSTRAINT circle_members_pkey PRIMARY KEY (circle_id, user_id);


--
-- Name: circles circles_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.circles
    ADD CONSTRAINT circles_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: game_participants game_participants_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.game_participants
    ADD CONSTRAINT game_participants_pkey PRIMARY KEY (game_id, user_id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: likes likes_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: match_participants match_participants_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.match_participants
    ADD CONSTRAINT match_participants_pkey PRIMARY KEY (match_id, user_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: skill_ratings skill_ratings_pkey; Type: CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.skill_ratings
    ADD CONSTRAINT skill_ratings_pkey PRIMARY KEY (user_id, sport_id);


--
-- Name: ix_password_reset_tokens_user_id; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX ix_password_reset_tokens_user_id ON core.password_reset_tokens USING btree (user_id);


--
-- Name: ix_advance_contributions_circle; Type: INDEX; Schema: financial; Owner: -
--

CREATE INDEX ix_advance_contributions_circle ON financial.advance_contributions USING btree (circle_id, contributor_user_id);


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: venues venues_sport_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.venues
    ADD CONSTRAINT venues_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES core.sports(id);


--
-- Name: advance_contributions advance_contributions_circle_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.advance_contributions
    ADD CONSTRAINT advance_contributions_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES social.circles(id) ON DELETE CASCADE;


--
-- Name: advance_contributions advance_contributions_contributor_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.advance_contributions
    ADD CONSTRAINT advance_contributions_contributor_user_id_fkey FOREIGN KEY (contributor_user_id) REFERENCES core.users(id);


--
-- Name: advance_contributions advance_contributions_recorded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.advance_contributions
    ADD CONSTRAINT advance_contributions_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES core.users(id);


--
-- Name: circle_treasurers circle_treasurers_circle_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.circle_treasurers
    ADD CONSTRAINT circle_treasurers_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES social.circles(id) ON DELETE CASCADE;


--
-- Name: circle_treasurers circle_treasurers_set_by_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.circle_treasurers
    ADD CONSTRAINT circle_treasurers_set_by_user_id_fkey FOREIGN KEY (set_by_user_id) REFERENCES core.users(id);


--
-- Name: circle_treasurers circle_treasurers_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.circle_treasurers
    ADD CONSTRAINT circle_treasurers_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id);


--
-- Name: expense_splits expense_splits_expense_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expense_splits
    ADD CONSTRAINT expense_splits_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES financial.expenses(id) ON DELETE CASCADE;


--
-- Name: expense_splits expense_splits_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expense_splits
    ADD CONSTRAINT expense_splits_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id);


--
-- Name: expenses expenses_game_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expenses
    ADD CONSTRAINT expenses_game_id_fkey FOREIGN KEY (game_id) REFERENCES social.games(id);


--
-- Name: expenses expenses_match_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expenses
    ADD CONSTRAINT expenses_match_id_fkey FOREIGN KEY (match_id) REFERENCES social.matches(id);


--
-- Name: expenses expenses_paid_by_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.expenses
    ADD CONSTRAINT expenses_paid_by_user_id_fkey FOREIGN KEY (paid_by_user_id) REFERENCES core.users(id);


--
-- Name: settlements settlements_from_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.settlements
    ADD CONSTRAINT settlements_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES core.users(id);


--
-- Name: settlements settlements_to_user_id_fkey; Type: FK CONSTRAINT; Schema: financial; Owner: -
--

ALTER TABLE ONLY financial.settlements
    ADD CONSTRAINT settlements_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES core.users(id);


--
-- Name: calorie_logs calorie_logs_match_id_fkey; Type: FK CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.calorie_logs
    ADD CONSTRAINT calorie_logs_match_id_fkey FOREIGN KEY (match_id) REFERENCES social.matches(id);


--
-- Name: calorie_logs calorie_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.calorie_logs
    ADD CONSTRAINT calorie_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: target_progress target_progress_target_id_fkey; Type: FK CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.target_progress
    ADD CONSTRAINT target_progress_target_id_fkey FOREIGN KEY (target_id) REFERENCES health.targets(id) ON DELETE CASCADE;


--
-- Name: targets targets_sport_id_fkey; Type: FK CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.targets
    ADD CONSTRAINT targets_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES core.sports(id);


--
-- Name: targets targets_user_id_fkey; Type: FK CONSTRAINT; Schema: health; Owner: -
--

ALTER TABLE ONLY health.targets
    ADD CONSTRAINT targets_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: circle_members circle_members_circle_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.circle_members
    ADD CONSTRAINT circle_members_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES social.circles(id) ON DELETE CASCADE;


--
-- Name: circle_members circle_members_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.circle_members
    ADD CONSTRAINT circle_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: circles circles_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.circles
    ADD CONSTRAINT circles_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES core.users(id);


--
-- Name: comments comments_author_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.comments
    ADD CONSTRAINT comments_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES core.users(id);


--
-- Name: comments comments_post_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.comments
    ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES social.posts(id) ON DELETE CASCADE;


--
-- Name: game_participants game_participants_game_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.game_participants
    ADD CONSTRAINT game_participants_game_id_fkey FOREIGN KEY (game_id) REFERENCES social.games(id) ON DELETE CASCADE;


--
-- Name: game_participants game_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.game_participants
    ADD CONSTRAINT game_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: games games_circle_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.games
    ADD CONSTRAINT games_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES social.circles(id);


--
-- Name: games games_creator_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.games
    ADD CONSTRAINT games_creator_user_id_fkey FOREIGN KEY (creator_user_id) REFERENCES core.users(id);


--
-- Name: games games_sport_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.games
    ADD CONSTRAINT games_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES core.sports(id);


--
-- Name: games games_venue_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.games
    ADD CONSTRAINT games_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES core.venues(id);


--
-- Name: likes likes_post_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.likes
    ADD CONSTRAINT likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES social.posts(id) ON DELETE CASCADE;


--
-- Name: likes likes_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.likes
    ADD CONSTRAINT likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: match_participants match_participants_match_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.match_participants
    ADD CONSTRAINT match_participants_match_id_fkey FOREIGN KEY (match_id) REFERENCES social.matches(id) ON DELETE CASCADE;


--
-- Name: match_participants match_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.match_participants
    ADD CONSTRAINT match_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: matches matches_game_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.matches
    ADD CONSTRAINT matches_game_id_fkey FOREIGN KEY (game_id) REFERENCES social.games(id);


--
-- Name: matches matches_sport_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.matches
    ADD CONSTRAINT matches_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES core.sports(id);


--
-- Name: media media_post_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.media
    ADD CONSTRAINT media_post_id_fkey FOREIGN KEY (post_id) REFERENCES social.posts(id) ON DELETE CASCADE;


--
-- Name: media media_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.media
    ADD CONSTRAINT media_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES core.users(id);


--
-- Name: posts posts_author_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.posts
    ADD CONSTRAINT posts_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES core.users(id);


--
-- Name: posts posts_game_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.posts
    ADD CONSTRAINT posts_game_id_fkey FOREIGN KEY (game_id) REFERENCES social.games(id);


--
-- Name: posts posts_match_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.posts
    ADD CONSTRAINT posts_match_id_fkey FOREIGN KEY (match_id) REFERENCES social.matches(id);


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- Name: skill_ratings skill_ratings_sport_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.skill_ratings
    ADD CONSTRAINT skill_ratings_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES core.sports(id);


--
-- Name: skill_ratings skill_ratings_user_id_fkey; Type: FK CONSTRAINT; Schema: social; Owner: -
--

ALTER TABLE ONLY social.skill_ratings
    ADD CONSTRAINT skill_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 0akl4psCDshxQPEkXkaBk5A1EyMhnByvgIAEKpl24Oc4aDz5ArV1SjNd2eSPwwx

