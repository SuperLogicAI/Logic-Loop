# Phase 48 fix-it sprint: make Overview settle and report evidence truthfully

## Status and execution contract

- **Status:** IN PROGRESS — implementation authorized by the maintainer on 2026-09-30 ("proceed with the work on the devised plan").
- **Parent:** `plans/048-project-dashboard.md`, already authorized as Phase 48. This is a proposed revision within Phase 48, not Phase 49. Phase 48 is explicitly **not accepted**.
- **Planned at:** `3fce610`, 2026-09-30, with pre-existing staged and unstaged changes in `docs/TESTING.md`. Preserve both.
- **Priority:** P1; effort M (approximately 2–3 engineering days plus manual verification); fix risk medium (async lifecycle, project/session isolation).
- **Dependencies:** Diagnose the real Overview load before changing queries. Complete the sprint and outstanding manual matrix before the maintainer considers `PHASE 48 ACCEPTED`.
- **Scope approval:** State this revision explicitly and reconcile it into `PLAN.md` before implementation under the repo workflow. Fix-it implementation is authorized; additional product/API scope disposition is pending explicit maintainer input. No next-phase implementation is authorized.

Drift check before executing:

```sh
git status --short
git diff --stat 3fce610..HEAD -- src/App.tsx src/components/ProjectOverview.tsx src/components/CopyUpdateModal.tsx src/lib/repo.ts src/lib/dashboard.ts src/lib/board.ts src-tauri/src/board.rs scripts/dashboard-check.ts
```

Read the parent plan, current `PLAN.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and the Git/TCC sections of `docs/LANDMINES.md`. Compare the anchors below with current code. Preserve unrelated work; do not stage, commit, push, or open a PR as part of execution without the operator's instruction.

## Test-outcome review

Evidence: `docs/TESTING.md` §69–70, including the partial release pass starting near line 4407 and the discrepancy near line 4497. These are reported observations, not tests rerun by this planning review.

| Outcome | Disposition |
|---|---|
| `dashboard:check`, `onboarding:check`, `git diff --check` passed | Useful baseline; current fixtures do not exercise the full Overview async load. |
| Home listed 65 projects; search, All/Needs a choice/Archived filters and unread-count toggle responded | Preserve these observed passes. Working filter and full catalog/count scenarios remain unverified. |
| Manual Tour opened with Home first, advanced through eight cards, Done closed | Manual navigation passed. Fresh-profile auto-start, real digest, and version-bump behavior are separate checks. |
| Home card had 33 open decisions; Overview said “Nothing open” | Acceptance blocker. Not yet evidence that the project query returned zero rows. |
| Existing `.logic-loop/board.md`; Overview said “No board yet” | Acceptance blocker. Not yet evidence that `peek_board` returned missing. |
| Work log still loading after >12s, including a range change; Copy update disabled | Acceptance blocker: the shared Overview snapshot had not committed. |
| Repeated Desktop access prompts, reportedly in pairs every 10–15s | Secondary reproduction item from §70; provenance is user report. No OS permission/configuration changes are authorized by this plan. |
| Phase 47 accepted historically, but fresh-profile and real-digest checks still unchecked | Preserve acceptance history and disclose outstanding evidence; do not convert it into an invented pass. |

## Findings and confidence

| Priority | Finding and evidence | Impact | Effort / fix risk | Confidence |
|---|---|---|---|---|
| 1 | `ProjectOverview.tsx:112–173` publishes once after catalog, decisions, blockers, sessions, landing, board, observations, every session event query, and Git settle | One pending source blocks all sections and Copy update | M / medium | High for coupling; pending source unknown |
| 1 | `ProjectOverview.tsx:208,355,436` treats null data as no choices/no board; read catches also substitute empty arrays | Misrepresents loading/failure as absence | S / low | High |
| 1 | Overview effect depends on `now`; `App.tsx:1328–1345` changes it every 15s | Repeats DB, bookmark path resolution and filesystem work; a load >15s cannot publish before cancellation | S / medium | High for mechanism; causal role in live failure unconfirmed |
| 2 | Overview filters `c.ts >= since` at line 127; Rust `git_log_blocking` emits `%ct` seconds at `pty.rs:616`; `SidePanel.tsx:1686` correctly uses `c.ts * 1000` | Recent commits vanish even after loading succeeds | S / low | High |
| 2 | Overview uses tether-oriented `eventsSince` for each session (`repo.ts:1086`); `projectSessions` distinguishes session/tether pairs; work-log grouping is one row per returned binding, not per session/day | Potential duplicate or sibling-session attribution; fails specified daily grouping | M / medium | High for query/grouping shape; live impact unmeasured |
| 2 | `openDecisionsForProject` has `LIMIT 50`, while Home counts all open owners (`repo.ts:719,1565`) | Silent disagreement for >50 decisions | S / low | High; does not explain the reported 33 |

Do not assume path canonicalization, a missing file, database corruption, or TCC caused the discrepancy without measurement. Home and Overview both compare exact stored project keys; Home counting and Overview loading are different paths.

## Current-state anchors and conventions

`src/components/ProjectOverview.tsx` currently does:

```ts
const [data, setData] = useState<OverviewData | null>(null);
// first await: Promise.all([...read calls with catches returning empties...])
const eventsPerSession = await Promise.all(
  sessions.map((s) => repo.eventsSince(s.tab_tether, s.session_id, since).catch(() => [] as EventRow[]))
);
const commits = await invoke<Commit[]>("git_log", { cwd: projectKey, limit: 50 })
  .then((rows) => rows.filter((c) => c.ts >= since)).catch(() => []);
if (cancelled) return;
setData(/* all sections together */);
// effect dependency list: [projectKey, range, now]
```

`eventsSince` accepts any event matching the tether, regardless of session; it only uses session matching when `$.tab_id` is absent. Preserve this existing SidePanel/digest API. Add a project work-log read in `repo.ts` if confirmed necessary rather than changing all its callers.

`peekBoard` already returns a discriminated `ready | missing | error` union (`src/lib/board.ts:155`); use that pattern for section state, adding loading explicitly. Rust passive peek never seeds files. `peek_board_blocking` first uses `Path::is_dir`, which can hide permission errors as missing; tighten only if reproduction/fixtures warrant it.

`listProjectCatalog` resolves every bookmark through `projectKeyOf` on each call (`repo.ts:1548`). Overview does not need to repeat a full catalog and every bookmark resolution for every age tick. Parent plan requires cached board/Git reads with refreshes at least 30s apart.

All SQL stays in `repo.ts`; use bound parameters. Match existing `scripts/dashboard-check.ts` Node assert fixtures and pure helper style. Use cancelled/generation guards under StrictMode; stale project/range completions must not update current state. Treat transcripts, excerpts and subjects as untrusted plain text. No PTY parsing/input, no new dependencies or migration by default.

## Scope

Primary files: `src/components/ProjectOverview.tsx`, `src/lib/repo.ts`, `src/lib/dashboard.ts`, `scripts/dashboard-check.ts`. A small new dashboard loader/helper module under `src/lib/` is allowed for directly testable orchestration.

Conditional files: `src/components/CopyUpdateModal.tsx` for truthful readiness/error explanation; `src/lib/board.ts` and `src-tauri/src/board.rs` for demonstrated passive-read error classification; `src/App.tsx` only for Overview refresh wiring (preserve the shared stall clock); `src/components/HomeDashboard.tsx` only if count/refresh consistency requires it. Update `PLAN.md`, this plan, parent Plan 048, `plans/README.md`, `docs/TESTING.md`, and `docs/PROGRESS.md` with real status/evidence at implementation time.

Out of scope: adapter/extractor changes, extraction prompts, generated hooks, PTY lifecycle/routing rewrites, database migrations without measured justification, new product features, OS/global settings or TCC resets. Startup preference/actions/Continue changes require the scope disposition below before implementation.

## Execution order

### 1. Measure the blocked reads before fixing assumptions

Reproduce against the rebuilt release app and the same project. Record stage durations/counts and terminal status, without logging decision text, transcript payloads, credentials, or other project contents. Measure catalog/bookmark resolutions, each core query, session count, event reads, board invocation, Git invocation, and cancelled generations. Observe at least 45s and a range switch. Establish whether a read is pending, merely slow, or rejected. Do not depend on render error boundaries to catch asynchronous failures.

Use read-only profile inspection if available and authorized by filesystem access: compare exact project key, source-open decision count, session/tether ownership, and board presence. Do not rewrite rows or replace the user's profile. Sanitize any recorded identifiers. If Desktop prompts recur, correlate them to measured filesystem invocations; permission denial must remain a displayed failure. Do not reset grants or recommend granting broad access as the software fix.

**Verify:** diagnostic record identifies completed/pending/rejected stages and reproduction conditions; `npm run dashboard:check` remains exit 0. If reproduction differs, record that and proceed with the code-proven loading/state bugs; label the live root cause unresolved.

### 2. Publish independent sections with truthful states

Replace the all-or-nothing snapshot with independently settling sections. Decisions/blockers must become visible when their reads complete even if catalog, events, board or Git is pending. Loading, successful-empty and failed are distinct in every section. Keep board missing distinct from ready-empty/example/error. Provide Retry and a bounded wait (proposed 10s) for each source; timeouts become unavailable states, never fabricated empty values.

Age `now` remains a display input; snapshot range bounds at load start. Trigger reads on project/range change and controlled refresh, not the 15s clock. Cache/coalesce board and Git reads per project for at least 30s as the parent plan specifies. Range changes can filter cached commits. A frontend timeout does not cancel a Tauri blocking operation: do not launch duplicate native reads while one is outstanding. Dispose timers and ignore late/stale results on unmount/project/range changes. Clear previous-project data immediately when identity changes.

Copy update may enable when its required evidence sources have successfully settled; unrelated catalog/board/agent-time failures must not disable it. If required decisions/blockers/work-log/commits are unavailable, keep it disabled with an actionable explanation and Retry. Do not turn an unknown section into “none recorded.” If partial drafts are desired, stop and obtain an explicit change to this policy.

**Verify:** add fixtures in `dashboard-check.ts` using controlled/deferred promises and an injected clock: pending Git/board does not hide resolved decisions; failed reads show unavailable; timeout releases Loading; tick does not requery; retry does not duplicate in-flight native work; stale completions and StrictMode cleanup are safe. `npm run dashboard:check` and `npx tsc --noEmit` exit 0.

### 3. Correct source attribution, ranges and counts

Compare Home's source-open count with Overview's full source-open query for the same key. Preserve answered/dismissed distinctions and show Inbox-archived occurrences while their source decisions remain open. Remove the silent 50-row cap or make pagination explicit with a truthful total; cover both 33 and >50 decisions. Do not route to a sibling tab as a fallback.

Normalize Git seconds at the dashboard boundary (`c.ts * 1000` for comparisons); preserve the shared native timestamp contract and existing SidePanel behavior. Cover commits inside/outside and exactly at the range cutoff with explicit inclusive/exclusive rules matching event reads. Disclose the existing 50-commit cap, or fetch the actual selected window before representing the draft as complete.

Read project events by authoritative session ownership in a single bounded project/range query where possible. Preserve legacy null-tether rows belonging to that session, rebind history across tethers, and sessions sharing one tether without duplication/cross-session counts. Group by session and local calendar day per the parent plan; stable row keys include session/day. Measure real-profile query time before considering any new index. Do not modify SidePanel's `eventsSince` semantics.

**Verify:** `npm run dashboard:check` covers count parity, ownership cases, daily grouping and timestamp units using representative synthetic inputs through the production helpers. `npm run delta:check`, `npm run scope:check`, `npm run board:check`, and (if Rust peek changes) `cargo test --lib board` from `src-tauri` exit 0. Query fixtures must exercise the repo read semantics rather than only pre-shaped arrays.

### 4. Resolve parent-plan gaps explicitly

Before claiming completion, reconcile the parent plan's promised startup behavior with the implementation note that no UI reads/writes `home_start_surface`; its testing checklist currently expects workspace startup instead. Also disposition single Overview Continue selecting `liveTabs[0]`, per-card Continue/chooser, project Actions, daily work-log semantics and remaining documented simplifications.

For each gap, record either a bounded fix included in revised Phase 48 scope or a maintainer-approved deferral with accurate UI/docs/acceptance criteria. These changes are not silently authorized by this fix-it draft. Do not treat “implemented accessors” as implemented startup behavior. Do not infer approval of a deferral from a historical build note.

**Verify:** parent plan, `PLAN.md`, progress and manual checklist agree about shipped behavior. `npm run onboarding:check` exits 0; startup/chooser/action additions, if selected, need their own focused fixtures and live checks before closure.

### 5. Run the release acceptance matrix and gates

Rebuild with `npm run tauri build` and test the raw release bundle. Do not invoke `npm run reinstall`: it deletes/replaces `/Applications/Logic Loop.app` and has unrelated installation side effects. Record commit/build, OS, profile type, agent versions, commands and outcomes in `docs/TESTING.md`; retain unchecked items until their complete scenarios pass.

Manual order:

1. Same-project regression: Home count equals all source-open decisions in Overview (33 only if unchanged); existing board reads real counts; work log settles or reports a specific failure; normal successful reads enable Copy update. Stay >45s, change ranges, navigate projects rapidly, retry; no false empty state, stale project flash, repeated filesystem prompt loop, or terminal disruption.
2. Real Copy update: source-trace every line; ensure paths/command text from prose cannot leak into the draft merely because only line one is used; edit and verify exact clipboard text; clipboard denial recovers. If unsafe excerpts expose a gap in current `buildUpdateMarkdown`, record and fix within revised scope before passing.
3. Background-agent completion on Home + blur/focus: result unclaimed until its actual workspace appears, no PTY input/remount/respawn. Return to split and single workspace, including same active tab; focus and sizing recover.
4. Multiple projects/tabs/fan-out/worktree, close last tab, closed/resumable history; exact decision routing after close; Inbox archival does not hide source-open decisions; identical basenames and root/subdirectory keys.
5. Missing, empty, example, edited and unreadable board; passive reads never create directories/files. Error-boundary recovery returns to an intact workspace.
6. Disposable fresh profile: Setup-close tour auto-start and selected startup behavior; real Since You Left digest includes its tour card; v1→v2 tour once, completed v2 stays completed. Preserve the real profile and running sessions; if isolation needs global/home changes, ask first instead of deleting/resetting it.
7. Keyboard-only, focus containment, shortcuts, 200% zoom, VoiceOver, reduced motion, badge preference persistence, Working filter.

Focused checks first, then all required gates (expected exit 0):

```sh
npm run dashboard:check
npm run onboarding:check
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
```

From `src-tauri`:

```sh
cargo test --lib
cargo clippy --all-targets -- -D warnings
```

Then `git diff --check`. CI also runs full `cargo test`; run that before PR per `CONTRIBUTING.md`. No extraction-prompt changes planned: do not run `npm run golden`.

## Closure and stop conditions

- [ ] Added regression fixtures execute the production loader/shaping/query boundaries and pass; final gates exit 0.
- [ ] Real-project discrepancy rechecked on release build; pending reads no longer fabricate absence.
- [ ] Phase 47 outstanding fresh-profile/digest evidence and remaining Phase 48 manual scenarios recorded as passes or explicitly unresolved; automated success is not substituted for manual evidence.
- [ ] Parent-plan deviations dispositioned explicitly; status says implementation authorized, acceptance pending until the actual token.
- [ ] Diff reviewed against allowed scope and pre-existing TESTING edits preserved; no real profile/transcript/credential artifacts included.
- [ ] Maintainer reviews concrete results and writes `PHASE 48 ACCEPTED` before any Phase 49 implementation. Commit/PR preparation follows the user's workflow; this review does not commit or publish.

Stop and report if the repair requires migrations/adapter/PTY changes, global permission changes, weaker routing/privacy guarantees, or a product scope expansion beyond the revised plan. If shared `git_log` cannot distinguish an error from empty and that prevents truthful draft readiness, propose a dashboard-specific typed command in an explicit revision instead of silently changing the existing API. Do not declare the source of the 12s delay proven from the 15s clock alone.

## Maintenance and audit limits

Review future clock, refresh, and session-binding changes against these regressions. Avoid repeating the catalog's bookmark filesystem resolution merely to refresh timestamps. Native reads surviving frontend timeout still need coalescing. Include selected-window limits and missing-source behavior in PR review.

The original planning review was limited to Phase 48 Overview/Home/Copy update reads and Phase 47/48 acceptance records. Implementation subsequently inspected the profile read-only and ran the checks recorded in TESTING §71. TCC reproduction and the remaining live scenarios are still pending; this is not a repository-wide audit.


## Approved implementation revisions (2026-09-30)

The maintainer authorized the recommendations in both scope questions:

- Include the startup preference (fresh profiles Home; existing profiles default
  workspace unless selected) and an explicit chooser for multiple project
  workspaces. Defer per-card Continue and the full project Actions menu.
- Add `src-tauri/src/dashboard.rs` and its registration in `lib.rs` for a
  dashboard-specific typed, read-only Git window. Existing `git_log` is
  unchanged; failed reads must not become empty draft evidence. Query the
  selected window without a latest-50 cap. No API change to workspace callers.
- Add `src-tauri/src/dashboard_checks.rs` (tests only) to execute production
  repo SQL using the existing sqlx dependency. No new dependency or migration.
- `src/App.tsx`, `src/components/HomeDashboard.tsx`, and `src/lib/dashboard.ts`
  are also in scope for startup preference/chooser wiring and focused checks.
  `src/components/AgentStatusBar.tsx` needs a portal for Setup: its existing
  modal is nested inside the workspace ancestor hidden on Home. This wiring
  is necessary for the approved fresh-profile Home startup to remain usable.
  `src/components/FeatureTour.tsx` must skip targets with no layout inside the
  hidden workspace; Home Tour otherwise finds mounted but invisible controls.

Measured diagnosis: read-only SQLite timings on the real profile found 33 open
choices, 277 sessions and an existing board. The old 277 JSON/tether count scans
needed 111.71s and matched 15,857 rows including duplicate attribution. A single
session-owned count took 0.011s (13,736 rows); the new actual production SELECT
of relevant work-log types fetched 11,375 rows in 0.168s, without duplicate IDs.
These timings establish the repeated-work mechanism; they are not equivalent
to a successful installed-app manual check.


## Implementation outcome so far

Independent reads, timeout/retry/coalescing, clock isolation, targeted metadata,
full source-open counts, session/day work-log attribution, timestamp conversion,
typed full-window Git reads, draft minimization, startup/chooser wiring and
Setup/tour/modal visibility/focus repairs are built. Focused checks and all
applicable automated gates passed; details and command provenance are in
`docs/TESTING.md` §71. Phase acceptance and remaining live checks are open.

A previously running process at the raw bundle path still embeds the old
frontend even after rebuilding. The operator's restart approval is pending
because it has a live idle shell. Do not mistake its stale UI for a regression
in the new artifact, or mark release scenarios passed without restarting.
