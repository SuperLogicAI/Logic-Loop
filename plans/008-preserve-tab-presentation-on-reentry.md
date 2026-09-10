# Plan 008: Preserve bookmark tab names and colors through re-entry

> **Status**: DONE after `PHASE 29 ACCEPTED`; focused and aggregate automated
> gates are clean, the live macOS relaunch matrix passed, and the maintainer
> wrote `PHASE 29 APPROVED` on 2026-09-10.
>
> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> at any condition in "STOP conditions" rather than widening the fix.
>
> **Phase gate**: This is the recommended first item in the shell-papercuts
> sprint and a candidate for Phase 29. Do not promote it into `PLAN.md` or
> implement it until the maintainer writes the literal token
> `PHASE 29 ACCEPTED`.
>
> **Drift check (run first)**:
> `git diff --stat a719acd..HEAD -- src/types.ts src/lib/repo.ts src/App.tsx src-tauri/src/lib.rs scripts/reentry-check.ts package.json docs/TESTING.md plans/README.md`
> If any in-scope file changed, compare the current-state locations below with
> the live code before proceeding. Treat an incompatible mismatch as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: S (half a day plus a live relaunch pass)
- **Risk**: LOW-MED — it extends persisted re-entry metadata but does not alter
  session selection, resume commands, PTY behavior, or bookmark records
- **Depends on**: none; Phase 28 is complete
- **Category**: bug
- **Planned at**: commit `a719acd`, 2026-09-10

## Why this matters

A tab opened from a bookmark initially uses the bookmark's user-authored name
and color. After quitting and relaunching, re-entry rebuilds that same tab from
`session_bindings`, but the table stores no presentation metadata. The startup
mapper therefore replaces the name with the project directory basename and the
color with the neutral gray palette entry. The session remains resumable, but
the bookmark's visual identity is lost at exactly the moment re-entry should
reduce context reconstruction.

Persist the tab's displayed title and color with its session binding, then use
those values when constructing a ghost tab. Existing rows must continue to
restore with today's basename/gray fallback so the migration is backward
compatible and re-entry never becomes a prerequisite for terminal startup.

## Product contract

- A tab opened from a bookmark and bound to an agent session restores after a
  full app relaunch with the same displayed title and top-border color it had
  before quit.
- Presentation belongs to the tab tether/session binding snapshot. Do not join
  re-entry to `bookmarks` by cwd: multiple bookmarks may target one repo, cwd
  can be canonicalized from a subdirectory to a project root, and bookmarks can
  be renamed or deleted independently while a tab remains open.
- Persist the actual `Tab.title` and `Tab.color`, not a newly inferred bookmark
  id or bookmark name. This also preserves intentionally named fan-out and
  isolate-loop tabs without creating a bookmark dependency.
- A legacy binding with no stored title/color restores exactly as it does now:
  directory basename (or project key) plus `PALETTE[7]`.
- Malformed/empty persisted presentation values fall back safely; they must not
  prevent other ghost tabs or the default terminal from loading.
- Explicitly closing a tab still deactivates its binding. Resume selection,
  adapter identity, unclaimed-result seeding, and the order in which startup
  state is applied remain unchanged.

## Current state

- `src/App.tsx:366-390` creates every tab through `openTab`. Bookmark opens pass
  `name`, `cwd`, and `color`, which become `Tab.title`, the canonical project
  key, and `Tab.color`.
- `src/App.tsx:839-847` writes a session binding on tethered `SessionStart`, but
  passes only session, tether, project/cwd, transcript, and adapter identity.
- `src/App.tsx:740-769` loads active re-entry candidates. Its ghost mapper
  hard-codes:

  ```ts
  title: c.project_key.split("/").filter(Boolean).pop() ?? c.project_key,
  color: PALETTE[7],
  ```

- `src/lib/repo.ts:930-945` owns the typed `session_bindings` upsert. Keep all
  SQL here; do not issue SQL from `App.tsx`.
- `src/lib/repo.ts:954-984` shapes the latest active row per tab tether and is
  the pure boundary already exercised by `scripts/reentry-check.ts`.
- `src-tauri/src/lib.rs:108-123` created `session_bindings` in migration 7;
  migration 10 later added nullable `agent`. The next schema change must be a
  new migration after version 11; never edit migrations 7 or 10.
- `scripts/reentry-check.ts:5-53` is the focused assertion-based test and the
  established place to verify latest-per-tether metadata preservation.
- `docs/TESTING.md:147-170` covers bookmark persistence and initial tab styling;
  `docs/TESTING.md:421-435` covers full re-entry, but no check currently crosses
  both behaviors.

## Architecture constraints

- Use `src/lib/repo.ts` for every database read/write. Add a numbered migration
  rather than changing an old migration.
- Preserve `session_bindings.tab_tether` as the re-entry identity and continue
  selecting the newest row per tether. Do not match restored tabs by cwd.
- Session presentation is trusted app-authored UI state, not semantic agent
  content. Do not parse PTY output, transcript text, or hook prose to derive it.
- Binding persistence and restore failures remain fail-open: terminals and all
  other candidates continue to work.
- Do not change autonomous-input boundaries, agent adapters, extraction,
  notifications, panel queries, or bookmark CRUD.
- Preserve the unrelated untracked `Side Panel Fold/` and `graphify-out/`
  directories.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused check | `npm run reentry:check` | Prints `reentry-check: all assertions passed`; exit 0 |
| Aggregate checks | `npm run check` | Every configured check exits 0 |
| Typecheck | `npx tsc --noEmit` | Exit 0, no TypeScript errors |
| Frontend build | `npm run build` | Exit 0 |
| Rust tests | `cd src-tauri && cargo test --lib` | All library tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Exit 0, no warnings |
| Whitespace | `git diff --check` | No output; exit 0 |

## Scope

**In scope — the only implementation files to modify:**

- `src-tauri/src/lib.rs` — add the next numbered migration for nullable tab
  presentation columns.
- `src/types.ts` — extend `ReentryCandidate` with optional presentation fields.
- `src/lib/repo.ts` — write, select, validate, and shape presentation metadata.
- `src/App.tsx` — pass live tab presentation into the binding write and consume
  restored values with legacy fallbacks.
- `scripts/reentry-check.ts` — focused round-trip and legacy-fallback coverage.
- `docs/TESTING.md` — add the Phase 29 manual relaunch matrix and record only
  checks actually performed.
- `plans/README.md` — update Plan 008's status after execution.

`package.json` is out of scope unless `reentry:check` is unexpectedly missing;
it exists at planning time and should not need adjustment.

**Out of scope:**

- The `bookmarks` schema and bookmark CRUD/reorder behavior.
- A persistent general-purpose tabs table or recovery of tabs that never
  started a resumable agent session.
- Syncing an already-open tab when its source bookmark is later edited.
- Tab order persistence, active-tab persistence, scrollback persistence, or
  live PTY restoration.
- `src/lib/ingest.ts`, agent adapters, extraction, panels, notifications, and
  unrelated migrations.

## Git workflow

- Use a focused branch such as `fix/reentry-tab-presentation`.
- Keep this concern in one conventional commit, for example:
  `fix(reentry): preserve tab title and color`.
- Do not push or open a PR unless the operator explicitly requests it.

## Implementation sequence

### Step 1: Extend the binding schema without rewriting history

Append migration 12 in `src-tauri/src/lib.rs`. Add nullable text columns named
`tab_title` and `tab_color` to `session_bindings`. Nullable columns let existing
databases migrate without fabricated values; fallback belongs at the typed read
boundary.

Do not add these columns to migration 7 and do not create a second table.

**Verify**: `cd src-tauri && cargo test --lib` exits 0 and the migration list
contains versions 1 through 12 exactly once.

### Step 2: Carry presentation through the typed repository boundary

Extend `ReentryCandidate` and the internal row shape with optional
`tab_title`/`tab_color` values. Extend `upsertSessionBinding` to accept the
live title and color, insert them, and refresh them on the existing
`ON CONFLICT(session_id)` update. Extend the re-entry SELECT and
`latestPerTether` mapping to return them.

At the read boundary, treat `NULL`, an empty/whitespace-only title, or an empty
color as absent. Do not validate against `PALETTE`: a stored custom color from a
future UI version should remain round-trippable.

Update `scripts/reentry-check.ts` so its row factory can include presentation
metadata and add assertions that:

1. title and color survive a one-row round trip;
2. the newest row's presentation wins when one tether has several sessions;
3. a legacy row returns presentation as absent rather than fabricating it;
4. agent identity behavior remains unchanged.

**Verify**: `npm run reentry:check` prints
`reentry-check: all assertions passed` and exits 0.

### Step 3: Snapshot live presentation and restore it safely

In the `SessionStart` binding write in `src/App.tsx`, look up `p.tab_id` in
`tabsRef.current` and pass that tab's current title and color into
`upsertSessionBinding`. This lookup must use the tether, not cwd. If the tab is
unexpectedly absent, pass nullable/undefined presentation and still write the
binding; re-entry must remain available with legacy fallbacks.

In the startup ghost mapper, use the stored non-empty title/color first and the
existing basename/`PALETTE[7]` expressions second. Do not reorder the
`unclaimedSessions` seed, `setUnseenStops`, `setTabs`, or `setActiveId` calls.

If live testing reveals `SessionStart` can reach the listener before the newly
spawned tab is present in `tabsRef.current`, STOP. Do not add a second binding
write site or a general tabs table as an improvised race workaround; report the
observed ordering so the plan can be revised deliberately.

**Verify**: `npm run reentry:check` and `npx tsc --noEmit` both exit 0.

### Step 4: Record the cross-feature regression matrix

Add a Phase 29 section to `docs/TESTING.md` covering bookmark-created and plain
tabs across full quit/relaunch. Include legacy database fallback and multiple
bookmarks targeting one project. Mark results only after running them.

**Verify**: `rg -n "Phase 29|bookmark.*relaunch|legacy" docs/TESTING.md` finds
the new matrix and `git diff --check` exits 0.

## Automated verification

Run the focused check first, then the applicable repository gates:

```sh
npm run reentry:check
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Expected result: every command exits 0. Do not run `npm run golden`; no
extraction prompt changes.

## Manual verification

Record results in `docs/TESTING.md`:

1. Create a bookmark with a distinctive custom name and non-gray color. Open
   it, start a supported agent so a resumable binding exists, quit the app, and
   relaunch. Its ghost tab has the same name and color before clicking
   **Re-enter**, and retains them after resume.
2. Repeat with two bookmarks that target the same repository but have different
   names/colors. Both restored tabs retain their own presentation and sessions;
   they are not merged by cwd.
3. Open a plain terminal tab, start an agent, quit, and relaunch. Its ordinary
   title/color restore consistently without creating or changing a bookmark.
4. Use a database created before migration 12 (or a sanitized fixture with
   `NULL` presentation fields). Relaunch succeeds and legacy ghosts use the
   basename/gray fallback.
5. Explicitly close one restored tab, relaunch again, and confirm it stays gone.
6. Carry an unclaimed result through the same relaunch. Confirm the first
   auto-active ghost still claims correctly and the presentation change did not
   disturb the Phase 6 ordering guarantee.
7. Confirm bookmark chips themselves still persist, edit, delete, reorder, and
   open with the expected cwd.

## Done criteria

- [ ] Migration 12 adds nullable `tab_title` and `tab_color`; no earlier
      migration is edited.
- [ ] Tethered session bindings snapshot the live tab's title and color.
- [ ] Re-entry candidates preserve the newest row's presentation per tether.
- [ ] Ghost tabs use persisted presentation and retain the legacy fallback.
- [ ] Two bookmarks for one project restore independently by tether.
- [ ] Existing adapter identity, resume selection, explicit-close, and
      unclaimed-result behavior remain unchanged.
- [ ] Focused and aggregate automated gates pass.
- [ ] Live relaunch evidence is recorded without pre-marking unrun checks.
- [ ] No unrelated tracked or untracked user work is modified.

## STOP conditions

Stop and request a plan revision if:

- Product intent is to follow the bookmark's latest edited name/color rather
  than preserve the open tab's last displayed presentation.
- `SessionStart` is observed before the matching tab exists in `tabsRef`, so
  presentation cannot be captured reliably at the current write boundary.
- Correct implementation requires matching by cwd, changing bookmark records,
  persisting PTY output, or adding a second session-binding writer.
- A schema migration cannot add both nullable columns without destructive table
  replacement on a supported SQLite version.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Treat `tab_title` and `tab_color` as tab presentation snapshots. If live tab
  rename/recolor is added later, that feature must deliberately refresh the
  active binding rather than reaching into bookmark rows during restore.
- Review the latest-per-tether test whenever more session-binding metadata is
  added; resumed sessions can create several rows for one tab identity.
- Preserve the startup order that seeds unclaimed flags before activating the
  first ghost. Presentation work must not reopen that Phase 6 bug.
