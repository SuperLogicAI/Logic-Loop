# Plan 065: Idea Board modes

Status: **ACCEPTED — `PHASE 65 ACCEPTED`, 2026-10-15; verification limits recorded in docs/TESTING.md.**
Planned at `373b05f`, 2026-10-15. Phase 64 acceptance is recorded in
`docs/PROGRESS.md`. Priority P1; direction; effort M (2–3 days including
built-app checks); risk MED (card mutations and async project switching).

## Intended result

Let each project use the existing five-column Workflow, single-column List,
or three-column Kanban without migrating its board or losing status detail.
The maintainer approved implementation on 2026-10-15. Before building, promote the approved scope into
root `PLAN.md` under the repository's normal workflow; its current Phase 56
text is stale and is not authorization for this work.

### Approved defaults

1. Modes are presentations of the same `.logic-loop/board.md`, not separate
   boards or status conversions. Switching mode never writes that file.
2. Store mode per project in the existing SQLite settings table. Missing,
   invalid, or unreadable preference defaults to Workflow. No migration.
3. List shows every card in file order, including done cards. Keep the
   existing five-status selector; this is a simpler capture surface, not a
   filter or a bulk import tool.
4. Kanban groups idea/planned/later as **To do**, building as **In progress**,
   and done as **Done**. Show each card's original status as a small label.
   Keep **Later** visible even when the card is collapsed so deferred work
   remains distinguishable from actionable work.
   Its lane selector writes planned/building/done only when changing lanes;
   choosing the current lane is a no-op. To change an individual underlying
   status within To do, use Workflow or List.
5. Quick add creates `status: idea` in every mode, preserving current behavior.
   No drag and drop, custom columns, templates, card IDs, or Markdown schema
   changes in this phase.

Revision (2026-10-15): maintainer agreed to **List / Kanban / Workflow**
naming. List replaces Brain dump because it supports scanning and managing
existing work as well as capture. No fourth mode is added. A future priority
view (Now / Next / Later), compact-row density, and a Show deferred toggle
remain outside this phase. Implementation subsequently approved on 2026-10-15.

## Why

The current board always displays five columns, even when someone wants an
unstructured capture list or a small task board. The maintainer's board asks
for brainstorm and kanban variants. Existing parsed cards already support
these views; preserving the five statuses avoids destructive simplification
and keeps Overview and Momentum semantics stable.

## Current state and constraints

Read `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md` before implementation.

- `src/components/IdeaBoard.tsx`: collapsible, resizable bottom dock. `COLUMNS`
  is Idea/Planned/Building/Later/Done. A shared card currently has expand,
  Now star, accent, delete, and a status selector. `topPlannedCard` is consumed
  outside this component; keep its export and behavior unchanged.
- `src/lib/board.ts`: pure parse/splice/append helpers plus Tauri wrappers.
  Current types:
  ```ts
  export type BoardStatus = "idea" | "planned" | "building" | "later" | "done";
  // Card includes title, status, body, link, next, now, color, start, end.
  ```
  `start`/`end` are string slice offsets, not persistent card IDs. Source order
  comes from `parseBoard`. Splices preserve the preamble and sibling ranges;
  do not serialize the entire file from parsed state.
- `IdeaBoard.withFreshBoard` reads immediately before a mutation. Current
  actions find a card by title, then fall back to stale offsets. That fallback
  is unsafe if the card disappears, and duplicate titles are ambiguous.
  This plan adds bounded validation rather than introducing IDs.
- `src/lib/repo.ts` around 1093: `board_collapsed:` and `board_height:` store
  per-project settings. Reuse private `getSetting`/`setSetting` for the new
  `board_mode:` prefix; components must contain no SQL.
- The board instance in `src/App.tsx` receives changing `cwd` without a React
  key. Existing `reload` reads file/collapsed/height concurrently; stale
  responses must not apply the previous project's mode or board.
- `scripts/board-check.ts`: Node strict assertions, run with `tsx`. Extend
  this existing focused check; no new test framework or dependencies.
- `src/components/ProjectOverview.tsx` and `src/lib/dashboard.ts` consume board
  content independently. They must keep existing statuses and counts.

Architecture: fixed stack; no PTY interpretation or autonomous input; no model
calls. Render all Markdown/card content as React text. Reuse semantic color
roles, existing card styling, collapsed Now summary and trailing meter area.

## Scope

Implementation files permitted:
- `src/lib/boardModes.ts` (new pure presentation/preference helpers)
- `src/components/IdeaBoard.tsx`
- `src/lib/repo.ts` (mode setting wrappers only)
- `scripts/board-check.ts`
- `docs/TESTING.md`, `docs/PROGRESS.md`
- `PLAN.md`, `plans/065-idea-board-modes.md`, `plans/README.md` (phase records)

Do not edit `.logic-loop/board.md`: it belongs to the maintainer. Use disposable
fixture projects for manual writes. No Rust, migrations, adapters, ingestion,
extractor, terminal, Overview, or dashboard changes. Do not edit seed-board
constants. Broad board concurrency redesign and compare-and-swap writes are
outside this phase; read-before-write still has a filesystem race and must
not be described as atomic.

## Git and drift

Before implementation:
```sh
git status --short
git diff --stat 373b05f..HEAD -- src/components/IdeaBoard.tsx src/lib/board.ts src/lib/repo.ts scripts/board-check.ts src/App.tsx
```
Compare changed code to the state above; reconcile material changes before
building. Preserve unrelated working-tree changes, including the maintainer's
board edits. Suggested branch: `feat/phase-65-idea-board-modes`; conventional
commit example: `feat(phase65): add Idea Board presentation modes`.
Do not commit, push, or open a PR without session authorization.

## Build sequence

### 1. Define presentation and guarded mutation helpers

Create pure `boardModes.ts`, importing Card/BoardStatus as types where possible:
- `BoardMode = "workflow" | "list" | "kanban"` and
  `parseBoardMode(value: string | null): BoardMode`, strict allowlist.
- Mode column definitions and `boardColumns(mode, cards)` returning each
  column's key, label and cards in original relative file order. List
  has one column containing all cards. Every card appears exactly once.
- A Kanban lane helper and target-status mapping as specified above. Return
  no change for a current-lane choice so later/idea cards do not become planned
  merely by interacting with their existing lane.
- A fresh-card resolver for existing mutation actions: require the displayed
  title to be unique in both displayed and fresh parses and present in fresh.
  Otherwise return an actionable error (reload after rename/removal; rename
  duplicate titles in Markdown). Never use old offsets after a failed match.
  Equal titles are allowed to display; expansion/color-picker state and React
  keys use current source offsets so they do not open multiple cards at once.
  Clear that ephemeral state after a successful write or refreshed content.

Use the existing mutation primitives; do not modify board.ts or its format.
Extend board-check with mixed-status fixtures, duplicate titles and removed or
renamed cards. Verify: `npm run board:check` and `npx tsc --noEmit` exit 0.

### 2. Persist the project preference and protect async state

Add typed `getBoardMode(cwd)` / `setBoardMode(cwd, mode)` in repo.ts, using
`board_mode:` plus the exact existing project key and the existing settings
helpers. No settings SQL moves to the component.

In IdeaBoard, load mode with the current board settings. A failed mode read
falls back independently, without suppressing board content. Use an effect
cleanup/generation guard for project changes, focus reloads, and unmount.
A pending load must not overwrite a newer user mode selection. Reset old
project content and disable writes while the next project is loading.

On selection update the view immediately, then persist. On preference-write
failure keep the usable view and show “View changed for this session; couldn't
save preference.” Catch errors; never leave an unhandled rejection.
Guard mutation completions against project changes. Writes capture the project
at invocation; disable further mutations while one is pending. Retain quick-add
text on failure and clear it only on success. Clear drafts on project change
to prevent accidental cross-project filing. No background action writes cards.

Verify: `npm run board:check` and `npx tsc --noEmit` exit 0. Async behavior
also requires the built-app matrix below; pure checks cannot establish it.

### 3. Render three modes with shared card controls

Put an accessible native select labelled “Board view” in the expanded header:
List / Kanban / Workflow. Keep it outside the collapse click target.
Preserve header meters; allow a second compact row at narrow widths rather
than obscuring controls. The collapsed bar stays compact and mode-independent.

Render columns from boardColumns. Reuse one card renderer for all modes; do
not copy the card controls three times. List has a full-width vertically
scrolling list; other modes retain horizontal column scrolling. Workflow and
List use the original status selector. Kanban uses its three-lane
selector plus the underlying-status label. Keep expand, body/link/next display,
Now cap, color, delete, resizing, collapse and quick add available in all views.
Add column counts, an empty-list message, accessible labels on controls, and
an inline mutation error that preserves user text. Keep file order within each
column; do not introduce drag ordering.

Wire mutations through the guarded resolver. Mode changes and empty-state
rendering never invoke writeBoard or read a different board. Do not add any
new card-editing capabilities beyond the existing controls.

Verify: `npm run board:check`, `npm run color-tokens:check`, and
`npx tsc --noEmit` exit 0.

### 4. Verify and record evidence

Run focused checks before the full gates:
```sh
npm run board:check
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```
Run each Rust command from the repo root in its own subshell, or restore the
root directory before subsequent commands. Expected: all checks exit 0,
Rust tests pass with any existing ignored test disclosed. No golden: no
extraction prompt changes. Record actual manual results in docs/TESTING.md;
do not mark unrun checks passed. Update phase progress and plan index status
without claiming maintainer acceptance.

## Focused check cases

Extend scripts/board-check.ts using its existing strict-assert style:
- Missing, invalid and valid mode values; Workflow is the fallback.
- Five statuses project once each in Workflow, one list in List, and
  the specified three groups in Kanban. Empty boards work in every mode.
- Projection preserves original card order and all metadata. Repeated
  projection across modes leaves the Markdown input byte-identical.
- A later card choosing its existing To do lane stays later; moving to
  In progress writes building; moving back writes planned. Done writes done.
- Status changes preserve body/link/next/Now/color and sibling/preamble bytes
  using the existing splice fixtures. Existing Now cap checks still pass.
- Duplicate displayed/fresh titles, disappeared cards and renamed cards
  refuse mutation. Unique fresh matches use fresh offsets after another
  card was inserted; stale offsets are never used.

## Built-app acceptance matrix

Use a disposable project with all five statuses, two same-title cards, Now
stars, accents, body/link/next metadata, and a second fixture project.

1. Default Workflow matches existing five-column behavior. Switching all
   three modes leaves board.md byte-identical (compare hashes/diff).
2. List lists all cards in file order. Kanban has correct groups,
   counts and original-status labels, including Later and done cards.
3. Move a Later card in Kanban: same-lane choice does not rewrite status;
   In progress writes building; back to To do writes planned. Workflow
   and Overview subsequently show the actual stored statuses.
4. Quick add, delete, expand, accent, Now cap/removal and status/lane changes
   work in each mode. A quick add creates idea in every mode.
5. Projects A/B keep independent modes; collapse/expand and app restart
   restore them. Missing/invalid settings choose Workflow. Preference-write
   failure keeps the view usable and explains session-only persistence.
6. Switch projects rapidly during loading/saving and change mode during a
   pending focus reload: no stale board/mode/error is applied to the new
   project; pending edits cannot write to the newly selected project.
7. Remove/rename a card externally before an action; operation refuses safely.
   Duplicate titles expand independently and mutations explain ambiguity.
   External edits to unrelated cards survive the next successful action.
8. Narrow window, split terminals and maximum/minimum dock height: selector,
   meters, keyboard focus, quick add and scrolling remain usable. Loading,
   empty and write-error states leave terminals responsive. A failed add
   retains text; changing projects clears it intentionally.

## Done and stop conditions

Done means all focused cases and gates pass, manual outcomes/limits are
recorded, no out-of-scope changes are introduced, and no view switch writes
Markdown. Human review and literal `PHASE 65 ACCEPTED` remain separate from
technical completion. Do not begin Phase 66.

Stop and report if approval is absent; drift changes the board contract;
implementation needs a schema/Rust/terminal change; preserving metadata
requires converting statuses; a verification fails twice after a reasonable
fix attempt; or duplicate/changed cards cannot be guarded without persistent
IDs. Propose a plan revision instead of silently expanding scope.

## Maintenance and deferred work

Keep presentation helpers separate from the persisted five-status vocabulary:
future views must not change Momentum's top-planned-card selection or Overview
counts. Reviewers should scrutinize no-write mode switching, async project
isolation and metadata preservation. Stable card IDs, atomic file writes,
templates, drag and drop, custom columns, dated transitions, burndown/Gantt,
bulk capture, and cross-device preference syncing are deferred.


## Build record (2026-10-15)

Implemented within the approved source scope. Project isolation uses a keyed
inner component in IdeaBoard.tsx, so App.tsx needs no change. Mode preference
writes serialize in repo.ts across remounts; focus loads preserve local mode
choices, including failed-persistence session-only choices. No scope revision.
Automated gates and installed-app manual outcomes are recorded in
docs/TESTING.md. The short-window dock-height failure was fixed within the
approved IdeaBoard scope and verified in an isolated component/CSS preview.
Rebuilt-app, restart/preference-failure and forced-race checks remain
unverified. Maintainer issued `PHASE 65 ACCEPTED` on 2026-10-15 with these
coverage limits recorded. No Phase 66 work.
