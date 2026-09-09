# Codex Implementation Plans

> **Executor instructions**: This file contains three ordered implementation
> plans for Logic Loop's Codex integration. Read the complete plan before
> editing. Run every verification command and confirm the expected result
> before moving to the next step. Do not modify the user's existing staged
> changes in `docs/TESTING.md`, `scripts/loop-check.ts`,
> `src/components/TabBar.tsx`, or `src/lib/loop.ts`.
>
> **Drift check (run first)**:
> `git diff --stat d78518f..HEAD -- src-tauri/src/codex.rs src-tauri/src/ingest.rs src-tauri/src/pty.rs src-tauri/src/lib.rs src/lib/ingest.ts src/lib/repo.ts src/App.tsx src/types.ts scripts/epoch-check.ts scripts/reentry-check.ts docs/TESTING.md`
> If any in-scope file changed since this plan was written, compare the
> current-state excerpts below with the live code. A mismatch is a STOP
> condition.

## Shared repository context

Logic Loop is a Tauri v2 macOS-first terminal application. Rust owns PTY
creation and the localhost ingest server; React/TypeScript owns tab state and
SQL-backed panels. The app observes structured agent hooks and never parses
ANSI terminal output for meaning. Hook commands must fail open: a broken or
unreachable ingest server must never block Codex or affect terminal use.

The relevant repository verification commands are:

| Purpose | Command | Expected result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Exit 0 with no errors |
| Rust tests | `cd src-tauri && cargo test --lib` | All tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Exit 0 with no warnings |
| TypeScript checks | `npm run check` | Every check script passes |
| Diff hygiene | `git diff --check` | No whitespace errors |

The repository uses append-only SQLite migrations in `src-tauri/src/lib.rs`,
typed repository access in `src/lib/repo.ts`, and pure logic check scripts in
`scripts/`. Match the idempotent adapter tests in
`src-tauri/src/codex.rs:144-199` and the pure binding/re-entry checks in
`scripts/bind-check.ts` and `scripts/reentry-check.ts`.

---

# Plan 001: Carry Codex adapter identity through ingestion

## Build outcome (Phase 16, 2026-09-06): DONE as written. `hook_command_with_agent(Some("codex"))` in `ingest.rs`; `RECOGNIZED_AGENTS` allowlist gates the header→payload stamp.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt / correctness
- **Planned at**: commit `d78518f`, 2026-09-06

## Why this matters

The Codex adapter currently reuses the same hook command as Claude and sends no
adapter identity to the ingest server. That makes it impossible for later code
to choose Codex-specific resume behavior or interpret Codex-specific payload
semantics safely. A small explicit identity marker at the hook boundary gives
the rest of the app a reliable discriminator while preserving the existing
agent-agnostic event names and fail-open behavior.

## Current state

- `src-tauri/src/codex.rs:22-24` documents that Codex reuses
  `crate::ingest::hook_command()` verbatim.
- `src-tauri/src/codex.rs:71-83` writes that shared command into every Codex
  hook entry.
- `src-tauri/src/ingest.rs:241-249` emits a `sh -c` command that sends stdin to
  `/event`, but currently only supplies the tab tether and hook version headers.
- `src-tauri/src/ingest.rs:107-125` stamps `project_key`, `tab_id`, and
  `hook_version` into the payload, but no adapter identity.
- `src/types.ts:137-149` defines `HookPayload` with arbitrary extra fields but
  no named adapter field.
- `src/lib/ingest.ts:65-70` validates only `hook_event_name` and `session_id`,
  so adding an optional adapter field is backward-compatible.

The marker must not be inferred from `tool_name`, session-id format, transcript
paths, or the presence of `PermissionRequest`; those are protocol data, not a
stable adapter identity.

## Scope

**In scope**:

- `src-tauri/src/ingest.rs`
- `src-tauri/src/codex.rs`
- `src/types.ts`
- `src-tauri/src/lib.rs` only if command registration or Rust tests require it
- Rust tests in the existing adapter modules

**Out of scope**:

- Re-entry behavior; Plan 002 consumes this identity.
- New Codex event handling; Plan 003 owns that.
- Transcript parsing or decision extraction.
- Changes to Claude, OpenCode, or Antigravity behavior beyond retaining their
  current no-marker/default behavior.
- Any change to terminal PTY bytes or ANSI parsing.

## Steps

### Step 1: Add an optional adapter marker to the Codex hook command

Refactor the shared hook-command builder in `src-tauri/src/ingest.rs` so the
existing `hook_command()` output remains byte-for-byte unchanged for Claude,
while a Codex-specific builder variant adds a fixed header such as
`X-Logic-Loop-Agent: codex`. Do not put the adapter name into the JSON body in
the shell command; the command must continue piping Codex stdin unchanged.

Keep the existing `Authorization`, `X-Logic-Loop-Tab`, hook-version, timeout,
redirects, and unconditional `exit 0` behavior. The adapter marker is a
constant selected by Rust code, never user input.

**Verify**: `cd src-tauri && cargo test --lib ingest::tests::hook_command_carries_the_contract_version_and_tether` → the existing test passes, and a new assertion confirms the default Claude command has no Codex marker.

### Step 2: Make the Codex adapter use the marked command

Change `src-tauri/src/codex.rs:71-83` to use the Codex-specific command builder.
Keep all other hook JSON fields unchanged. Add a unit test that checks all
registered Codex entries contain the Codex marker and still contain the shared
ingest marker.

**Verify**: `cd src-tauri && cargo test --lib codex::tests` → all Codex adapter tests pass, including idempotency and foreign-hook preservation.

### Step 3: Stamp and type the adapter identity at the ingest boundary

In `src-tauri/src/ingest.rs`, read the new header and add an optional
`agent`/adapter field to the normalized payload only when the header is one of
the known constants. For this plan, `codex` is the only new recognized value.
Unknown or absent values must remain absent rather than being guessed as
Claude. Continue deriving `project_key` server-side and continue dropping the
extractor tether before parsing.

Add an optional `agent?: "codex" | string` field to `HookPayload` in
`src/types.ts`. Do not require it in `onHookEvent`; old Claude events and
previously stored rows remain valid.

**Verify**: `npx tsc --noEmit` → exit 0; `cd src-tauri && cargo test --lib ingest::tests` → all ingest tests pass, including tests for present, absent, and unknown agent headers.

### Step 4: Document the normalized field for downstream plans

Add a concise comment in `src/types.ts` and the relevant Rust normalization
code stating that `agent: "codex"` is an ingestion-origin marker, not model
identity and not the Codex `agent_id` subagent field. Do not expose token or
credential values in comments or tests.

**Verify**: `git diff --check` → no whitespace errors; `rg -n "agent_id|agent" src/types.ts src-tauri/src/ingest.rs src-tauri/src/codex.rs` → the named adapter marker and the separate Codex subagent field are clearly distinguishable.

## Test plan

- Extend the existing Rust hook-command tests rather than creating a second
  command fixture.
- Test that the Claude/default command remains unchanged in all security- and
  fail-open-relevant portions.
- Test that Codex setup writes the marker to all Codex events.
- Test that the ingest normalizer adds `agent: "codex"` only for the exact
  recognized header and ignores unknown values.
- Run the full shared gates listed above after the focused tests.

## Done criteria

- [ ] Codex hook commands carry a fixed adapter marker.
- [ ] Normalized Codex hook payloads contain `agent: "codex"`.
- [ ] Claude/default hook commands remain behaviorally unchanged.
- [ ] No adapter identity is inferred from session IDs, tool names, or paths.
- [ ] `npx tsc --noEmit` passes.
- [ ] `cd src-tauri && cargo test --lib` passes.
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings` passes.
- [ ] `npm run check` passes.
- [ ] `git diff --check` passes.
- [ ] Only files in this plan's scope are modified, aside from the executor's
  status update in `plans/README.md`.

## STOP conditions

- The existing Claude `hook_command()` output must change in a way that could
  alter its shell quoting, timeout, auth, or exit-0 behavior.
- Codex hook execution does not preserve the custom header in a live/manual
  probe; stop and report rather than placing the marker in agent-controlled
  stdin JSON.
- The ingest server already has a different adapter identity mechanism than
  the one described here.
- Adding the field requires changing database schema or panel queries; that is
  Plan 002 or a separate plan, not an improvisation in this plan.

## Maintenance notes

Future adapters should use the same explicit boundary marker instead of
relying on payload shape. Keep adapter identity separate from Codex's
`agent_id`, which identifies a subagent and is intentionally used by
`stateForHook` to avoid driving the parent tab's state.

---

# Plan 002: Resume Codex sessions with the Codex CLI

## Build outcome (Phase 16, 2026-09-06): DONE as written. `codex resume --help` and a live resumed session (context correctly recalled) confirmed the syntax before it was hardcoded into `pty.rs`'s `resume_command`.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plan 001 in this file
- **Category**: correctness / migration
- **Planned at**: commit `d78518f`, 2026-09-06

## Why this matters

Logic Loop offers a “Re-enter” action for a session that survives process
death or app relaunch, but the Rust implementation hard-codes Claude's resume
command. A Codex session therefore cannot be resumed correctly and may start a
different agent or fall back to a shell. The fix must persist the adapter kind
alongside the session binding and select a small, validated resume command.

The installed Codex CLI confirms the supported form is `codex resume
[SESSION_ID]`; do not translate it to Claude's `claude --resume` form.

## Current state

- `src-tauri/src/pty.rs:110-117` validates only a generic session-id string.
- `src-tauri/src/pty.rs:145-154` builds
  `claude --resume <sid>; exec <shell> -l` for every resume request.
- `src/App.tsx:447-455` passes `tab.sessionId` to `ptySpawn` without an agent
  selector.
- `src-tauri/src/lib.rs:107-119` defines `session_bindings` without an agent
  column.
- `src/lib/repo.ts:439-453` upserts bindings without adapter identity.
- `src/lib/repo.ts:462-491` returns `ReentryCandidate` data without adapter
  identity.
- `src/types.ts:82-90` defines `ReentryCandidate` without adapter identity;
  `Tab` also has no agent field.
- `src/App.tsx:477-485` constructs relaunch ghost tabs from those candidates,
  and `src/components/Terminal.tsx:143-149` invokes the generic re-entry path.

Codex's current official hook schemas allow `transcript_path` to be null, but
Codex resume uses the session ID. The current database column is `NOT NULL`, so
the implementation must not silently discard a Codex SessionStart merely
because its transcript path is absent. Preserve the existing column contract
with an explicit empty-string sentinel and document that it is not used for
resume, unless the executor chooses a safer tested migration to make the
column nullable.

## Scope

**In scope**:

- `src-tauri/src/lib.rs` migration for the binding metadata
- `src-tauri/src/pty.rs` and `src/lib/pty.ts`
- `src/App.tsx`, `src/types.ts`, `src/lib/repo.ts`
- `src/components/Terminal.tsx` only if the button needs an agent-aware label
- `scripts/reentry-check.ts`
- `docs/TESTING.md` Codex/re-entry checks

**Out of scope**:

- Arbitrary user-supplied resume commands.
- Changing Claude's existing resume behavior.
- Implementing resume for OpenCode or Antigravity.
- Changing worktree or fan-out launch behavior.
- Reading or parsing Codex rollout transcripts.

## Steps

### Step 1: Add persisted adapter metadata to session bindings

Add a new numbered SQLite migration after the current latest migration in
`src-tauri/src/lib.rs`. Add an optional `agent TEXT` column to
`session_bindings`; existing rows must remain readable. Do not edit an old
migration.

Extend `ReentryCandidate`, `Tab`, and the repository binding functions so new
Codex SessionStart events persist `agent: "codex"`. When the Codex payload has
no transcript path, store the documented empty-string sentinel rather than
skipping the binding. Preserve legacy rows with a null agent as legacy Claude
resume candidates, because the pre-adapter application only supported Claude.

**Verify**: `cd src-tauri && cargo test --lib` → migration initialization and all Rust tests pass; `npx tsc --noEmit` → no TypeScript errors.

### Step 2: Thread the agent from hook payload to binding and ghost tab

In the `SessionStart` branch of `src/App.tsx`, pass the normalized adapter
identity from Plan 001 into `repo.upsertSessionBinding`. Keep the existing
tether requirement: outside-terminal sessions must not become re-entry ghosts.

Update `reentryCandidates()` and ghost-tab construction so Codex candidates
carry their adapter kind into the in-memory `Tab`. Do not bind a session by
cwd merely because a Codex tether is missing.

**Verify**: `npx tsx scripts/reentry-check.ts` → all assertions pass, including
latest-per-tether selection and preservation of the Codex agent field.

### Step 3: Add a validated Codex resume path in the PTY spawn API

Extend the `ptySpawn` TypeScript wrapper and Rust command with a validated
resume-agent argument. The Rust implementation must select from a closed set:

- `codex` → `codex resume <validated-session-id>`
- `claude` or absent legacy value → existing `claude --resume <sid>` behavior

Keep `valid_resume_id` as the shell-injection boundary. Do not accept an
arbitrary command string or concatenate a user-provided agent name into the
shell line. Preserve the existing tether environment variable and fail-open
fallback to the interactive shell when the agent executable or session cannot
resume.

Factor the command selection into a pure Rust helper so it can be tested
without spawning a PTY. Add tests proving Codex uses `codex resume`, Claude
uses its existing syntax, and metacharacter-containing IDs are rejected.

**Verify**: `cd src-tauri && cargo test --lib pty::tests` → resume command and
injection tests pass; `npx tsc --noEmit` → no TypeScript errors.

### Step 4: Use the agent-aware resume path from the UI

Update `restartTab` in `src/App.tsx` to pass the tab's agent kind along with
the session ID. Keep the normal “Restart” path unchanged for tabs without a
session ID. The existing Terminal button may continue to say “Re-enter” for a
known Codex or legacy Claude session; if an unknown future agent is present,
show “Restart” instead of pretending resume is supported.

**Verify**: `git diff --check` → no whitespace errors; `rg -n "claude --resume|codex resume|resume_agent|agent" src-tauri/src/pty.rs src/App.tsx src/lib/pty.ts src/types.ts` → both explicit supported paths are visible and no generic arbitrary command path exists.

### Step 5: Add manual regression coverage

Extend the relevant re-entry section of `docs/TESTING.md` with a Codex case:
run Codex in a Logic Loop tab, kill the PTY or quit/relaunch, click Re-enter,
and confirm the resumed prompt is Codex with the prior session context. Also
cover a Codex SessionStart payload with a null transcript path if the installed
Codex version can produce one.

**Verify**: `git diff --check` → clean; the manual test text names the Codex
CLI version and distinguishes Re-enter from a fresh Restart.

## Test plan

- Extend `scripts/reentry-check.ts` with a pure candidate carrying
  `agent: "codex"` and assert it survives `latestPerTether`.
- Add Rust unit tests for resume command selection and session-id validation.
- Run the full shared verification commands after the migration and UI wiring.
- Perform the documented live Codex re-entry test on macOS; database evidence
  should show the new resumed session bound to the same tab tether.

## Done criteria

- [ ] A Codex binding persists adapter identity.
- [ ] A Codex ghost tab resumes via `codex resume <SESSION_ID>`.
- [ ] A legacy Claude candidate still resumes via `claude --resume`.
- [ ] Null Codex transcript paths do not prevent re-entry metadata from being
  stored.
- [ ] Arbitrary resume commands and unsafe session IDs are rejected.
- [ ] `npx tsc --noEmit` passes.
- [ ] `cd src-tauri && cargo test --lib` passes.
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings` passes.
- [ ] `npm run check` passes.
- [ ] `git diff --check` passes.
- [ ] The status row for Plan 002 in `plans/README.md` is updated.

## STOP conditions

- The current migration number is not the one shown in the plan; inspect the
  live migration list and report before choosing a new number.
- The Codex executable requires a different resume syntax than the locally
  verified `codex resume <SESSION_ID>` form; report the observed version and
  stop rather than guessing.
- A database migration would require destructive deletion or rewriting of
  existing session history; stop and report for a migration redesign.
- The executor cannot distinguish a fresh Restart from a session re-entry
  without changing out-of-scope fan-out or worktree code.

## Maintenance notes

The adapter field is now part of re-entry correctness. Any new adapter that
supports resumable sessions must add a closed-set resume mapping and a binding
fixture before exposing “Re-enter.” Never generalize this into an arbitrary
shell command supplied by the UI.

---

# Plan 003: Handle Codex interruption and session-end lifecycle events

## Build outcome (Phase 16, 2026-09-06): DONE as written. Live-verified against codex-cli 0.153.4 — `SIGINT` on a running `codex exec` turn fired real `Interrupt` then `SessionEnd` payloads (not just cited from upstream source); both event names installed without hooks.json being rejected.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 001 in this file
- **Category**: correctness / tests
- **Planned at**: commit `d78518f`, 2026-09-06

## Why this matters

The current Codex adapter registers only `SessionStart`, `Stop`, `PostToolUse`,
`UserPromptSubmit`, and `PermissionRequest`. Current Codex hook definitions
also include interruption and session-end lifecycle events, and upstream reports
that pressing Esc may not emit `Stop`. Without a terminal event that the app
understands, a tab can remain visually working after the user has interrupted
Codex.

This plan adds only lifecycle handling needed for accurate tab state and
result tracking. It does not parse Codex rollout transcripts or invent failure
semantics that Codex does not expose.

## Current state

- `src-tauri/src/codex.rs:7-8` defines the five-event
  `CODEX_HOOK_EVENTS` list.
- `src/lib/ingest.ts:226-249` maps `UserPromptSubmit`, `PostToolUse`,
  `PermissionRequest`, and `Stop`; all other events return null.
- `src/App.tsx:555-558` invokes decision-stop handling only for `Stop`.
- `src/App.tsx:633-647` writes `result_landed` only for `Stop`.
- `scripts/epoch-check.ts` covers the existing Stop epoch guard but has no
  Codex interruption/session-end cases.
- Current upstream Codex source lists `Interrupt` and `SessionEnd` among hook
  events. The official `Interrupt` schema includes `session_id`, `cwd`, and
  `turn_id`; the official `SessionEnd` schema includes `session_id`, `cwd`, and
  an end reason. See:
  `https://github.com/openai/codex/blob/main/codex-rs/hooks/src/lib.rs`,
  `https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/interrupt.command.input.schema.json`,
  and
  `https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/session-end.command.input.schema.json`.

## Scope

**In scope**:

- `src-tauri/src/codex.rs`
- `src/lib/ingest.ts`
- `src/App.tsx`
- `scripts/epoch-check.ts`
- Rust adapter tests and relevant Codex section of `docs/TESTING.md`

**Out of scope**:

- Codex resume command selection; Plan 002 owns it.
- Decision extraction from Codex prompt/assistant fields.
- Text heuristics for determining command failure.
- Changes to Claude, OpenCode, or Antigravity lifecycle semantics.
- Automatic input or control messages sent to Codex.

## Steps

### Step 1: Register supported Codex terminal lifecycle events

Extend `CODEX_HOOK_EVENTS` with `Interrupt` and `SessionEnd`, preserving the
existing five events and the same fail-open command. Add tests asserting both
events are installed, preserved through idempotent setup, and removed by the
Codex adapter's cleanup path.

Do not add every event from the latest upstream source automatically. The
minimum supported set for this plan is the two terminal lifecycle events; add
other events only in a separately tested plan. If the installed Codex version
rejects either event key, stop and implement explicit version capability
detection instead of silently dropping the lifecycle fix.

**Verify**: `cd src-tauri && cargo test --lib codex::tests` → all Codex setup,
removal, preservation, and event-list assertions pass.

### Step 2: Extend the pure state machine

Update `stateForHook` in `src/lib/ingest.ts`:

- `Interrupt` must close the current epoch and return `"idle"`.
- `SessionEnd` must close the current epoch and return `"idle"`.
- Existing `Stop`, `UserPromptSubmit`, `PostToolUse`, and
  `PermissionRequest` behavior must remain unchanged.
- Events carrying a non-empty Codex `agent_id` must continue to avoid driving
  the parent tab state.

Do not return `"error"` for interruption merely because the user pressed Esc;
interruption is a terminal idle state, not an agent failure.

**Verify**: `npx tsx scripts/epoch-check.ts` → existing assertions and new
Interrupt/SessionEnd epoch assertions pass; `npx tsc --noEmit` → no errors.

### Step 3: Apply terminal-event semantics in App.tsx

Replace the Stop-only checks in the hook handler with a clearly named
terminal-event predicate. Use it to update the stopped-session epoch and tab
state through `stateForHook`.

Only `Stop` and `Interrupt` should create a `result_landed` record for the
current turn, because they represent a completed or interrupted turn. Do not
create a result for `SessionEnd` alone; it can describe session shutdown
without a new user-visible result. If decision cleanup is invoked for terminal
events, it must remain fail-open and must not cause duplicate extraction work.

Preserve current background-tab notification behavior and ensure a terminal
event from a tethered Codex session still refreshes the fan-out rollup.

**Verify**: `npm run check` → all check scripts pass; `rg -n "hook_event_name.*Stop|isStop|result_landed|Interrupt|SessionEnd" src/App.tsx src/lib/ingest.ts` → terminal handling is centralized and no accidental Stop-only result path remains.

### Step 4: Add Codex lifecycle regression coverage

Extend `scripts/epoch-check.ts` with cases for:

- `UserPromptSubmit → Interrupt` returns to idle.
- A late `PostToolUse` after `Interrupt` does not revive the tab.
- A new `UserPromptSubmit` after `Interrupt` starts a fresh working epoch.
- `SessionEnd` returns to idle and blocks late events.
- A subagent event with `agent_id` does not change the parent state.

Add a manual checklist item to `docs/TESTING.md` §20 for interrupting a real
Codex turn with Esc and confirming the dot returns to idle, plus a normal
session-close check. Record the Codex CLI version used.

**Verify**: `npx tsx scripts/epoch-check.ts` → all lifecycle assertions pass;
`git diff --check` → no whitespace errors.

## Test plan

- Use the existing pure state-machine style in `scripts/epoch-check.ts`; do not
  require a live Tauri window for deterministic lifecycle tests.
- Use the existing Rust adapter setup tests as the JSON registration pattern.
- Run `cd src-tauri && cargo test --lib`, `cargo clippy --all-targets -- -D
  warnings`, `npx tsc --noEmit`, and `npm run check`.
- Perform the manual Codex interruption test because whether a specific Codex
  build emits `Interrupt` is an external runtime contract.

## Done criteria

- [ ] Codex installs and removes `Interrupt` and `SessionEnd` hooks
  idempotently.
- [ ] Interrupting Codex returns the bound tab to idle.
- [ ] Late events from the interrupted epoch do not revive the tab.
- [ ] A new prompt starts a new working epoch.
- [ ] SessionEnd returns the tab to idle without fabricating a result.
- [ ] Background Stop/Interrupt result notifications retain existing behavior.
- [ ] `npx tsc --noEmit` passes.
- [ ] `cd src-tauri && cargo test --lib` passes.
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings` passes.
- [ ] `npm run check` passes.
- [ ] `git diff --check` passes.
- [ ] The status row for Plan 003 in `plans/README.md` is updated.

## STOP conditions

- The installed Codex build does not dispatch `Interrupt` or `SessionEnd` in a
  real interactive session; report the observed behavior and version rather
  than claiming the UI fix is verified.
- Adding either hook event changes Codex's trust prompt or rejects the entire
  hooks file; stop and design a version-gated registration path.
- The event payload uses a different session identifier or lacks the tab
  tether; do not add cwd-based fallback logic to this plan.
- Existing Claude epoch tests regress; stop and isolate adapter-specific
  handling before continuing.

## Maintenance notes

Keep lifecycle semantics explicit. `Stop` and `Interrupt` are turn-terminal;
`SessionEnd` is session-terminal but does not itself prove that a new result
landed. If Codex later adds a dedicated failure or cancellation event, extend
the normalized state machine with a new test matrix rather than treating every
unknown event as idle or error.
