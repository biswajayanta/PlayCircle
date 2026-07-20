-- ============================================================
-- FINANCIAL SCHEMA
-- Court Ledger's logic, now tied to matches/games instead of
-- entered manually. Private by default, ALWAYS — no public toggle
-- exists for this schema on purpose.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS financial;

CREATE TABLE financial.expenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID REFERENCES social.games(id),
    match_id        UUID REFERENCES social.matches(id),
    description     TEXT NOT NULL,          -- 'Court fee', 'Balls', 'Post-game snacks'
    amount          NUMERIC(10,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'INR',
    paid_by_user_id UUID NOT NULL REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who owes what share of a given expense.
CREATE TABLE financial.expense_splits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id      UUID NOT NULL REFERENCES financial.expenses(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id),
    share_amount    NUMERIC(10,2) NOT NULL,
    is_settled      BOOLEAN NOT NULL DEFAULT false,
    settled_at      TIMESTAMPTZ,
    UNIQUE (expense_id, user_id)
);

-- Actual money movement between two users to settle up a running tab.
CREATE TABLE financial.settlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id    UUID NOT NULL REFERENCES core.users(id),
    to_user_id      UUID NOT NULL REFERENCES core.users(id),
    amount          NUMERIC(10,2) NOT NULL,
    method          TEXT NOT NULL DEFAULT 'upi' CHECK (method IN ('upi', 'cash', 'other')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    provider_ref    TEXT,             -- Razorpay/Cashfree transaction id
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT no_self_settlement CHECK (from_user_id <> to_user_id)
);
