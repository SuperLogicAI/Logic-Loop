# Plan 025: Restore Antigravity conversations through session re-entry

> **Executor instructions:** Read `AGENTS.md`, `CLAUDE.md`,
> `CONTRIBUTING.md`, and this entire plan first. The standard phase and live
> gates below have a specific sprint exception recorded under Status. That
> exception authorizes building on an isolated branch while quota-dependent
> continuity remains pending; it does not authorize claiming re-entry works
> or enabling its onboarding capability without a live pass. Never run
> `npm run golden` for this work; no extraction prompt changes are planned.
>
> **Drift check:** Planned at `d95a7c7`. Before implementation run
> `git diff --stat d95a7c7..HEAD -- src-tauri/src/antigravity.rs src-tauri/src/pty.rs src/App.tsx src/lib/ingest.ts src/lib/onboarding.ts scripts/bind-check.ts scripts/onboarding-check.ts scripts/reentry-check.ts scripts/epoch-check.ts scripts/delta-check.ts README.md CLAUDE.md docs/ROADMAP.md docs/TESTING.md plans/README.md`.
> If an in-scope file changed, compare the code contracts below to the live
> code. Stop and update this plan if the hook, binding, or resume contracts
> differ; do not apply old line-number instructions blindly.

## Status

- **Priority:** P1, the highest-priority remaining Antigravity adapter gap.
- **Effort:** L, mostly integration and live verification.
- **Risk:** MED for persistence/resume correctness; HIGH if a wrong live CLI
  assumption or extra synchronous hook latency is shipped.
- **Depends on:** Existing Codex marker, migration 10, and resume-selector
  infrastructure; Antigravity turn-epoch fix from Phase 16. All are present
  at the planned commit. A real `agy` 1.2.4 continuity probe passed on
  2026-09-16; the app's ghost-tab flow and context recall subsequently passed.
- **Category:** adapter correctness and product capability.
- **Planned at:** `d95a7c7`, 2026-09-16.
- **Sprint authorization:** On 2026-09-16 the maintainer explicitly asked to
  build Plan 025 now and intentionally bypass its phase and live-probe blocks
  while the other two feature branches remain isolated. Work on
  `feat/antigravity-session-reentry`; do not merge or advertise support until
  the real continuity and app-reentry checks pass. This exception applies to
  this sprint only and is not the literal phase acceptance for other work.
- **Phase:** unassigned. Build authorized by the sprint exception above;
  maintainer approved this Plan 025 sprint on 2026-09-16 with
  `CURRENT PHASE APPROVED`. That wording does not assign a phase number or grant a literal
  `PHASE N ACCEPTED` for unrelated work.
- **Build result:** Rust/TypeScript implementation is built on the sprint
  branch. Agy 1.2.4 continuity passed in a new CLI process; Logic Loop
  quit/relaunch/Re-enter and prior-context recall passed in the dev app.
  The maintainer reports all remaining live checks in `docs/TESTING.md` §51
  passed. Onboarding now reports `reentry: true`. Final automated gates are
  recorded there; this branch remains isolated until separately merged.
- **Supersedes:** Agy 003 in `plans/Antigravity_Implementation_Plans.md`.
  That 2026-09-06 plan predates the live finding that `invocationNum == 0`
  starts **each turn**, not just the first conversation turn. Agy 001/002
  are done; Agy 004 (`ask_question` waiting) is separate and out of scope.

## Why this matters

Antigravity hook activity reaches Logic Loop, but a tethered Antigravity
conversation never produces the `SessionStart` event that writes
`session_bindings`. After an app restart it therefore has no ghost tab and no
Re-enter action. The PTY resume selector also has only Claude and Codex
commands. This plan makes Antigravity conversations re-enterable, preserving
the tab tether, project, title, and color. The feature must not be called
supported until a real prior conversation is restored and its context is
demonstrably available.

## Current code contracts to preserve

- `src-tauri/src/antigravity.rs:42,94-105`: the owned `logic-loop` hook
  registration already includes `PreInvocation`, `PostInvocation`,
  `PostToolUse`, and `Stop`. Do not add a `PreToolUse` hook here.
- `src-tauri/src/antigravity.rs:224-270`: `translate("PreInvocation", ...)`
  maps `invocationNum == 0` (or missing, via `unwrap_or(0)`) to
  `UserPromptSubmit`. Every top-level turn can have this signal; intra-turn
  invocations use positive numbers. Native `conversationId` becomes
  `session_id`; first `workspacePaths` entry becomes `cwd` when present;
  `transcriptPath` is optional. Do not infer session start from PTY bytes or
  model prose.
- `src-tauri/src/antigravity.rs:308-335`: each hook runs as a separate
  headless process, sends one normalized payload through
  `hook_command_with_agent(Some("antigravity"))`, waits for delivery, prints
  `{}`, and exits 0 even on bad input or delivery failure. There is no
  reliable process-local set of conversation IDs across hook invocations.
- `src-tauri/src/ingest.rs:83-129,289-309`: the localhost endpoint stamps
  `tab_id` from `LOGIC_LOOP_TAB_ID` and the recognized `antigravity` agent
  marker. Its curl command uses `-m 2` and exits 0. Antigravity transcript
  paths are deliberately **not** tailed (`is_transcript_path`, lines
  134-143). This plan does not widen that gate.
- `src/App.tsx:867-909`: only tethered `SessionStart` with a project key and
  cwd calls `repo.upsertSessionBinding`. That call is intentionally
  fire-and-forget. HTTP completion means the Tauri event was emitted, **not**
  that the SQLite write completed. The hook listener must remain safe under
  React StrictMode double mount.
- `src/App.tsx:385-405,790-799`: `Tab.cwd` is a **project key**, normally the
  nearest git root, rather than necessarily the agent's literal working
  directory. Ghost tabs restore `cwd: c.project_key` and `agent: c.agent`.
- `src/lib/repo.ts:1003-1083`: `upsertSessionBinding` is keyed by
  `session_id` and updates the tether, project, cwd, agent, title, color,
  active flag, and timestamp on conflict. `latestPerTether` chooses the
  newest active row per tether. Existing migrations already provide the
  `agent`, `tab_title`, and `tab_color` columns; add no migration.
- `src/lib/ingest.ts:238-267` maps `SessionStart` to no state change and
  `UserPromptSubmit` to `working`. `src/lib/delta.ts:48-89` counts turns only
  from `hook:UserPromptSubmit`; repeated `hook:SessionStart` rows do not
  increment them. `src/lib/repo.ts:218-269` reads Accomplished rows only
  from `hook:PostToolUse`.
- `src-tauri/src/pty.rs:174-195,225-245` validates resume IDs against
  ASCII alphanumeric, dot, underscore, and hyphen, then selects a closed-set
  resume command under a login shell. Only Codex has an explicit arm;
  absent/unknown agents retain Claude's legacy fallback. The command then
  falls through to an interactive shell after the agent exits.
- `src/lib/onboarding.ts:64-70` currently declares Antigravity
  `reentry: false`; `scripts/onboarding-check.ts` asserts this. Do not flip
  the capability until end-to-end live verification passes.

**Existing test patterns:** Rust translation tests are in
`antigravity.rs:431-680`; PTY resume/ID tests are in `pty.rs:783-815`.
Pure TypeScript re-entry shaping is tested in `scripts/reentry-check.ts`;
epoch and digest checks are in `scripts/epoch-check.ts` and
`scripts/delta-check.ts`. Database access belongs in `src/lib/repo.ts`, not
inline SQL in components. New migrations must be numbered, but none is
needed here. Hook content is untrusted data and hooks must fail open.

## Scope

**Implementation files:** `src-tauri/src/antigravity.rs`,
`src-tauri/src/pty.rs`, `src/App.tsx`, `src/lib/ingest.ts`,
`src/lib/onboarding.ts`, `scripts/bind-check.ts`,
`scripts/onboarding-check.ts`, `scripts/reentry-check.ts`, and only if a
specific assertion is needed, `scripts/epoch-check.ts` and
`scripts/delta-check.ts`.

**Execution documentation:** `docs/TESTING.md`, `README.md`,
`docs/ROADMAP.md`, `CLAUDE.md`, and the status row in `plans/README.md`. Add a new
manual-testing section using the next free section number at execution
time; §49 and §50 are already occupied. Do not create or mark a testing
section as passed during planning.

**Out of scope:** `PreToolUse` / `ask_question` waiting state (Agy 004),
Antigravity decision extraction, transcript tailing, shell command failure
inference, quota/statusline meters, migrations, autonomous PTY input,
changes to Claude/Codex/OpenCode hook semantics, or edits to global hook
configuration as part of an automated test. Do not edit generated adapters.

## Git and phase workflow

For this sprint, the maintainer's explicit bypass replaces the usual
literal phase acceptance and pre-code live probe. Work from
`feat/antigravity-session-reentry` based on `d95a7c7`. The repository has
other active phase branches; verify the
current branch and `git status --short` rather than assuming `main` is the
accepted base. Keep one concern in this phase/PR. Do not push or open a PR
unless the maintainer has authorized that action. Record the selected phase
number in this plan's status and in the new testing-section heading when
implementation begins.

## Steps and gates

### Step 0 — Confirm the approved base and live CLI

Confirm the sprint exception above, a clean or understood
working tree, and the drift check above. Record `agy --version` and
`agy --help` output relevant to `--conversation`. The prior agy session
reported version 1.2.4 and flag syntax, but that was only a **syntax**
check and is not independent proof of restoration. Do not copy a raw
conversation transcript or private token into tracked files.

**Verify:** `git status --short`, the drift command above, `agy --version`,
and `agy --help` all complete; record version, executable path, branch,
and the sprint exception in the execution notes.

### Step 1 — Prove conversation continuity before acceptance

Use a disposable, nonprivate Antigravity conversation with a distinctive
fact supplied on its first turn. Capture its actual `conversationId` from
the existing Antigravity structured hook event (or an existing native
Antigravity identifier source), then exit the CLI process. Launch a **new**
`agy --conversation <captured-id>` process and ask a question whose answer
requires the first process's fact. Record only a sanitized ID and the
pass/fail result, exact command shape, agy version, and whether a new
process truly restored the same conversation. Do not install or modify
global hooks merely to get this probe; if no suitable identifier is
available, record the missing prerequisite. This probe consumes quota. The
2026-09-16 sprint exception permits code work while this is unavailable;
mark **Pending live continuity verification**, never PASS or DONE.

**Verify:** the newly launched process gives the correct distinctive fact
without that fact appearing in the second process's prompt. A nonexistent
ID being accepted by the flag parser is insufficient. If the observed
resume syntax, identity, or context continuity differs, STOP and revise
the selector design before any implementation.

### Step 2 — Generate ordered synthetic hook payloads

In `antigravity.rs`, add a small pure helper that returns one or two
normalized payloads for a native event. Reuse `translate()` for every
existing event. On `PreInvocation` with `invocationNum == 0` (or absent,
preserving the current turn-open behavior) and nonempty `conversationId`,
return a synthetic `SessionStart` first and the existing
`UserPromptSubmit` second. On positive `invocationNum`, return only the
existing inert `PreInvocation`; other events remain one-to-one. Build the
synthetic payload by reusing the same `session_id`, optional `cwd`, and
optional `transcript_path` normalization; do not copy arbitrary native
fields or claim an absent cwd. Send each payload through the existing
agent-marked curl command in order. Keep the unconditional `{}` and exit-0
contract, including malformed JSON, missing ID, spawn failure, and failed
POST paths. Do not add a process-local `HashSet`: each hook invocation is a
new process.

This deliberately emits `SessionStart` on **each new turn**, not once per
conversation. Repeated binding upserts refresh title/color; repeated
`hook:SessionStart` rows are acceptable raw history. Do not call this
once-per-conversation or assume the 500 ms event dedupe bucket collapses
different turns. The two serial POSTs preserve emission order but do not
wait for the frontend's asynchronous DB write. They can also take roughly
four seconds total when each curl reaches its two-second timeout; measure
that in Step 6. If a measured delay is unacceptable, STOP and redesign
rather than claiming this synchronous path has no cost.

**Verify:** `cd src-tauri && cargo test --lib antigravity::tests` passes
with new tests for ordered two-payload turn start, positive invocation,
missing `invocationNum`, missing/empty `conversationId`, optional cwd and
transcript path, and unchanged PostToolUse/Stop translation. In particular,
test the helper's ordered result, not only `translate()` in isolation.

### Step 3 — Bind only tethered Antigravity starts, with a scoped cwd fallback

In `App.tsx`'s existing `SessionStart` binding branch, retain the existing
path for Claude/Codex. For `p.agent === "antigravity"` only, if `p.cwd` is
missing, use `bindingTab.cwd` as both the binding cwd and project key **only
when** `p.tab_id` resolves to a current live tab. `Tab.cwd` is already the
project key (`openTab` and ghost restoration); use `expand(bindingTab.cwd)`
for the persisted absolute form. If native `p.cwd` exists, prefer it and
the ingest-derived `p.project_key`. If neither native cwd nor a valid live
tethered tab is available, do not write a session binding. Do not add a
cwd-based guess for a missing or stale tether. Keep `repo.upsertSessionBinding`
as the sole DB write path and keep the catch/fail-open behavior.

The frontend may receive `UserPromptSubmit` before the binding Promise
settles. Do not use HTTP/post order as a SQLite completion barrier. The
event handler should continue to process the turn independently; the
eventual DB row is verified in the live test. Review StrictMode listener
cleanup rather than adding a second listener for synthetic starts.

Put the location choice in a pure helper in `src/lib/ingest.ts`, called by
the existing App listener, so `scripts/bind-check.ts` can exercise it
without mounting React. Give it the hook's agent, native cwd/project key,
tab ID, and the exact matched tab's live/dead status and expanded project
key. Return either both binding cwd/project key or no binding. Preserve
the present native-field path for other adapters; enable the tab fallback
only for Antigravity with a matching live tether.

**Verify:** `npx tsc --noEmit`, `npm run bind:check`, and
`npm run reentry:check` pass. Add focused assertions to `bind-check.ts`:
native cwd wins; live tether supplies a missing cwd; stale/untethered ID
does not; Claude/Codex behavior is unchanged. Do not add component SQL.

### Step 4 — Add the verified closed-set resume selector

Only after Step 1 passed, add `Some("antigravity")` to
`pty.rs::resume_command` using the **observed** syntax, expected to be
`agy --conversation {sid}; exec {shell} -l`. The sprint exception permits
this syntax-verified selector to be built before Step 1 passes, but it
must remain unadvertised and unmerged until continuity is proven. Retain the existing
`valid_resume_id` gate at `pty_spawn`, Codex arm, and legacy Claude
fallback. Do not accept an arbitrary command from the hook payload or UI.
If the real ID fails the current allowlist, STOP and characterize the
native ID before changing validation. A tab spawned with an invalid ID
must still fall through to a shell, not execute an unsafe command.

**Verify:** `cd src-tauri && cargo test --lib pty::tests` passes with an
Antigravity command assertion and existing invalid-ID assertions; the
Codex and Claude expected command strings remain unchanged.

### Step 5 — Verify re-entry row shaping

Extend `scripts/reentry-check.ts` with a row using
`agent: "antigravity"`, no transcript path, and a custom title/color.
Assert that `latestPerTether` retains these fields; add a second, newer
row for the same tether to prove latest presentation wins. Do not create
a fake Antigravity transcript path. Keep the current truthful
`reentry: false` capability until Step 6 passes.

**Verify:** `npm run reentry:check` and `npm run onboarding:check` pass;
the latter still expects `reentry: false` at this stage.

### Step 6 — Run the live app and fail-open matrix

With Antigravity hooks already enabled by the user, run the app and a
real `agy` session in a Logic Loop tab. Do not change global adapter
configuration without the maintainer's permission. Use a nonprivate
disposable test project and record the CLI version. Follow the manual
matrix below, including a two-turn session, missing `workspacePaths`
fixture/test where feasible, tab presentation, app quit/relaunch,
Re-enter, and context recall. Inspect the binding through the app's
normal DB access or a read-only SQLite query; do not mutate app data
manually. For the dead-ingest case, use an isolated test hook invocation
or a controlled app shutdown, measure elapsed time for the two-post
turn-start path, and confirm the hook exits 0 and prints `{}`. Do not
interpret a normal nonzero `run_command` as an observable tool failure;
agy's command hook strips that status.

**Verify:** every required manual row below has an observed result,
version, and evidence location. The resumed process recalls the first
process's distinctive fact. A pending quota result is **not** a pass.

### Step 7 — Documentation and full gates

After Step 6 passes, change `src/lib/onboarding.ts` to `reentry: true`
for Antigravity and update `scripts/onboarding-check.ts` accordingly. If
Step 6 remains pending, do not flip the flag or mark the phase done.
At execution time, create the next unused `docs/TESTING.md` section and
copy the manual matrix below into it; fill in observed facts, not expected
results presented as passed. Update `README.md`'s adapter table/caveats,
`docs/ROADMAP.md`'s Antigravity row, and `plans/README.md`'s Agy 003 /
Plan 025 statuses only after the live result supports those claims. Keep
Agy 004's waiting-signal gap separate. Record the accepted phase and
observed outcome in `CLAUDE.md`'s existing phase log; that update is
documentation, not a behavior change.

**Verify, in this order:** `npm run onboarding:check`,
`cd src-tauri && cargo test --lib antigravity::tests`,
`cd src-tauri && cargo test --lib pty::tests`, `npm run reentry:check`,
then `npm run opencode:check`, `npm run check`,
`npx tsc --noEmit`, `npm run build`,
`cd src-tauri && cargo test --lib`,
`cd src-tauri && cargo clippy --all-targets -- -D warnings`, and
`git diff --check` all exit 0. `npm run golden` is not applicable.
`git status --short` shows only the in-scope implementation and execution
documentation files, plus any test file explicitly justified under Step 3.

## Manual testing section template — fill during execution

Use the next free number in `docs/TESTING.md`; do not label it §49 or §50.
Leave each result **PENDING** until it has been observed. Record the
`agy` version, app build/commit, OS, and sanitized conversation ID for
the live run. Keep private transcripts and account details out of git.

| Case | Required observation | Result / evidence |
|---|---|---|
| CLI continuity gate | Fresh `agy --conversation <id>` process recalls a unique prior-turn fact | PASS — agy 1.2.4, 2026-09-16; see `docs/TESTING.md` §51 |
| Initial binding | Tethered first turn creates `session_bindings` row with correct agent, tether, project key, cwd | PASS — §51 SQLite observation |
| Repeated turn | Second turn refreshes the same row; tab returns to working; no false turn count from synthetic starts | PASS — §51 UI report and real-event digest |
| Projectless payload | Missing `workspacePaths` uses the current live tab's project key; stale/untethered payload writes no binding | PASS — §51 native-shaped live-app probe report and focused checks |
| Presentation | Renamed/recolored tab persists title and color after another turn | PASS — §51 maintainer report |
| Relaunch | Quit and reopen app; exactly one ghost tab per tether shows the correct project/title/color and Re-enter | PASS — §51 maintainer report |
| Re-enter | Re-enter launches the verified command and recalls prior context | PASS — §51 maintainer report |
| Outside session | No tethered `SessionStart` binding or ghost is created for an outside-terminal session | PASS — §51 no-tether live-app probe report |
| Dead ingest | Hook returns `{}` and exit 0, with measured elapsed time; terminal remains usable | PASS — §51 measured hook and maintainer Agy prompt report |
| Other adapters | Claude and Codex re-entry still use their own command; OpenCode remains unsupported | PASS — §51 maintainer UI report and focused checks |

## Done criteria

- [x] Sprint exception and drift audit are recorded; real CLI continuity
  is proven before the feature is marked accepted or merged.
- [x] `PreInvocation` with invocation zero yields ordered synthetic
  `SessionStart` and `UserPromptSubmit`; later invocations retain old
  behavior; hooks always exit 0 with `{}`.
- [x] Repeated starts are documented as per-turn and create/refresh only
  the correct tether's binding; no session is inferred from PTY bytes.
- [x] Missing native cwd is recovered only from a live, exact Antigravity
  tether; unknown/untethered sessions do not gain a re-entry binding.
- [x] A real Antigravity session creates a ghost tab and Re-enter restores
  the correct prior conversation with its title/color and context.
- [x] Onboarding advertises Antigravity re-entry only after that live pass.
- [x] All focused and full gates in Step 7 pass; manual observations are
  recorded under a new `docs/TESTING.md` section.
- [x] No global config, generated adapter, migration, extraction prompt,
  or unrelated adapter behavior changed.

## STOP conditions

- No sprint authorization, incompatible drift, dirty working tree of
  unknown ownership, or a separate phase's unaccepted changes on the
  intended base.
- Weekly quota or any other condition prevents a real context-continuity
  test: under this sprint exception, continue the isolated build but leave
  acceptance, merge, and capability-label changes pending. `--help` and a
  nonexistent-ID probe are insufficient proof.
- `agy --conversation` starts a fresh conversation, resumes a different
  conversation, needs an ID outside `valid_resume_id`, or uses different
  syntax than the planned selector. Report the observed contract before
  redesigning.
- `PreInvocation` on the installed agy build no longer marks each turn
  with `invocationNum == 0`, or the `{}` response/extra synchronous POST
  blocks, denies, or materially stalls the agent.
- The app cannot preserve exact tab identity and project key on a missing
  cwd without guessing from an active/cwd-matched tab.
- The required change expands into Agy 004, transcript extraction, global
  config management, a database migration, or a new autonomous PTY input
  path. Report the scope change for review.

## Maintenance notes

- The per-turn synthetic `SessionStart` is a compatibility bridge. If agy
  later adds a native session-start event, replace it after live contract
  verification rather than stacking another event.
- Each hook invocation is a new process. A Rust static or process-local
  set cannot deduplicate a conversation across hook calls.
- The two serial POSTs add a second network round trip at every turn start;
  future work should revisit that cost if live measurements show friction.
- Event emission order is not database-commit order. Reviewers should look
  for code that accidentally treats the two as equivalent.
- The `session_bindings` upsert refreshes `updated_at` and presentation on
  repeated turns. Closing a tab deactivates its tether; a stale, untethered
  hook must not resurrect it.
- Antigravity still lacks decision extraction, `ask_question` waiting, and
  a reliable `run_command` failure signal. This plan does not claim them.
