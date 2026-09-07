# PlayCircle — Development Handoff Notes

Written at the point of switching from Claude (chat) to Claude Code for
continued development. Read this before making changes — it captures
architecture decisions, what's genuinely solid, and what's known to be
rough or incomplete.

## What exists today

- **Pluggable sport scoring** (`app/scoring/`): `base.py` defines the
  `ScoringEngine` interface (`initial_score`, `apply_point`,
  `undo_last_point`, `is_complete`, `winner`). `carrom.py` (board-based,
  race to a target) and `pickleball.py` (set-based, rally scoring within
  each set, win-by-2, always plays every configured set — no early stop)
  both implement it. `registry.py` maps a sport name to its engine. Adding
  a new sport means writing one new engine file and registering it —
  nothing else needs to change.
- **Tournaments** (`app/tournaments/`, `app/routers/tournaments.py`,
  `app/schemas/tournament.py`): single-elimination knockout brackets,
  scoped to one circle and one sport. Key design decision: once a
  tournament match starts, it becomes a completely ordinary
  `social.matches` row using the exact same scoring engines and
  `/matches/{id}/points` /`undo`/`complete` endpoints as any other match.
  The tournament layer's only real logic is (1) bracket generation
  (`bracket.py`) and (2) propagating a winner into the next round
  (`propagate.py`), hooked into both the automatic win-condition
  completion path and the manual conclude-early path in
  `app/routers/matches.py`.
  - **Byes are not auto-resolved.** A lone player in a slot with no
    opponent gets a "TBD" placeholder, not an automatic win. The bye only
    resolves — as a walkover — the moment someone actually taps Start on
    that match. Before that, the TBD slot is editable: a new joiner can
    fill it.
  - **Round 1 lock**: participants can be added, removed, or swapped
    freely as long as at least one Round 1 match is still undecided, even
    if others have already been played. The moment every Round 1 match
    reaches completed/walkover, positions lock permanently — no changes
    in any round after that.
  - **Known limitation**: if new joiners push the participant count past
    the bracket's original capacity (more players than there are open/TBD
    slots), the API returns a clear 409 rather than attempting to grow the
    bracket. Growing an in-flight bracket (inserting new Round 1 slots and
    the corresponding new Round 2+ structure) was scoped out as
    "genuinely gnarly" — see `tournament_dynamic_design.md` if it's
    resurrected as a task; it also may not have survived the sandbox
    reset mentioned below, so treat that filename as a pointer to redo the
    thinking, not a guaranteed-present reference doc.
  - **Bracket UI has two view modes** — a round-by-round list
    (`app/tournaments/[id]/index.tsx`) and a computed tree view
    (`components/BracketTree.tsx`, pure `View`/border-based connectors,
    deliberately no `react-native-svg` dependency). Player-swap
    ("Rearrange Players") only works in List view currently — switching to
    Rearrange mode forces List view.
- **In-app AI assistant** (`app/assistant/`, `app/routers/assistant.py`,
  `components/AssistantBubble.tsx`): uses the OpenAI API (not Anthropic —
  deliberate choice, they already had an OpenAI key). Critical
  architecture decision: the assistant's "tools" are implemented as real
  HTTP calls to the app's own API (`app/assistant/dispatcher.py`), using
  the requesting user's own JWT — not internal Python function calls. This
  means the assistant can never do anything a human couldn't already do by
  tapping the equivalent button, and it can't silently drift out of sync
  with how an endpoint actually behaves.
  - Every state-changing action requires explicit user confirmation via a
    real UI button before executing — the model proposing an action and it
    actually happening are two separate steps, enforced by the frontend
    (a pending action disables free-text input until Confirm/Cancel).
  - Conversation history is the *raw* OpenAI message list (including tool
    calls/results), echoed back and forth between frontend and backend —
    not a simplified text summary. This was a real bug fix: a simplified
    text history means the model only remembers the *words* of its own
    past replies, not real IDs it looked up, which breaks any multi-turn
    flow referencing something from an earlier turn.
  - Internal breadcrumb notes injected into history (marking a proposed-or-
    completed action) use `role: "system"`, not `role: "assistant"` —
    using `assistant` role caused the model to eventually mimic and leak
    that internal formatting into visible replies, since it read those
    notes as its own prior speech.
- **Member profiles** (`app/routers/users.py` additions,
  `app/profile/[userId].tsx`, `app/search.tsx`): search by name (reuses
  the pre-existing `/users/search`, scoped to public profiles), a profile
  view with auto-computed performance stats (wins/losses/win-rate per
  sport, tournaments played — computed live from match/tournament data,
  not stored), and user-added achievements (sport, level, event, rank).
  Every structured field (age, height, weight, each achievement) has a
  `verified` boolean that always defaults `false` — no verification
  mechanism exists yet by design; this just gets the flag in place and
  displayed for whenever that's built.

## Known gaps / honest technical debt

- **No automated tests** for Carrom/Pickleball scoring, Tournaments, the
  Assistant, or Member Profiles — all verified through extensive manual
  curl and UI testing during development, never turned into `pytest`
  files. See `REGRESSION_TEST_PLAN.md`'s "Known gap" section. This is the
  single most valuable thing to prioritize next from a
  long-term-maintainability standpoint.
- **Manual bracket seeding UI was never built** — the backend
  (`POST /tournaments/{id}/bracket`) accepts either `random_seed: true` or
  an explicit `seeding` array, but the frontend only ever sends
  `random_seed: true`. Wiring up a reorderable-list UI for manual seeding
  is a contained, backend-complete task.
- **Growing a bracket beyond original capacity** isn't implemented (see
  above) — currently a clear error, not silent corruption, but not a real
  feature either.
- **Two flagged, unverified assumptions** in the profile-feature frontend:
  `useAuth()` is assumed to return `{ user: { user_id, ... } }` based on
  patterns inferred elsewhere in the app, never confirmed against the
  actual `authContext.tsx`. Check this first if `search.tsx` or
  `app/profile/[userId].tsx` show auth-related type errors.
- **The GRC assessment document** (`PlayCircle_GRC_Assessment.docx`) was
  not updated as part of this documentation pass — it was uploaded for
  reference but its content didn't extract into readable text, so it
  couldn't be safely edited without risking overwriting something
  unseen. Worth a fresh look with whatever's actually in it.

## Environment / operational notes

- **Backend**: FastAPI + asyncpg, raw SQL throughout (no ORM). Migrations
  via Alembic — always dry-run against a scratch database before applying
  anywhere real; this project's own history includes at least one schema
  change that would have gone out wrong without that check.
- **`uvicorn --reload` is unreliable in this project's dev setup**
  (Windows + OneDrive-synced folder) — don't trust it to confirm a fix
  landed; do a full manual restart instead. See `CONTRIBUTING.md`'s
  gotchas section for this and several other real issues hit during
  development (Key Vault reference caching, Expo env-var caching, etc.).
- **`main` requires a Pull Request** — direct pushes are rejected by
  branch protection, even for the repo owner. Promote `dev` → `main` via
  GitHub's PR UI, not `git push`.
- **Three environments**: Dev (push to `dev`), UAT (merge to `main`, auto-
  deploys, no approval gate), Prod (manual approval after UAT). All on one
  shared Postgres server, separate databases per environment.

## A note on how this session actually went, for calibration

This project was built through many hours of iterative, closely-verified
work — every schema change dry-run against a scratch database first, every
non-trivial code change type-checked and (where feasible) tested before
being called done, and several real bugs were caught specifically *because*
of that verification discipline rather than despite skipping it (a stale
Key Vault value, a truncated secret reference, a `uvicorn --reload` that
silently wasn't picking up changes, a file that was described as "fixed"
but never actually got saved to disk). Whoever picks this up next —
human or Claude Code — will get the most out of this codebase by keeping
that same discipline: verify a fix actually landed before trusting it,
dry-run schema changes, and don't assume a described fix is a real fix
until it's been checked against what's actually running.

Partway through this session, the working environment was reset
unexpectedly (a sandbox/session boundary, not anything in the project
itself), and recovery relied on files that had already been shared with
the user — a reminder that "shared with the user" is a more durable state
than "sitting in a scratch workspace," worth keeping in mind for any
future AI-assisted session on this codebase too.
