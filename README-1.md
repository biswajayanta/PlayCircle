# PlayCircle — Data Model (Dev MVP, Step 1)

This is the full data model for PlayCircle, built as plain SQL (no ORM) so
there's nothing hidden between you and what's actually in the database.
Runs against a real local Postgres — validated in this sandbox against
Postgres 16.

## Why plain SQL instead of Prisma/an ORM

The original plan was Prisma, but it fetches its query-engine binaries from
`binaries.prisma.sh` at generate-time, which won't always be reachable from
locked-down networks. Raw SQL sidesteps that entirely, and for learning the
schema deeply first, it's arguably better anyway — you see exactly what
Postgres is doing, no generated client hiding it. You can layer an ORM
(Prisma, Drizzle, or just `pg` + hand-written queries) on top of this schema
later once you're building the API layer — the schema doesn't change either way.

## Structure

```
db/
  schema/
    001_core.sql       -- sports config, venues, users (identity)
    002_social.sql      -- profiles, circles, games, matches, feed
    003_financial.sql   -- expenses, splits, settlements (Court Ledger logic)
    004_health.sql       -- calorie logs, targets, progress
  seed/
    001_pickleball.sql  -- seeds the pickleball sport config
  setup.sh              -- runs everything in order against local Postgres
```

Numbered files = run order. `core` has no dependencies; `social` depends on
`core`; `financial` and `health` depend on both `core` and `social`.

## The four-schema split, and why

This is the single most important design decision in the whole model:
**social, financial, and health data live in separate Postgres schemas**,
not just separate tables.

- `core` — identity (who someone is) and sport/venue config. No public or
  private data lives here beyond raw identity.
- `social` — public by default. Profiles, games, matches, posts, comments.
  Has per-row visibility toggles (`is_public`, `show_stats`, post
  `visibility`) but the *default* is public, because that's the point of a
  social app.
- `financial` — private always. There is no toggle to make an expense or
  settlement public. This is deliberate: money data should never be one
  bug away from leaking onto a public feed.
- `health` — private by default. A user can choose to surface a *summary*
  stat to their public profile (that toggle lives in `social.profiles`),
  but the raw calorie logs and targets themselves never become public.

Why this matters in practice: when you write the API layer next, you can
give the `financial` and `health` services stricter auth middleware than
`social` — by construction, not by convention. A developer (including
future-you) can't accidentally join across schemas and expose something
that shouldn't be public, because the access rules are enforced per-schema
at the API layer, not scattered as `if` checks through business logic.

## Key modeling decisions worth understanding

- **`sports` is a config table, not hardcoded logic.** Scoring rules
  (`scoring_config` JSONB), group size, and calorie coefficient all live as
  data. Adding badminton later means inserting a row, not rewriting code.
- **`games` vs `matches` are separate.** A `game` is "we're planning to
  play" (can be cancelled, never happen). A `match` is "we played" —
  score, participants, result. This split matters because feed posts and
  expenses can anchor to either (e.g. you might want to split court cost
  even if the match never got recorded).
- **Every `post` must anchor to a match or game** (enforced by a CHECK
  constraint, `post_anchored_to_something`). There's no open "write
  anything" timeline — this is what structurally keeps the feed
  sports-only rather than needing heavy moderation to catch off-topic posts.
- **`skill_ratings` is per-user-per-sport**, not a single number on the
  user — someone's pickleball rating and future badminton rating are
  independent.

## Running it yourself

```bash
cd db
./setup.sh
```

This creates a `playcircle` database (if it doesn't exist), runs all four
schema files, then seeds the pickleball sport config. Safe to re-run.

To poke around after:
```bash
psql -U postgres -d playcircle
\dn                          -- list schemas
\dt core.*                   -- list tables in a schema
SELECT * FROM core.sports;   -- see the seeded pickleball config
```

## What's deliberately not here yet

- No leaderboard table — that's a computed view over `skill_ratings` and
  `match_participants`, not raw stored data. Worth adding as a `VIEW` or
  materialized view once there's real match data to query.
- No indexes beyond primary/foreign keys — fine for dev, worth revisiting
  before any real load.
- No row-level security (RLS) policies yet — for MVP the API layer enforces
  access rules, but Postgres RLS is worth adding later as a second layer of
  defense, especially for the `financial` and `health` schemas.

## Next step

Once you've read through this and it makes sense, the natural next piece is
either: (a) a handful of seed users + a fake game/match/expense flowing
through all four schemas so you can see the relationships in action, or
(b) start the API layer (auth + profile endpoints) reading from `core` and
`social`. Your call.
