# Plan 024 - Branch reconciliation and testing sprint

> Read `CLAUDE.md`, `docs/TESTING.md`, and `plans/README.md` before work.
> Planned at `c1802de` (docs/plans-021-022-023), 2026-09-14. Drift check:
> re-run the branch/worktree inventory below before executing any step —
> branch tips move.

## Status

- Priority: P0 — blocks landing plans 021/022 and any future PR against `main`
- Effort: M (mostly mechanical; one real code merge in `board.rs`)
- Depends on: none technically, but should run before any more feature work
  lands, since every current worktree is built on a stale base
- Step A: DONE (PR #28, merged `aca6b50`; local `main` fast-forwarded).
  Step B: DONE (both worktrees rebased and pushed, gates green, not
  merged — see below). Step D: DONE (PR #27 merged, PR #25 closed, 9 dead
  branches deleted). Step C: not started — needs live app testing, no
  further autonomous work possible.

## Why this matters

Local `main` and `origin/main` diverged silently:

- `origin/main` (`aae8547`) has PR #26 (Phase 33.1 spend fixes, Phase 34
  Codex audit, Sidebar LM Claude override) that local `main` does not have.
- Local `main` has two commits `origin/main` does not have:
  `e11e468` (docs: Phase 32 §44 live-matrix approval) and `2a4c481`
  (feat: seed example `board.md` on first open) — neither was ever pushed.
- Both sides edit `src-tauri/src/board.rs`'s `read_board`/`write_board`:
  PR #26 made them `async fn` + `spawn_blocking` (the Plan 017 freeze fix);
  `2a4c481` added seed-on-first-open logic to the old sync bodies. This is a
  real code conflict, not a text conflict — confirmed by a scratch-worktree
  cherry-pick that failed on `docs/TESTING.md` before even reaching
  `board.rs`.
- Both in-flight feature worktrees — `feat/safe-router-traffic` (Plan 022)
  and `phase33-contextual-first-run` (Plan 021) — branched from local
  `main`'s stale tip `2a4c481`. Neither has PR #26's fixes. Both also touch
  `docs/TESTING.md`, which PR #26 restructured heavily (new §45-50), so a
  naive rebase will hit conflicts there too even though the actual feature
  code likely doesn't overlap.
- `PR #25` (`feat/phase33-decision-integrity`) is still open on GitHub. Its
  content — guessed natural-language reconciliation — was descoped by
  Plan 016 and superseded by what's already in `main` via PR #26. It should
  not be merged.
- Separately, a real testing backlog has built up across four phases/plans
  while this branch churn was happening (see inventory below).

Fixing the branch split is a prerequisite for the testing sprint: you can't
give a clean live-test verdict on Plan 021/022 code that isn't sitting on
top of the fixes (spawn_blocking, extractor spend, schema-drift tripwire)
those live tests are partly meant to exercise.

## Current inventory (as of 2026-09-14, verify before running)

**Branches/worktrees:**

| Ref | Base | State |
|---|---|---|
| `origin/main` (`aae8547`) | — | Canonical. Has PR #26. |
| local `main` (`2a4c481`) | `57e806e` + 2 unpushed commits | Diverged from origin; not canonical |
| `docs/plans-021-022-023` (PR #27, open) | `origin/main` | Clean, docs-only, already correct |
| `feat/safe-router-traffic` (worktree `/tmp/context-terminal-safe-router`) | local `main` `2a4c481` | Plan 022 impl, not pushed, missing PR #26 |
| `phase33-contextual-first-run` (worktree `/tmp/context-terminal-phase33`, PR-less but pushed to origin) | local `main` `2a4c481` | Plan 021 impl, missing PR #26 |
| `feat/phase33-decision-integrity` (PR #25, open) | old | Superseded by Plan 016 + PR #26 — recommend **close, don't merge** |
| `docs/contributor-onramp`, `docs/screenshot-refresh`, `fix/clickable-links` | — | Merged, remote gone — local-only leftovers, safe to delete |
| `loop/footer-test`, `pr18-fix`, `pr19-fix`, `pr19-retrigger`, `pr19-retry2`, `feat/phase33.1-haiku-default` | — | Dead-end experiment/scratch branches, superseded — candidates for delete after a quick look |

**Testing backlog** (grep `docs/TESTING.md` for `^- \[ \]` before trusting
this list — items move):

1. ~~**Phase 31 (§43) clean-profile live matrix**~~ — **correction
   (2026-09-14): not runnable standalone.** §43's own 2026-09-13 close-out
   note says explicitly: do not mark these boxes passed; this matrix is
   superseded by Plan 021's own clean-profile matrix once that plan is
   accepted (Plan 021's first-run project-or-home choice replaces the
   default-home-PTY premise this one tests). Folded into item 5 below.
2. ~~**Phase 30 (§42) residual regression groups**~~ — **correction
   (2026-09-14): not open debt.** Every §42 item is already `[x]` or `[-]`;
   the two `[-]` groups (Landing Note/modal drag-through, file-drop/
   text-select/panel-resize/native-edge resize) were explicitly
   maintainer-accepted without rerun under `PHASE 30 APPROVED`. Nothing to
   test here — removed from the backlog.
2b. **§26 diff pop-out from Accomplished rows (issue #10) — newly found,
   was missing from this plan's original inventory.** Shipped in PR #20
   (2026-09-06), written and tested on Windows only — the section header
   reads "every box below is unverified and needs a Mac pass," 8 unchecked
   items, no later closure note anywhere in `docs/TESTING.md`, `CLAUDE.md`,
   or `plans/README.md`. Real standalone debt, no code dependency.
3. **Plan 018 (§49) schema-drift tripwire** — two items unverified live:
   simulate 20 unrecognized transcript lines and confirm the warning fires
   once (not per-line). Synthetic-only, low priority, quick to run.
4. **Tab-restore-loses-a-tab landmine** (CLAUDE.md, found 2026-09-11) — not
   yet root-caused. Bug hunt, not a checklist item; scope separately if it
   still reproduces.
5. **Plan 021 (contextual first-run)** — has its own `docs/TESTING.md`
   additions already committed on `phase33-contextual-first-run`; not yet
   live-tested at all (code was only just written).
6. **Plan 022 (Safe Router traffic view)** — same: `docs/TESTING.md`
   additions already committed on `feat/safe-router-traffic`, not yet
   live-tested.

Not in scope for this plan: Plan 023 (statusLine limits meter) is still
idea/plan-only, no code — nothing to test yet.

## Sequencing

### Step A — Reconcile `main` (do first, blocks everything else)

1. New branch `chore/reconcile-main` off `origin/main`.
2. Re-apply `2a4c481`'s board-seed logic inside PR #26's
   `read_board_blocking` (the sync inner fn), not the `async` wrapper. Keep
   PR #26's `spawn_blocking` structure untouched. Re-run `board.rs`'s unit
   tests, including the seed-specific one from `2a4c481`.
3. Re-apply `e11e468`'s §44 disposition into `origin/main`'s fuller §44
   content (origin's branch wrote the detailed partial-evidence version
   before the full pass landed; CLAUDE.md's Phase 32 status line already
   records the factual outcome — "ACCEPTED 2026-09-11 — live macOS matrix
   all 5 tests passed" — so this is a transcription of an already-decided
   fact, not a new claim). Mark the leftover `[ ]` items in that block
   accordingly and add `PHASE 32 APPROVED.` in place, ahead of §45.
4. `cargo test`, `cargo clippy -D warnings`, `npm run check`, `tsc --noEmit`,
   `npm run build`, `git diff --check`.
5. PR `chore/reconcile-main` → `main`, get it merged.
6. Locally: `git fetch && git checkout main && git reset --hard origin/main`
   (safe — local main's only unique content is now upstream).

### Step B — Rebase the two feature worktrees onto reconciled `main`

7. `feat/safe-router-traffic`: rebase onto new `origin/main`. Expect a
   `docs/TESTING.md` insertion-point conflict only (its feature files
   — `safe_router_traffic.rs`, `ModelTraffic.tsx`, `modelTraffic.ts`,
   `repo.ts` — shouldn't overlap PR #26). Resolve by keeping both sections.
   Re-run `cargo test`, `npm run check`.
8. `phase33-contextual-first-run`: same rebase, same expected conflict
   shape (`docs/TESTING.md` only; its files — `OnboardingModal.tsx`,
   `pty.rs`, `AgentStatusBar.tsx`, `onboarding.ts` — shouldn't overlap
   PR #26 or the board fix). Re-run gates.
9. Push both rebased branches. **Do not open/merge PRs for these yet** —
   plans 021 and 022 are still marked CANDIDATE in `plans/README.md`; that
   needs an explicit maintainer decision, separate from this plan.

**Done (2026-09-14).** Both branches rebased `--onto origin/main` (past the
now-duplicated `e11e468`/`2a4c481`), pushed with `--force-with-lease`:

- `feat/safe-router-traffic` → `489ea6a`. Conflicts: `package.json` (merged
  both `check` script additions — `decision-integrity:check` from PR #26,
  `model-traffic:check` from this branch), `plans/README.md` (kept PR #26's
  rows 012-020, appended this branch's own row 022 unchanged — did not pull
  in today's CANDIDATE reframing from PR #27, out of scope for a rebase).
  Gates: 69/69 Rust tests, clippy clean, 27/27 frontend checks (new
  `model-traffic:check` included), tsc, build, diff-check.
- `phase33-contextual-first-run` → `575c26a`. One real code conflict in
  `src-tauri/src/pty.rs`'s test-module import list (`has_own_repo` from
  PR #26's freeze fix vs. `preflight_directory` from this branch, plus its
  new test) — merged both imports, kept the new test. Gates: 64/64 Rust
  tests (including the merged `directory_preflight_...` test), clippy
  clean, 26/26 frontend checks, tsc, build, diff-check.

Neither PR opened, per the instruction above.

### Step C — Testing sprint (after Step A; Step B only blocks items 5-6)

**Corrected (2026-09-14)** — see the inventory corrections above. Suggested
order, cheapest/most-isolated first:

10. **DONE (2026-09-14).** Plan 018 tripwire synthetic checks (§49) — both
    live items confirmed: warning fires with the correct message on 20
    synthetic unrecognized lines, and stays fired-once (no spam) through
    10 more plus a real turn. See `docs/TESTING.md` §49's live evidence.
    Side note: appending to a transcript file must be done by a human's own
    hands — Claude Code's "Session Transcript Tampering" classifier blocks
    any agent tool-call attempt, even against a disposable scratch file.
11. **DONE (2026-09-14).** §26 diff pop-out Mac pass — all 8 items
    verified live (screenshots + cross-checked scratch-repo file/git
    state), replacing 8+ months of Windows-only-unverified status. See
    `docs/TESTING.md` §26's live evidence note. Two real side-findings
    surfaced and fixed during this pass, both written up as new/updated
    `CLAUDE.md` landmines: the stray `~/.git` landmine recurred (found and
    actually deleted this time, not just defended against again), and a
    new one — launching the dev server from inside a Claude Code CLI shell
    leaks `CLAUDE_CODE_CHILD_SESSION` to every spawned tab, silently
    disabling transcript saving. Neither invalidates the §26 verdict
    itself (Accomplished rows read hook events, not transcripts). Replaces
    the old item 11 (Phase 31 §43, now correctly deferred to item 13 below
    instead of run standalone).
12. ~~Phase 30 §42 residual regressions~~ — removed, already closed (see
    correction above).
13. Plan 021 live matrix, including its own replacement clean-profile
    matrix (supersedes Phase 31 §43) — needs Step B done (already is) and
    a maintainer approval decision on Plan 021 first.
14. Plan 022 live matrix (needs Step B done — already is — and a
    maintainer approval decision on Plan 022 first).
15. Re-attempt repro on the tab-restore-loses-a-tab landmine while other
    multi-tab live testing is already happening (items 13-14 involve
    quit/relaunch cycles — cheap to watch for it).

### Step D — Housekeeping (any time, low risk, confirm before deleting)

**Done (2026-09-14).** Items 16-18 complete:

- PR #27 (`docs/plans-021-022-023`) squash-merged to `main` as `c344fff`
  (CI green, docs-only) — not in the original Step D list but landed in
  the same sitting.
- PR #25 (`feat/phase33-decision-integrity`) closed with a comment pointing
  at Plan 016/PR #26 as the superseding work.
- Local `main`'s pointer fast-forwarded to `origin/main` (the maintainer
  ran the `dcg`-gated command directly — Step A's last loose end).
- All 9 verified-dead local branches deleted (maintainer ran the
  `dcg`-gated `git branch -D`): `docs/contributor-onramp`,
  `docs/screenshot-refresh`, `fix/clickable-links`, `loop/footer-test`,
  `pr18-fix`, `pr19-fix`, `pr19-retrigger`, `pr19-retry2`,
  `feat/phase33.1-haiku-default`. `pr18-fix`/`pr19-fix` verified safe via
  `git diff --stat` against `origin/main` (17k+ lines of unrelated drift,
  pre-Antigravity-era snapshots, nothing unique); `feat/phase33.1-haiku-
  default` verified safe — its only unique content was the reconciliation
  golden fixtures Plan 016 deliberately removed.

Not deleted (out of the original list, left for a future pass if wanted):
`fix/descope-auto-reconciliation` (PR #26 source, has one extra local
`wip(docs)` commit already absorbed into PR #27/main), `feat/phase33-
decision-integrity` (PR #25 source, now closed), and older merged-PR
branches (`feat/diff-popout`, `feat/phase22-attention-foundation`,
`fix/paste-encoding-and-links`, `loop/aggregate-check`, `pr-20`).

Original list, for reference:

16. Close PR #25 (`feat/phase33-decision-integrity`) with a comment
    pointing at Plan 016/PR #26 as the superseding work.
17. Delete local-only merged branches with gone remotes:
    `docs/contributor-onramp`, `docs/screenshot-refresh`,
    `fix/clickable-links`.
18. Review and likely delete: `loop/footer-test`, `pr18-fix`, `pr19-fix`,
    `pr19-retrigger`, `pr19-retry2`, `feat/phase33.1-haiku-default` — each
    a one-off experiment or retry branch already superseded elsewhere.

## Done looks like

- `git log --oneline origin/main..main` and `main..origin/main` both empty.
- `feat/safe-router-traffic` and `phase33-contextual-first-run` rebased
  onto current `main`, gates green, not yet merged (pending plan approval).
- PR #25 closed.
- `docs/TESTING.md` items 1-4 above checked off or explicitly re-scoped.
- `plans/README.md` rows for 021/022 updated from CANDIDATE once the
  maintainer actually approves each for implementation/merge (that
  approval is outside this plan's scope — this plan only gets the code to
  a testable, non-conflicting state).
