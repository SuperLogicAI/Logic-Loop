# Plan 026: Add Pi Agent to the adapter menu

> **Status: CANDIDATE. Planning only.** Do not implement this plan before the
> maintainer assigns/approves its phase under the `PHASE N ACCEPTED` rule.
> Read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and this plan before work.
> First run `git diff --stat 4d91d5e..HEAD --` with the in-scope paths below;
> inspect any changed file against the current-state excerpts. Stop on an
> incompatible contract. Pi CLI 0.85.1 was found in the planning environment,
> but the live extension/session gate below has not been run.

## Status

- **Priority:** P1 product addition
- **Effort:** M, approximately 2-4 build days plus a clean-profile macOS pass
- **Risk:** MED; the extension runs inside Pi, and re-entry depends on its
  current session-ID contract
- **Depends on:** explicit phase approval; reconcile with accepted mainline
  before scheduling (Plan 024 tracks branch reconciliation)
- **Planned at:** `4d91d5e`, 2026-09-17
- **Research:** `docs/IDEAS.md` lines 939-1063; current upstream
  [extension API](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
  [CLI/session options](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md),
  [session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)

## Outcome and boundaries

The setup menu and header offer **Pi Agent** (`pi`) as a fifth adapter. Its
in-process, global TypeScript extension emits structured lifecycle and tool
activity to the existing token-authenticated localhost ingest endpoint. A
Pi session launched in a Logic Loop tab can re-enter after app relaunch.
Show **Activity: included; Decisions: not supported; Re-entry: included** only
after the live re-entry gate below passes. Never derive activity from PTY/ANSI
output, parse Pi session JSONL for this sprint, or send terminal input after
spawn. No migration, extractor change, RPC sidecar, autonomous launch, or
Prime Agent support is part of this sprint.

Pi's documented global extension directory is `~/.pi/agent/extensions/`;
project extensions require project trust. `session_start` provides the
session manager, `before_agent_start` fires after a submitted prompt,
`tool_execution_start` provides call arguments, while
`tool_execution_end` provides the same call ID plus result/error flag; and
`agent_settled` is the true idle boundary after retries and queued work.
Use observation only; do not return modifications from any handler. Pi's
`--session <path|id>` is the documented explicit-session CLI option. These
facts are from upstream docs, not yet verified against a local executable.

## Current state and conventions

- `src/lib/onboarding.ts` has the closed `AdapterId` union and `ADAPTERS`
  array, currently Claude, Codex, OpenCode, Antigravity. Its
  `adapterIdForHook` maps a missing marker to Claude and accepts only the
  other three known markers. `scripts/onboarding-check.ts` pins this array.
- `src/components/AgentStatusBar.tsx` owns one `ADAPTER_ACTIONS` table and
  one toggle path shared with `OnboardingModal.tsx`. Add Pi there, not a
  separate setup flow. `src/lib/ingest.ts` owns Tauri invoke wrappers.
- `src-tauri/src/ingest.rs` stamps `X-Logic-Loop-Agent` from a closed
  `RECOGNIZED_AGENTS` allowlist and emits `ingest://hook`. It only tails
  Claude/Codex transcript paths. Keep Pi out of the tailer gate.
- `src/App.tsx` persists only tethered `SessionStart` through
  `repo.upsertSessionBinding(...)`; `src-tauri/src/pty.rs::resume_command`
  selects a fixed command by adapter after `valid_resume_id`. Current cases:

  ```rust
  Some("codex") => format!("codex resume {sid}; exec {shell} -l"),
  Some("antigravity") => format!("agy --conversation {sid}; exec {shell} -l"),
  _ => format!("claude --resume {sid}; exec {shell} -l"),
  ```

- `src/lib/ingest.ts::stateForHook` uses `UserPromptSubmit` to open a turn,
  `PostToolUse` for working/error, and `Stop` for idle. `src/lib/repo.ts`
  maps `hook:PostToolUse` into Accomplished rows and dedupes by
  `tool_use_id`. Preserve that shared wire shape.
- Model the installer on `src-tauri/src/opencode.rs`: managed generated
  source, explicit detect/setup/remove/status commands, idempotent tests,
  fire-and-forget bounded POST, fail open. Pi's extension file should carry
  a generation marker and version. Never remove or overwrite an unrelated
  user's extension file. Keep DB access in `src/lib/repo.ts`; use a new
  numbered migration only if a later approved plan needs one.

## Step 0: Prove the local Pi contract

On a machine with Pi installed, record `pi --version` and `pi --help` in a
new Pi section of `docs/TESTING.md`. Use a disposable directory and an
unpublished local extension loaded with `pi -e <path>`; do not edit the
user's global Pi config for this spike. Observe a fresh session, a tool call,
a second prompt, `/new`, `/resume`, `/reload`, quit/relaunch, and
`pi --session <full-id>` against that session. Record redacted event shapes,
session IDs, cwd, ordering, and whether `getSessionId()` stays stable on
re-entry. Confirm `agent_settled` fires only after the run is truly done.
This workspace has `/opt/homebrew/bin/pi` version `0.85.1`; its help confirms
`--session <path|id>`. That proves CLI presence only, not hook timing or
resume continuity. If the build workspace lacks Pi, pause live validation
until the maintainer supplies an installation; do not install it or change
global configuration on their behalf during the spike.

**Gate:** All named events and `--session` continuity are observed in the
installed build. If any differ, revise this candidate plan and obtain phase
scope approval again before coding. Do not silently substitute JSON-mode
stdout, RPC, polling, or transcript parsing.

## Build steps

1. Add `src-tauri/src/pi.rs` and register its commands in
   `src-tauri/src/lib.rs`. Detect executable `pi` using PATH plus documented
   per-user install locations appropriate to the supported macOS build;
   check executable bits, do not run Pi merely to detect it. Setup writes an
   app-owned `logic-loop.ts` only at Pi's global extension directory after a
   human clicks Enable. If that filename exists without the app marker,
   return a visible conflict error and leave it untouched. Repeated setup
   refreshes only our marked file; remove deletes only our marked file;
   status returns true only for a current, owned file. Use `crate::home`
   rather than an ad hoc `$HOME` fallback. Verify with Rust tests for
   absent/foreign/owned files and idempotent setup/remove.
2. In the generated extension, read the current
   `~/.context-terminal/ingest.env` per POST (or refresh on failed delivery)
   so an app restart rotates the port/token without requiring `/reload`.
   Send a bounded JSON payload with `Authorization: Bearer`,
   `X-Logic-Loop-Tab` from `LOGIC_LOOP_TAB_ID`, version header, and
   `X-Logic-Loop-Agent: pi`; set a short abort timeout, suppress network
   errors, never await the POST in a Pi lifecycle handler, and never send
   prompt text, tool result text, secrets, or an entire session object.
   Map `session_start` to `SessionStart`, `before_agent_start` to
   `UserPromptSubmit`, and `tool_execution_end` to `PostToolUse`. Capture
   only bounded, allowlisted argument fields from `tool_execution_start`
   in a per-session map keyed by `toolCallId`, then consume/delete the
   matching entry at `tool_execution_end`; clear the map on
   `session_shutdown` and `session_start`. The completed event carries
   `tool_use_id`, `tool_name`, bounded normalized `tool_input` fields
   (`file_path`/`command`/`description` only), and
   `tool_response: {is_error: boolean}`, and `agent_settled` to `Stop`.
   Missing start data yields an empty `tool_input`, never a guess from
   result text. Every row needs `session_id` and `cwd`; omit a row if
   either is absent.
   Keep payload below the ingest server's 1 MB limit. Never emit a `Stop`
   for `agent_end` or `turn_end`.
3. Add Pi to the Rust ingest allowlist and its tests, TS invoke wrappers,
   `AdapterId`/metadata/marker parsing, the shared status-bar action map,
   and onboarding check. Add a concise Pi manual-setup note to `README.md`
   and `CONTRIBUTING.md`. Do not bump `ONBOARDING_VERSION` merely to show
   the new row; the persistent Setup action exposes it to existing users.
   Verify `npm run onboarding:check`, `npm run opencode:check`, and the
   new focused `npm run pi:check` after registering it in `package.json` and
   `npm run check`.
4. After Step 0 proves a full stable ID, add only the fixed Pi arm to
   `resume_command`: `pi --session {sid}; exec {shell} -l`. Retain
   `valid_resume_id` and the fallback shell. Verify unit tests for Pi,
   legacy Claude, Codex, Antigravity, and rejected/unknown IDs. Confirm the
   tethered Pi `SessionStart` writes `agent=pi` and an empty transcript-path
   sentinel; confirm the server never tails that path. Extend
   `scripts/reentry-check.ts` for Pi. If full IDs have characters excluded
   by `valid_resume_id`, stop and redesign the validator explicitly; never
   interpolate an arbitrary session path into a shell command.
5. Complete `docs/TESTING.md` with a clean-profile macOS matrix: disabled
   toggle, enable, first tethered event/Connected state, two Pi tabs in one
   cwd without crossed bindings, tool detail/error, multiple turns,
   retry/follow-up before idle, `/new` and `/reload`, app quit/relaunch and
   re-entry with prior-context recall, disable while Pi runs, absent ingest
   server, and foreign `logic-loop.ts` collision. Existing four adapters
   must still detect, toggle, and report correctly. Record Pi version and
   redacted evidence; no private session text or credentials.

## Scope and checks

In scope: `src-tauri/src/pi.rs` (new), `src-tauri/src/lib.rs`,
`src-tauri/src/ingest.rs`, `src-tauri/src/pty.rs`, `src/lib/ingest.ts`,
`src/lib/onboarding.ts`, `src/components/AgentStatusBar.tsx`,
`src/lib/repo.ts` only if the live tool-field shape requires its existing
verb map, `scripts/onboarding-check.ts`, `scripts/reentry-check.ts`,
`scripts/pi-check.ts` (new), `package.json`, `README.md`,
`CONTRIBUTING.md`, `docs/TESTING.md`, and this plan/index status.
`src/App.tsx` should need no change: its existing generic tethered
`SessionStart` binding is the integration point. If it does need one, document
why and get the approved scope amended before touching it.

Out of scope: `src/lib/decisions.ts`, transcript tailing/parsing, schema
migrations, Prime Agent, global Pi settings edits, Pi package installation,
new Tauri windows, autonomous terminal writes, and refactors of other
adapters. No hand-edits to an installed/generated extension.

Run focused checks first, then `npm run opencode:check`, `npm run check`,
`npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo test --lib`,
`cd src-tauri && cargo clippy --all-targets -- -D warnings`, and
`git diff --check`. Do not run `npm run golden`; extraction prompts do not
change. Tests must cover mapping and bounded payloads, fail-open posting,
foreign-file preservation, token refresh, duplicate tool IDs, empty IDs,
and resume selection. Inspect `git status --short` for out-of-scope edits;
leave existing unrelated worktree files untouched.

## Acceptance and stop conditions

- The five-row menu/header reports Pi truthfully and only a real tethered
  structured event marks its onboarding connection.
- A Pi tool call yields one Accomplished event with the correct project/tab;
  repeated delivery of its tool ID does not duplicate the row.
- `agent_settled` yields one idle/result boundary after automatic work;
  `agent_end` alone does not. A new prompt reopens the epoch.
- Re-entered Pi in the app recalls earlier context, retains its tab
  presentation, and does not become a Claude session.
- Other four adapters and raw terminal behavior pass their existing checks.
- Stop and report if Pi's installed extension API, session ID, CLI resume
  semantics, global discovery, or hook timing differs from the documented
  contract; if the existing filename belongs to someone else; if the
  solution would require an out-of-scope file or a new schema; or if a gate
  fails twice after a focused fix. Preserve the user's config and terminal
  behavior in every failure case.

Maintenance note: Pi is pre-1.0 and its extension API can change. Keep the
generated source versioned and run the redacted live matrix after a Pi
upgrade. `docs/IDEAS.md` suggests possible Prime Agent reuse; verify that
fork's current API independently before sharing an installer later.
