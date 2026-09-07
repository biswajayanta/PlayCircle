# Contributing

## Workflow

We use a simple feature-branch flow. `main` is always deployable —
nothing lands there except through a reviewed, passing pull request.

1. **Branch off `main`** for anything you're working on:
   ```bash
   git checkout main
   git pull
   git checkout -b feature/short-description
   ```
   Prefix suggestions: `feature/`, `fix/`, `chore/`.

2. **Commit locally as you go.** Small, focused commits with clear
   messages beat one giant commit.

3. **Push your branch and open a Pull Request** into `main`:
   ```bash
   git push -u origin feature/short-description
   ```
   Then open the PR on GitHub (or via GitHub Desktop's "Create Pull
   Request" button).

4. **Automated checks run on the PR automatically** (see
   `.github/workflows/`) — type-checking, import/syntax smoke tests.
   A red X means something's broken; fix it on the same branch and push
   again, the PR updates automatically.

5. **Request a review.** At least one approval required before merging
   (enforced by branch protection on `main` — see below).

6. **Merge** once approved and checks are green. Prefer "Squash and
   merge" to keep `main`'s history one commit per feature.

7. **Delete the branch** after merging (GitHub offers a button for this).

Merging to `main` automatically deploys to Azure — see
`AZURE_DEPLOYMENT.md`.

## Setting up branch protection (one-time, repo admin)

On GitHub: **Settings → Branches → Add branch protection rule**

- Branch name pattern: `main`
- ✅ Require a pull request before merging
  - ✅ Require approvals (at least 1)
- ✅ Require status checks to pass before merging
  - Select the CI jobs from `deploy-backend.yml` / `deploy-frontend.yml`
    once they've run at least once (they only appear in the list after
    a first run)
- ✅ Do not allow bypassing the above settings (even for admins, if you
  want it strictly enforced)

## Code scanning (one-time, repo admin)

GitHub has built-in scanning that costs nothing extra to enable, worth
turning on from day one:

**Settings → Code security and analysis:**
- **Dependabot alerts** — flags known-vulnerable dependencies
- **Dependabot security updates** — auto-opens PRs to fix them
- **Secret scanning** — catches accidentally-committed API keys/passwords
  *before* they're even fully pushed, in supported cases
- **CodeQL analysis** — static analysis for actual security bugs in the
  code itself; GitHub can auto-generate a starter workflow for this from
  the same settings page

## Local database changes

Always go through Alembic — never hand-edit the schema with `psql`.
See the main README's "Database changes" section. This matters even
more with two people now: if you `ALTER TABLE` by hand locally, your
database silently drifts from what migrations describe, and the next
`alembic upgrade head` either does nothing (thinks it's already done)
or fails outright.

## Secrets

Never commit `.env`. Both `PlayCode/.env` and `PlayCode/PlayCircleApp/.env`
are gitignored — if you ever see one show up in `git status` as
untracked-but-about-to-be-added, stop and check your `.gitignore` before
committing.

## Known gotchas (things that have actually bitten this project)

- **`uvicorn --reload` is not reliable in this setup**, especially on a
  OneDrive-synced working folder (Windows file-watcher flakiness). If a
  backend change doesn't seem to take effect, fully stop and restart
  uvicorn manually before assuming the code is wrong — don't trust
  `--reload` alone to confirm a fix landed.
- **Frontend env changes need a real restart, not a save.** Expo/Metro
  caches `EXPO_PUBLIC_*` values at startup — after editing `.env`, kill and
  restart with `npx expo start --web --clear`.
- **Azure Key Vault references can silently serve a stale value** even
  after saving a new secret version and restarting the App Service. If a
  value you just changed doesn't seem to be in effect, don't assume your
  fix is wrong — verify by temporarily pasting the value in as plain text
  (bypassing Key Vault entirely) to isolate whether Key Vault resolution
  itself is the problem before spending more time chasing the "real" bug.
- **Copy Key Vault reference strings carefully.** A truncated
  `@Microsoft.KeyVault(...)` reference (missing the closing parenthesis is
  an easy one) fails silently rather than erroring loudly — the app
  starts fine, the specific feature depending on that secret just doesn't
  work.
- **A file edit isn't real until you've verified it landed.** Several real
  bugs this project turned out to be "the fix was never actually saved to
  the file" rather than a logic error. Before debugging further, grep the
  actual file on disk for a distinctive string from the intended fix.

