# Antigravity (agy) Implementation Plans

> **Executor instructions**: This file contains four ordered implementation
> plans for Logic Loop's Antigravity integration, reviewed and verified
> against live code on 2026-09-06 at commit `650ccfc`. Read the complete plan
> before editing. Run every verification command and confirm the expected
> result before moving to the next step.
>
> **Drift check (run first)**:
> `git diff --stat 650ccfc..HEAD -- src-tauri/src/antigravity.rs src-tauri/src/ingest.rs src-tauri/src/pty.rs src-tauri/src/lib.rs src/lib/ingest.ts src/lib/repo.ts src/lib/delta.ts src/App.tsx src/types.ts src/components/AgentStatusBar.tsx scripts/epoch-check.ts scripts/reentry-check.ts docs/TESTING.md`
> If any in-scope file changed since this plan was written, compare the
> current-state excerpts below with the live code. A mismatch is a STOP
> condition.
>
> **Source review**: an external review (Antigravity/agy pass, dated
> 2026-09-06, companion to the Codex review in
> `plans/Codex_Implementation_Plans.md`) proposed seven fixes. Two of them
> (turn-epoch stuck state, missing waiting signal) rest on a claim about
> Antigravity's `PreInvocation`/`PreToolUse` hook contract that **contradicts
> a documented architecture decision already shipped in Phase 11** — see
> `src-tauri/src/antigravity.rs:13-17` and the CLAUDE.md "Known landmines"
> entry for Phase 11. That decision was made after decompiling agy's own
> `hooks.proto` out of the binary (see `antigravity.rs:150-181`'s doc
> comment) because the doc text alone was already caught being wrong twice
> for `PostToolUse`. The review's counter-claim is plausible but is sourced
> from the doc text alone, the same source already shown unreliable. Plans
> 001 and 004 below gate on a live re-verification step before writing any
> code that registers a `Pre*` hook — do not skip it on the assumption the
> review is right.

## Shared repository context

Logic Loop is a Tauri v2 macOS-first terminal application. Rust owns PTY
creation and the localhost ingest server; React/TypeScript owns tab state and
SQL-backed panels. The app observes structured agent hooks and never parses
ANSI terminal output for meaning (invariant #1). Hook commands must fail
open: a broken, slow, or unreachable ingest server must never block
Antigravity or affect terminal use (invariant #2).

| Purpose | Command | Expected result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Exit 0 with no errors |
| Rust tests | `cd src-tauri && cargo test --lib` | All tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Exit 0 with no warnings |
| TypeScript checks | `npm run check` | Every check script passes |
| Diff hygiene | `git diff --check` | No whitespace errors |

Match the idempotent adapter tests in `src-tauri/src/antigravity.rs:264-461`
and the pure state-machine tests in `scripts/epoch-check.ts`.

---

# Plan 001: Fix the Antigravity turn-epoch stuck bug

## Build outcome (Phase 16, 2026-09-06): DONE, as 2a with a correction

Step 1's live verification passed — `{}` is safe for `PreInvocation` — but
found the mapping below ("map every `PreInvocation` to `UserPromptSubmit`")
would have been wrong: `PreInvocation` fires multiple times per top-level
turn (once per intra-turn tool-call round-trip — 3 firings observed for one
turn with 2 tool calls), not once per turn. The actual fix maps only when
`invocationNum == 0`, live-confirmed to reliably reset at the start of every
new turn (including a second turn resumed in the same long-lived process).
See `src-tauri/src/antigravity.rs`'s `ANTIGRAVITY_HOOK_EVENTS` doc comment
and `translate()`'s `PreInvocation` branch for the implementation, and
CLAUDE.md's Phase 16 entry for the full methodology. Steps 2a/2b below are
kept as originally written for the historical record of what was gated on;
they are superseded by the corrected `invocationNum == 0` design actually
shipped.

## Status

- **Priority**: P0
- **Effort**: M–L (depends on live-verification outcome)
- **Risk**: HIGH — a wrong `Pre*` registration can hang every Antigravity
  turn for the user, not just miss a state update
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `650ccfc`, 2026-09-06

## Why this matters

`ANTIGRAVITY_HOOK_EVENTS` (`antigravity.rs:18`) registers only
`PostToolUse`, `PostInvocation`, `Stop`. `translate()` never gives
`PostInvocation` a `hook_event_name` that `stateForHook`
(`src/lib/ingest.ts:227-250`) does anything with — it falls through the
`default: return null` arm, same as any unrecognized event. So the only two
events that ever drive an Antigravity tab's state are `PostToolUse` and
`Stop`.

`Stop` adds the session to `stoppedSessions` (`ingest.ts:245`). The **only**
thing that ever removes a session from `stoppedSessions` is a
`UserPromptSubmit` event (`ingest.ts:232`), which Antigravity never sends.
Turn 2's first `PostToolUse` therefore hits `if
(stoppedSessions.has(p.session_id)) return null` (`ingest.ts:235`) and is
silently dropped. Every event after the first `Stop`, for the life of that
session, drives no further tab-state change: the tab shows idle forever,
turn/tool counters stop advancing, and `deriveClock`'s stall timer
(`ingest.ts:208-214`) never fires because `lastEventTs` stops updating in
any way that matters to the UI.

## Current state

- `src-tauri/src/antigravity.rs:11-18` — `HOOK_NAME`/`ANTIGRAVITY_HOOK_EVENTS`
  constant, with the doc comment explaining why `Pre*` was excluded:
  synchronous execution, and the doc's "Current Limitations" note that hooks
  block the agent loop.
- `src-tauri/src/antigravity.rs:182-210` — `translate()`; no case gives
  `PostInvocation` a distinguishable payload from `Stop` beyond the shared
  `session_id`/`cwd`/`transcript_path` fields.
- `src/lib/ingest.ts:140` — `stoppedSessions` module-level `Set<string>`
  (the epoch guard), documented at `ingest.ts:135-139`.
- `src/lib/ingest.ts:227-250` — `stateForHook`; `UserPromptSubmit` is the
  only case that calls `stoppedSessions.delete`.
- CLAUDE.md's Phase 11 landmine and `antigravity.rs`'s own doc comment above
  `translate()` (lines 143-181) record that the doc's claims about this
  adapter's payload shape were wrong twice already (`PostToolUse` "carries
  no toolCall", and the `error` field's failure semantics) and were only
  resolved by decompiling the binary's `hooks.proto`. No such decompilation
  has been done for `PreInvocation`'s or `PreToolUse`'s response contract.

## Scope

**In scope**:

- `src-tauri/src/antigravity.rs`
- `src/lib/ingest.ts`
- `scripts/epoch-check.ts`
- Rust adapter tests
- `docs/TESTING.md` Antigravity section

**Out of scope**:

- The waiting-state signal for `ask_question` (Plan 004 — shares this plan's
  live-verification step but is a separate, lower-priority change).
- Tool field normalization (Plan 002).
- SessionStart/resume (Plan 003).
- Any change to Claude, Codex, or OpenCode epoch semantics.
- Sending any hook response other than `{}` unless Step 1 proves a richer
  response is required and safe.

## Steps

### Step 1 (gate — do not skip): Live-verify the `PreInvocation` contract

Against a currently-installed `agy` build:

1. Register a **temporary, isolated** test hook for `PreInvocation` (not
   folded into `HOOK_NAME`/`ANTIGRAVITY_HOOK_EVENTS` yet) that logs its
   stdin to a file and prints `{}` on stdout, and run a real multi-turn
   Antigravity session through it.
2. Confirm: (a) the agent loop is not blocked, denied, or measurably stalled
   by the `{}` response; (b) `PreInvocation` fires once per turn, before that
   turn's first `PostToolUse`; (c) it carries `conversationId` and an
   `invocationNum` (or equivalent) field that is `1` (or otherwise
   distinguishable) on the session's first turn.
3. Separately confirm what happens on a **slow** response (sleep 3s before
   printing `{}`) and a **malformed** response (empty stdout) — this is the
   `EPERM`/TCC-grant class of failure mode this app has been bitten by
   before (see CLAUDE.md landmines): confirm degraded-but-not-hung behavior,
   not just the happy path.

Record the exact observed behavior (agy version, transcript excerpt) in this
plan's Step 1 findings before proceeding.

**If verification fails** (blocks, denies, or hangs on any of the above):
stop this plan's Step 2a and implement Step 2b (the fallback) instead. Do
not register `PreInvocation` or `PreToolUse` in the shipped
`ANTIGRAVITY_HOOK_EVENTS` under any circumstance if Step 1 shows blocking
behavior.

### Step 2a (if Step 1 passes): Register `PreInvocation`, map to a turn-open signal

Add `"PreInvocation"` to `ANTIGRAVITY_HOOK_EVENTS`. In `translate()`, map it
to `hook_event_name: "UserPromptSubmit"` (reusing the existing state-machine
case verbatim — do not add a new `stateForHook` branch). Continue always
printing `{}` from `run_hook_mode` for this event, per Step 1's verified
default.

**Verify**: `cd src-tauri && cargo test --lib antigravity::tests` → new test
asserting `PreInvocation` translates to `UserPromptSubmit` and the event is
installed/removed idempotently alongside the existing three.

### Step 2b (if Step 1 fails): Timestamp-grace epoch reopen, no new hook events

Generalize `stateForHook`'s epoch guard instead of relying on a start event
Antigravity cannot safely send. Change `stoppedSessions` from
`Set<string>` to a `Map<string, number>` (session id → the `Stop` event's
timestamp). In the `PostToolUse` case, instead of `if
(stoppedSessions.has(...)) return null`, compare against a new constant
(`EPOCH_REOPEN_GRACE_MS`, start at 5000 — long enough to cover any realistic
out-of-order local-curl delivery skew, short enough that no real next-turn
tool call could land inside it for an actively-driven session): a
`PostToolUse` arriving less than the grace window after the recorded `Stop`
is still dropped (protects the existing out-of-order-delivery guarantee for
Claude/Codex/OpenCode); one arriving after the grace window clears the entry
and is treated as `"working"` (a new epoch), exactly like a fresh
`UserPromptSubmit` would.

This changes shared, adapter-agnostic code — it must not alter observed
behavior for Claude/Codex/OpenCode, which always send an explicit
`UserPromptSubmit` well before any such grace window could matter. Add a
test proving that.

**Verify**: `npx tsx scripts/epoch-check.ts` → existing assertions
unchanged, plus new assertions for both the "immediate late arrival still
suppressed" and "arrival after grace window reopens" cases; `npx tsc
--noEmit` → no errors.

### Step 3: Regression coverage and manual test

Add an Antigravity multi-turn case to `scripts/epoch-check.ts` matching
whichever of 2a/2b was implemented. Add a manual test to `docs/TESTING.md`'s
Antigravity section: run a real two-turn `agy` session in a Logic Loop tab,
confirm the tab returns to `working` on turn 2 rather than staying `idle`,
and record the `agy` version used.

**Verify**: `npm run check` → all check scripts pass; `git diff --check` →
clean.

## Test plan

- Live verification against an installed `agy` build is mandatory before
  choosing 2a vs 2b — this is not optional "if time permits" coverage.
- Deterministic tests in `scripts/epoch-check.ts` for whichever path is
  taken, covering: turn 1 works today, turn 2 reopens, a late/out-of-order
  event from the closed turn does not revive it, Claude/Codex/OpenCode
  behavior is provably unchanged.
- Manual live Antigravity multi-turn test, version recorded.

## Done criteria

- [ ] Step 1's live verification is recorded (pass or fail) before any
  shipped code change.
- [ ] A real second Antigravity turn drives the tab back to `working`
  (verified live, not just unit-tested).
- [ ] Late/out-of-order events from a closed turn still do not revive it.
- [ ] Claude/Codex/OpenCode epoch behavior is unchanged (regression tests
  pass).
- [ ] `npx tsc --noEmit`, `cargo test --lib`, `cargo clippy -D warnings`,
  `npm run check`, `git diff --check` all pass.

## STOP conditions

- Step 1 shows `PreInvocation` (or any `Pre*` event) can block, deny, or
  measurably stall the agent loop under any tested condition — implement
  2b, do not implement 2a, and do not "just try it and see" in a shipped
  build.
- The installed `agy` build's `PreInvocation` payload has no
  `invocationNum`-equivalent field and no reliable once-per-turn firing
  guarantee — report and fall back to 2b.
- 2b's grace window would need to exceed a few seconds to avoid false
  positives in real dogfooding — that signals the fallback doesn't hold and
  needs a redesign, not a bigger constant.

## Maintenance notes

Whichever path ships, document it as the reason this adapter's epoch
handling differs from Claude/Codex/OpenCode. If Antigravity's hook contract
later adds a documented, versioned `SessionStart`-equivalent, prefer
migrating to it over either workaround here.

---

# Plan 002: Normalize Antigravity tool fields for display and detection

## Build outcome (Phase 16, 2026-09-06): DONE as written, all 5 steps.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — pure data mapping, no protocol/timing risk
- **Depends on**: none
- **Category**: correctness / tech-debt
- **Planned at**: commit `650ccfc`, 2026-09-06

## Why this matters

`translate()` (`antigravity.rs:198-208`) copies `toolCall.args` verbatim into
`tool_input` — Antigravity's own PascalCase field names (`CommandLine`,
`TargetFile`, `AbsolutePath`, `SearchPath`, `toolSummary`, `toolAction`,
`Description`), never Claude's lowercase `command`/`file_path`/`description`
shape. Three consumers only look for the lowercase names:

- `repo.ts:129-138`'s Accomplished-panel row builder — every Antigravity row
  renders with an empty `detail` and a bare tool name as `plain`.
- `delta.ts:62-71`'s Since-you-left digest — `files`/`bashRuns`/`bashErrors`
  only match `tool === "Edit" || "Write" || "NotebookEdit"` and `tool ===
  "Bash"`, so an Antigravity session shows zero file changes and zero
  commands regardless of what actually happened.
- `App.tsx:564`'s `runDetectors` gate — `if (p["tool_name"] === "Bash")`,
  so no blocker/decision detection ever runs for `run_command` output.

Confirmed live: `AgentStatusBar.tsx`'s Antigravity toggle tooltip already
half-documents this ("tool activity shows without a tool name" —
imprecise, since `tool_name` is populated, but the *detail* is blank, which
reads the same way to a user glancing at the panel).

## Current state

- `src-tauri/src/antigravity.rs:198-208` — `tool_input` assignment.
- `src/lib/repo.ts:104-141` — `listToolEvents`, `VERB` map, field lookups.
- `src/lib/delta.ts:58-72` — `summarizeDelta`'s per-row tool matching.
- `src/App.tsx:559-572` — the `PostToolUse` branch gating `runDetectors`.

## Scope

**In scope**:

- `src-tauri/src/antigravity.rs` (`translate()` only)
- `src/lib/repo.ts` (`VERB` map only — no query/schema change)
- `src/lib/delta.ts`
- `src/App.tsx` (the `runDetectors` gate only)
- `src/components/AgentStatusBar.tsx` (tooltip text, since it becomes
  inaccurate once this ships)

**Out of scope**:

- Any change to Claude/Codex/OpenCode tool payload shape.
- New database columns or migrations — this is a mapping fix, not a schema
  change.
- `run_command` failure inference (already correctly deferred and pinned by
  `translate_real_failing_run_command_payload_carries_no_failure_signal` —
  do not touch `is_error`/`tool_response` logic in this plan).

## Steps

### Step 1: Normalize `tool_input` in `translate()`

In `antigravity.rs`'s `PostToolUse` branch, after copying `args` into
`tool_input` verbatim (keep the raw fields — do not drop them, other tooling
may want them later), additionally set the shared lowercase keys used by
`repo.ts`/`delta.ts` when the corresponding Antigravity field is present:

- `CommandLine` → `command`
- `TargetFile` or `AbsolutePath` or `SearchPath` or `SearchDirectory`
  (first present, in that order) → `file_path`
- `toolSummary` or `toolAction` or `Description` (first present) →
  `description`

Only add a key when the source field exists and is a non-empty string; never
overwrite an existing lowercase key if one is somehow already present (keeps
this forward-compatible if Antigravity ever adds its own lowercase fields).

**Verify**: `cd src-tauri && cargo test --lib antigravity::tests` → new
tests for each of `run_command`, `write_to_file`/`replace_file_content`,
`view_file`, `grep_search`/`find_by_name` mapping to the correct normalized
key, using the real captured payload shapes already present in this file's
test module (lines 388-406) as the base fixture.

### Step 2: Add Antigravity tool names to the Accomplished-panel verb map

In `repo.ts`'s `VERB` record, add: `run_command: "Ran"`, `write_to_file:
"Wrote"`, `replace_file_content: "Edited"`, `view_file: "Read"`,
`grep_search: "Searched"`, `find_by_name: "Searched"`. No other change to
`listToolEvents` is needed — Step 1 already made `filePath`/`command`/
`description` populate correctly.

**Verify**: manual — with the app running and an Antigravity tab hooked up,
run a `run_command` and a `write_to_file` call and confirm the Accomplished
panel shows a real headline (e.g. "Ran ls -la", "Wrote foo.ts") instead of a
bare tool name.

### Step 3: Extend Since-you-left's tool matching

In `delta.ts`, change the file-tracking condition to also match
`write_to_file`/`replace_file_content` (reading `input.file_path`, now
populated by Step 1), and the command-tracking condition to also match
`run_command` (still counting into `bashRuns`/`bashErrors` — do not rename
the field; it is a shorthand for "shell-like command count" across
adapters, matching the existing Codex precedent of reusing `bashRuns` for
non-Bash-named tools).

**Verify**: no dedicated check script exists for `delta.ts` today; add
focused unit assertions colocated with the existing pure-function style (or
extend a check script if one covers `delta.ts` by the time this plan is
built — confirm via `npm run check`'s script list first).

### Step 4: Extend the detector gate

In `App.tsx`, change the `runDetectors` gate from `p["tool_name"] ===
"Bash"` to also include `p["tool_name"] === "run_command"`, reading the
Antigravity command's output the same way Bash's `tool_response` is read
today. Do not add `write_to_file`/`replace_file_content` to this gate —
`runDetectors` looks for blockers in command *output*, not file-edit
content, matching its existing Bash-only scope for Claude/Codex too.

**Verify**: `npm run check` → all check scripts pass; manual — run a failing
`run_command` (e.g. a missing dependency) in an Antigravity tab and confirm
a blocker surfaces the same way a failing Bash command already does for
Claude.

### Step 5: Correct the toggle tooltip

Update `AgentStatusBar.tsx`'s Antigravity tooltip to drop "tool activity
shows without a tool name" (no longer true) and keep only the parts that
remain true after this plan and Plan 001/003/004 land (adjust wording to
whatever subset is still accurate at build time).

**Verify**: `git diff --check` → clean.

## Test plan

- Rust unit tests for each normalized field mapping, using real captured
  payload shapes.
- Manual Accomplished-panel and Since-you-left checks with a live
  Antigravity session covering `run_command`, `write_to_file`,
  `view_file`, and `grep_search`.
- Manual blocker-detection check with a deliberately failing `run_command`.

## Done criteria

- [ ] Accomplished panel shows real detail/plain text for Antigravity tool
  rows.
- [ ] Since-you-left's file and command counts are non-zero for a real
  Antigravity session that edited files and ran commands.
- [ ] A failing `run_command` triggers the same blocker-detection path a
  failing Bash command does.
- [ ] Raw PascalCase fields remain present in `tool_input` alongside the new
  normalized keys (no data loss).
- [ ] All shared gates pass.

## STOP conditions

- A real Antigravity tool payload uses a field name not covered by this
  plan's mapping list — report the tool/field and extend the plan rather
  than guessing a mapping.
- Normalizing a field would require inferring semantics not present in the
  payload (e.g. guessing a description from a command string) — do not
  fabricate; leave the field absent.

## Maintenance notes

Keep the raw PascalCase fields in `tool_input` untouched — only add,
never rename or remove — so a future consumer needing Antigravity-specific
detail (e.g. `WaitMsBeforeAsync`) is not blocked by this normalization.

---

# Plan 003: Antigravity SessionStart emission and session re-entry

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Codex Plan 001 and Plan 002 in
  `plans/Codex_Implementation_Plans.md` (shared adapter-marker header and
  the `session_bindings.agent` migration/resume-selector infra) — build
  those first, or fold the schema/marker work into a single shared step if
  both are scheduled in the same phase. Also depends on Plan 001 in this
  file if the chosen fix path (2a) gives a reliable `invocationNum`
  signal; if Plan 001 shipped as 2b, this plan needs an alternative
  first-turn detector (see Step 1 alternative below).
- **Category**: correctness / migration
- **Planned at**: commit `650ccfc`, 2026-09-06

## Why this matters

`session_bindings` is only written from `App.tsx`'s `SessionStart` branch
(`App.tsx:550`, gated on `p.tab_id && projectKey && p.cwd &&
p.transcript_path`). Antigravity never emits `SessionStart` — it isn't in
`ANTIGRAVITY_HOOK_EVENTS` and has no equivalent in its hook set — so no
Antigravity session is ever recorded for re-entry, and the app relaunch /
"Re-enter" flow silently does not apply to Antigravity tabs. This is a real,
confirmed gap distinct from Plan 001's epoch bug.

Antigravity's resume syntax (`agy --conversation <id>; exec <shell> -l`,
per the review) is **not independently verified in this repo** the way
Codex's `codex resume <SESSION_ID>` was (Codex Plan 002 confirms it against
an installed CLI). Do not hardcode it without the same live confirmation
Codex's plan required.

## Current state

- `src-tauri/src/antigravity.rs:18` — no `SessionStart`-equivalent event.
- `src/App.tsx:550-554` — `SessionStart`-gated binding write, agent-agnostic
  once Codex's Plan 001 marker lands.
- `src-tauri/src/pty.rs:110-117,145-154` — resume validation and the
  hardcoded `claude --resume` command; Codex Plan 002 makes this a
  closed-set selector.
- `src/lib/repo.ts` binding functions and `src/types.ts`'s
  `ReentryCandidate`/`Tab` — agent-agnostic once Codex Plan 001/002 land.

## Scope

**In scope**:

- `src-tauri/src/antigravity.rs`
- `src-tauri/src/pty.rs` (extending the closed-set resume selector Codex
  Plan 002 introduces — not re-inventing it)
- `src/App.tsx`, `src/lib/repo.ts`, `src/types.ts` (extending, not
  re-deriving, Codex Plan 002's schema/typing work)
- `docs/TESTING.md` Antigravity section

**Out of scope**:

- Re-implementing the shared marker/migration infra Codex Plan 001/002
  already build — this plan consumes it.
- Antigravity decision extraction (see the rejected findings section).
- Gemini/Copilot adapters.

## Steps

### Step 1: Emit a SessionStart-equivalent on first turn

If Plan 001 shipped as 2a (verified-safe `PreInvocation`), use the
`invocationNum == 1` (or equivalent) signal confirmed there: when
`PreInvocation` fires with that value, additionally emit one extra
translated payload with `hook_event_name: "SessionStart"` (in addition to
the `UserPromptSubmit` translation Plan 001 already sends) before
`run_hook_mode` returns, carrying `conversationId`/`cwd`/`transcript_path`
same as any other event.

If Plan 001 shipped as 2b (no `Pre*` hook), there is no reliable
first-turn signal from a Post-event alone. Alternative: treat the
**first-ever `PostToolUse` or `PostInvocation` seen for a given
`session_id`** (tracked in a small in-memory `Set<string>` in `antigravity.rs`
itself, reset only on process restart) as a proxy for session start, and
emit the `SessionStart`-equivalent payload alongside it. This is weaker
(a session that never calls a tool on turn 1 won't get bound until it
does) — document the limitation in the STOP/maintenance notes rather than
treating it as equivalent to a real `SessionStart` event.

**Verify**: `cd src-tauri && cargo test --lib antigravity::tests` → new
test(s) for whichever path, asserting the `SessionStart` translation fires
exactly once per session and carries the required fields.

### Step 2: Bind and persist with adapter identity

Confirm (do not re-derive) that Codex Plan 001's marker mechanism and Plan
002's `session_bindings.agent` column are in place. Use the same marker
constant pattern for `"antigravity"` that Codex Plan 001 established for
`"codex"`. Persist the binding through the existing `SessionStart` branch in
`App.tsx` unchanged — it should already be agent-agnostic once Codex's work
lands, per that plan's stated goal.

**Verify**: `npx tsx scripts/reentry-check.ts` → existing assertions pass,
plus a new fixture with `agent: "antigravity"` surviving `latestPerTether`.

### Step 3: Live-verify and wire the resume command

Before writing the resume-selector case, confirm against an installed `agy`
build that `agy --conversation <id>; exec <shell> -l` (or whatever the
installed version's actual supported form is) resumes the correct
conversation with prior context. Record the exact command and `agy`
version in this plan.

Extend `pty.rs`'s closed-set resume selector (introduced by Codex Plan 002)
with an `"antigravity"` arm using the verified command, keeping
`valid_resume_id` as the shared shell-injection boundary. Do not accept an
arbitrary agent string.

**Verify**: `cd src-tauri && cargo test --lib pty::tests` → resume-selection
test proving `antigravity` produces the verified command and rejects
metacharacter-containing IDs, alongside the existing Claude/Codex cases.

### Step 4: Manual regression

Add an Antigravity case to `docs/TESTING.md`'s re-entry section: run
Antigravity in a tab, quit/relaunch the app, confirm a re-entry ghost tab
appears, click Re-enter, confirm the resumed session is the same
conversation. Record the `agy` version used.

**Verify**: `npm run check` and the full shared gate list all pass.

## Test plan

- Rust unit tests for SessionStart-equivalent emission (Step 1's chosen
  path) and resume-command selection (Step 3).
- `scripts/reentry-check.ts` extended with an Antigravity fixture.
- Live manual re-entry test with a recorded `agy` version.

## Done criteria

- [ ] An Antigravity session produces a `session_bindings` row.
- [ ] A relaunch after an Antigravity session shows a re-entry ghost tab.
- [ ] Re-enter resumes the correct Antigravity conversation (live-verified,
  not assumed from the review text).
- [ ] Claude/Codex/OpenCode re-entry behavior is unchanged.
- [ ] All shared gates pass.

## STOP conditions

- Codex Plan 001/002's marker or migration infra is not yet built when this
  plan is picked up — build or fold those in first rather than duplicating
  a second marker mechanism.
- The live resume-command check in Step 3 does not reproduce the review's
  claimed syntax — report the actual behavior and adjust rather than
  shipping an unverified command.
- Plan 001 shipped as 2b and the Step 1 fallback proxy produces false
  positives (binds a session that immediately errors) in manual testing —
  stop and redesign the first-turn detector rather than shipping a flaky
  binding.

## Maintenance notes

If Plan 001 later moves from 2b to 2a (a future agy release makes
`PreInvocation` provably safe), revisit Step 1 here to use the stronger
signal instead of the first-tool-call proxy.

---

# Plan 004: Waiting-state signal for `ask_question`

## Status

- **Priority**: P2
- **Effort**: S (if Plan 001's Step 1 already verified `Pre*` hooks safe;
  otherwise deferred)
- **Risk**: HIGH — same contract risk as Plan 001
- **Depends on**: Plan 001's Step 1 live verification, extended to
  `PreToolUse` specifically (verifying `PreInvocation` alone does not
  clear `PreToolUse` for use)
- **Category**: enhancement
- **Planned at**: commit `650ccfc`, 2026-09-06

## Why this matters

`AgentStatusBar.tsx`'s Antigravity tooltip already documents "no waiting
signal" as a known limitation. When Antigravity calls its `ask_question`
tool, it blocks on user input inside its own UI with no observable event
Logic Loop currently maps to the `"waiting"` tab state (the amber-pulse
"needs you now" indicator every other adapter gets from `Notification` or
`PermissionRequest`).

## Current state

- `ANTIGRAVITY_HOOK_EVENTS` has no `PreToolUse` entry (`antigravity.rs:18`).
- `stateForHook`'s `"Notification"`/`"PermissionRequest"` case
  (`ingest.ts:241-243`) is the only path to `"waiting"`.
- `AgentStatusBar.tsx`'s Antigravity toggle tooltip states this limitation
  today.

## Scope

**In scope**: `src-tauri/src/antigravity.rs`, `src/lib/ingest.ts` (reusing
the existing `"PermissionRequest"` case — no new `stateForHook` branch),
`docs/TESTING.md`.

**Out of scope**: Any other `PreToolUse` matcher besides `ask_question` (a
bare `*` matcher on a synchronous, response-blocking hook is a materially
larger blast radius than a single named tool — do not widen scope without a
separate risk review).

## Steps

### Step 1 (gate): Extend Plan 001's live verification to `PreToolUse`

Confirm specifically for `PreToolUse` with a matcher scoped to
`ask_question`: it fires before the question is shown to the user, `{}` (or
`{"decision": "allow"}` if the doc requires an explicit allow to avoid a
default-deny) is a safe non-blocking response, and a slow/malformed
response degrades to "question shown anyway" rather than hanging or
silently denying the tool call. This is a *different* hook name and matcher
than Plan 001's `PreInvocation` check — do not assume Plan 001's result
covers it.

**If this fails, do not implement Steps 2-3.** Leave the tooltip's existing
"no waiting signal" language in place and close this plan as not viable
under the current agy hook contract.

### Step 2: Register the scoped hook and translate it

Register `PreToolUse` with a matcher of `ask_question` only (grouped shape,
matching `PostToolUse`'s existing pattern in `apply_setup`). Map it to
`hook_event_name: "PermissionRequest"` in `translate()`, reusing the
existing `stateForHook` case verbatim.

**Verify**: `cd src-tauri && cargo test --lib antigravity::tests` → new
tests for matcher scoping and translation, plus idempotent
install/removal alongside the existing three events.

### Step 3: Manual verification of the full waiting → working cycle

Run a real Antigravity session that calls `ask_question`, confirm the tab
shows `waiting` (amber pulse) while the question is open, and confirm the
next `PostToolUse` after the user answers returns it to `working`.

**Verify**: `npm run check` and the full shared gate list pass.

## Test plan

- Live verification (Step 1) is the load-bearing test here — unit tests
  alone cannot prove a synchronous hook is safe.
- Rust unit tests for matcher scoping and translation.
- Manual full-cycle test with a recorded `agy` version.

## Done criteria

- [ ] Step 1's live verification is recorded, pass or fail.
- [ ] If passed: an Antigravity tab shows `waiting` while `ask_question` is
  open and returns to `working` after it's answered.
- [ ] The Antigravity toggle tooltip is updated to match whatever the
  actual outcome is.

## STOP conditions

- Step 1 shows any blocking/denial/hang risk — close this plan without
  shipping code, same as Plan 001's 2a/2b gate.
- `ask_question` is not exposed as a `PreToolUse` matcher name in the
  installed agy version (naming drift) — report the actual tool name
  before proceeding.

## Maintenance notes

If Plan 001 ships as 2b (no `Pre*` hooks anywhere), this plan is likely not
worth revisiting until agy's contract changes — a single scoped `PreToolUse`
matcher carries the same category of risk Plan 001 rejected wholesale.

---

## Findings considered and rejected (parity with the Codex review's own
deferrals)

- **Full Antigravity decision extraction** (`USER_INPUT`/`PLANNER_RESPONSE`
  transcript parsing) is deferred, matching the same non-goal already
  recorded for Codex and OpenCode in their acceptance notes (CLAUDE.md
  Phase 8/10/11). It is a separate product feature, not a prerequisite for
  stable lifecycle integration, and `ingest.rs`'s
  `is_claude_transcript_path` gate (added in Phase 10 specifically to stop
  an accidental non-Claude transcript leak) would need deliberate,
  reviewed widening rather than a drive-by change.
- **`run_command` failure inference from `PostInvocation` model prose or the
  transcript** is rejected outright, not merely deferred. It would violate
  invariant #5 (transcript content is untrusted, never parsed for meaning)
  and is already pinned as a known upstream contract limit by
  `translate_real_failing_run_command_payload_carries_no_failure_signal` in
  `antigravity.rs`'s test module. Do not revisit this without an upstream
  agy contract change.
- **`agy -p` as an alternative decision-extractor backend** is deferred —
  no confirmed evidence in this repo that `agy` supports a non-interactive
  `-p`/`--output-format text` mode analogous to `claude -p`
  (`extractor.rs:47-48`). If pursued later, it needs the same live
  verification rigor as Plan 001/003/004's gated steps, not an assumption
  from the review text.
