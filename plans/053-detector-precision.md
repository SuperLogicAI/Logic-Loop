# Detector precision: scan failed commands only

Status: **APPROVED 2026-10-07 (`PHASE 53 APPROVED`, decisions 1-5 as recommended). Branch `feat/phase-53-detector-precision`. Built; gates green; live checks passed; `PHASE 53 ACCEPTED` 2026-10-07.**

Source: Phase 52 live review. Maintainer screenshots showed Detected rows
"Rate limited" / "TLS/cert error" / "Lock held" whose matched text was this
repo's own source (`detectors.ts` regex literals, a Plan 023 code comment,
README lines). Plan 052 parked "detector precision" as its own plan; the
maintainer chose it as Phase 53.

## Problem (verified 2026-10-07; counts and field names only)

Baseline: 102 detected rows in the 14 days to 2026-10-06 (~7/day), 0 typed
blockers; 99 detected rows open.

Root cause, verified in code, hook payload structure and Claude Code docs:

1. **Detectors only ever see successful commands.** The single call site
   (`App.tsx:1097`) runs detectors on `PostToolUse` `tool_response` for
   `Bash`/`run_command`. Claude Code sends *failed* tool calls through a
   separate `PostToolUseFailure` hook (`error: "Exit code N\n<output>"`,
   `is_interrupt`; code.claude.com/docs/en/hooks, via Context7). Logic Loop
   doesn't register it (`HOOK_EVENTS`, `ingest.rs:650`; zero
   `hook:PostToolUseFailure` rows in the real profile). So for Claude, real
   failures never reach detectors, while every file an agent reads through
   Bash (`grep -n`, `sed -n`, `cat`) does. That is exactly the screenshot
   noise.
2. **Claude's success payload has no exit code**: `stdout, stderr,
   interrupted, isImage, noOutputExpected` (+ occasional extras), across
   ~1,500 recent rows.
3. **Codex**: `tool_response` is plain text; 0 of 1,130 recent shell rows
   start with an exit-code header, no top-level exit code. No failure signal
   found yet.
4. **DeepSeek**: `tool_response` is `{is_error}` only, no text, so detectors
   never fire today. **Antigravity** strips exit status upstream (README).
   **OpenCode / Pi**: no shell events in the recent sample; unverified.
5. `detectors.ts`'s header says it scans "raw transcript lines". It doesn't
   (no other call site). Stale comment.

## Step 1 audit result (2026-10-07; counts and structure only, no content)

Real profile DB, all `hook:PostToolUse` shell-tool rows by adapter, plus
Context7 docs (`/openai/codex`, `/anomalyco/opencode`) and the in-repo
`antigravity.rs` hooks.proto root-cause note.

| Adapter | Shell `tool_response` shape (rows) | Failure signal | Decision |
|---|---|---|---|
| Claude | object `stdout/stderr/interrupted/...` (13,037); failures arrive as separate `PostToolUseFailure` (docs) | `PostToolUseFailure.error` string + `is_interrupt` | **Wire** (step 2-3) |
| Codex | hook response plain text (3,825 at initial audit; 3,846 on revision 2); rollout `event_msg.item_completed.item` is `CommandExecution` with integer `exit_code` + string `aggregated_output` (3,787 DB transcript rows: 3,532 zero, 255 non-zero) | rollout completion `exit_code` **plus** `aggregated_output`; no failure-specific hook | **Wire** existing transcript path (revision 2); hook text stays null |
| OpenCode | object `{title, output, metadata{exit:int, output, truncated}}` (9, all `exit` 0). Docs: bash returns non-zero as `exit`, never throws; `tool.execute.after` is not called when the tool itself throws | `metadata.exit` integer **plus** `output` text | **Wire**: `exit` is a number != 0 -> scan `output`. Non-zero never seen live (only exit 0 sampled); fixture-tested, flagged unverified in TESTING.md |
| Pi | object `{is_error}` only (17; 2 true) — extension deliberately never sends tool result text | flag, no text | **None** (nothing to scan) |
| DeepSeek | object `{is_error}` only (128, all false) | flag, no text | **None** |
| Antigravity | `run_command`: 19 rows with no `tool_response`; 1 `{is_error:true, error:<text>}`. A real non-zero exit sends `error: ""` (hooks.proto, `antigravity.rs:221-244`) so ordinary failures are unobservable | `is_error` + `error` text only for tool-level errors | **Wire** the generic rule `is_error === true` + non-empty string `error`; ordinary failed commands stay invisible (documented) |

**Plan revision 1 (stated, not silent):** step 3 `detectorTextFor` gains two
per-adapter branches the draft left open: OpenCode (`metadata.exit` != 0 ->
`output`) and the generic `{is_error:true, error:<string>}` rule (only
Antigravity produces it today). Codex, Pi, DeepSeek stay `null`. Step 3
fixtures add: OpenCode exit 0 -> null; exit 1 + output -> text; Antigravity
`{is_error:true,error}` -> text; Pi/DeepSeek `{is_error:true}` -> null.

## Plan revision 2 — Codex failure signal (2026-10-07)

**Explicit scope extension:** Phase 53 only, Codex only, authorized by the
maintainer's gap investigation request. Revision 1's Codex `null` decision
is superseded for structured rollout command completions; hook text remains
`null`. No new phase, hook event, hook configuration change, or ingestion
route is needed.

Investigation, in the requested order (counts/structure only):

1. **Hooks — none.** `npx ctx7@latest library codex`, then
   `npx ctx7@latest docs /openai/codex 'hooks PostToolUseFailure failure event tool_response exit_code rollout exec_command_end persistence'`.
   Three invocations total: first library lookup failed with `ENOTFOUND` under restricted
   networking; retry and docs lookup succeeded with network access.
   Context7 and [hook schema](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/schema.rs)
   / [hook configuration](https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs)
   enumerate no `PostToolUseFailure` or other command-failure hook.
   `PostToolUseCommandInput.tool_response` is `Value`, with no top-level
   exit/error field. Read-only real DB query: all 3,846 Codex shell hooks
   have text `tool_response`; key/type counts show no exit/error field.
   `CODEX_HOOK_EVENTS` remains its existing seven events. **Decision: none
   from hooks**; no free-text parsing.
2. **Rollouts — signal exists.** Counts-only JSON traversal of 24
   `~/.codex/sessions/2026/10/*/rollout-*.jsonl` files: first snapshot 3,252
   records, no malformed JSON, no `exec_command_end` records. Instead,
   212 `event_msg` / `item_completed` records contain integer
   `payload.item.exit_code` and string `payload.item.aggregated_output`:
   194 zero, 18 non-zero. A follow-up structural query identifies their
   item variant as `CommandExecution` (213 items as active files grew).
   No command output, command arguments, or conversation content printed.
   Read-only DB structural queries confirm 3,787 such already-ingested
   transcript records: 3,532 zero, 255 non-zero, all integer exit / text output.
   [CommandExecutionItem schema](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/items.rs)
   types `exit_code` as optional `i32` and `aggregated_output` as optional
   string. [Rollout persistence policy](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/policy.rs)
   persists completion items in paginated history (output may be truncated),
   while `ExecCommandEnd` is transient. Legacy history does not persist
   `CommandExecution` items. **Decision: wire the observed completion
   item**, not the transient event or textual function-call results.
3. **Implementation amendment to step 3:** `detectorTextFor` accepts a
   Codex rollout record and returns `aggregated_output` only for
   `event_msg` → `item_completed` → `CommandExecution`, with integer
   `exit_code != 0` and string output. Successful, missing/malformed exit,
   absent/non-string output, other item types and hook text return `null`.
   The existing transcript listener supplies the adapter from its frozen
   session context, parses JSON fail-open, and calls the existing detector
   persistence function. Transcript data cannot supply its own adapter.
   No historical replay, no PTY/ANSI parsing, no state changes. Add failure,
   success and malformed/prose fixtures, update matrix wording within the
   cap, TESTING item 48 and PROGRESS. Existing listeners retain cleanup.

**Limitations / acceptance:** rebuilt-app Codex failure/success checks are
pending (TESTING item 48). Older/legacy rollouts lacking structured fields
remain invisible. Output omitted or truncated upstream reduces recall.
**Verification:** `npm run detectors:check`, `npm run opencode:check`,
`npm run check`, `npx tsc --noEmit`, `npm run build`,
`cargo test --lib` (162 passed, 1 existing live-session test ignored),
`cargo clippy --all-targets -- -D warnings`, and `git diff --check` passed.
Focused tsx check initially hit sandbox IPC `EPERM`; Rust initially had
three local-server tests fail on sandbox sockets. Both passed with the
needed execution permission. Build retains the >500 kB chunk warning.
Golden not run: extraction prompts unchanged. Phase 53 acceptance pending.

## Behavior

- **Claude:** register `PostToolUseFailure` with matcher `Bash`. Run
  detectors on its `error` string; skip `is_interrupt: true` (an abort, not
  a tool-reported failure).
- **Stop scanning successful command output** (`PostToolUse`) for every
  adapter. Precision over recall, the same rule as decision extraction: a
  failure piped through `| tail` (exit 0) is no longer caught; accepted.
- **Adapters with no structured failure signal produce no detected rows.**
  Step 1 checks each one; any that has a cheap structured signal (an exit
  code or error flag *plus* output text in the payload) gets wired the same
  way, otherwise none. No parsing of free-text output for exit codes.
- **Existing installs:** `hooks_status` distinguishes complete from partial
  (ours present but missing an event in `HOOK_EVENTS`). Partial shows
  **Update** on the existing Claude hooks control; one click re-runs the
  existing idempotent setup (strip ours, re-add all). Never silent:
  `~/.claude/settings.json` changes only through the app's own toggle path.
  `strip_ours` iterates `HOOK_EVENTS`, so removal stays byte-reversible.
- `PostToolUseFailure` does **not** change tab state (`stateForHook` keeps
  returning null for it). An "error" dot on every failed command would be
  its own noise problem; parked.
- Existing detected rows untouched; "clear detected" per project if wanted.
- Fix `detectors.ts`'s stale header comment.

## Invariants

- #1: `PostToolUseFailure` is a documented hook (structured protocol). The
  `error` string is matched by the same detector regexes as before; nothing
  from the PTY.
- #2: hook command unchanged (`exit 0`, 2 s curl timeout).
- #3/#5: no panel logic or extraction change.
- Global config: settings.json touched only via the app's toggle code path
  (CLAUDE.md exception), byte-reversible, Rust round-trip tests.

## Steps (each with its check)

1. **Failure-signal audit.** Codex, OpenCode, Pi, Antigravity: current docs
   (Context7) plus counts-only payload-structure queries. Record a table in
   this plan (adapter → failure signal → wire / none) before code.
   *Check: table present; no content dumped.*
2. **Rust hook registration.** Add `PostToolUseFailure` (matcher `Bash`) to
   `HOOK_EVENTS`/`apply_setup`; `hooks_status` reports complete / partial /
   absent. *Check: `cargo test --lib`: setup→remove byte-identical with the
   new event; user-owned hooks preserved; partial install (old 5-event set)
   reports partial; setup on partial yields exactly one of ours per event;
   clippy clean.*
3. **Ingestion.** Pure `detectorTextFor(payload): string | null` in
   `src/lib/detectors.ts` (Claude failure `error` → text; interrupt → null;
   any `PostToolUse` → null; any step-1 adapter per its signal). `App.tsx`
   calls it for `PostToolUse` and `PostToolUseFailure`. *Check: new
   `detectors:check` fixtures: success Bash whose stdout is `detectors.ts`
   source → null; failure `Exit code 1\nError: listen EADDRINUSE` → text and
   "Port in use"; `is_interrupt` → null; Codex text response → null;
   DeepSeek `{is_error}` → null; `run_command` → null.*
4. **Update control.** Claude hooks control (AgentStatusBar / Setup) shows
   Update for partial. *Check: tsc; `onboarding:check` still green; live.*
5. **Docs.** `detectors.ts` header; AGENTS.md matrix wording within the
   4,096-byte cap (~84 bytes headroom: replace, don't append); README
   Blockers row; TESTING.md section; PROGRESS entry.
6. **Gates.** `tsc --noEmit`, `npm run check`, `npm run build`,
   `cargo test --lib`, clippy, `git diff --check`. Golden not run (no
   extraction prompt change).

## Live checks (maintainer, rebuilt app)

- Claude hooks control shows Update; click it; `~/.claude/settings.json`
  gains one `PostToolUseFailure` entry (matcher `Bash`) and nothing else
  changes (diff it).
- Claude tab: `node -e "require('nope')"` → a `Missing file/module` row
  in Detected. `grep -n "rate limit" src/lib/detectors.ts` → no row.
  `ls /definitely-missing` → per decision 2.
- Codex tab: a failing command with a matching error → a Detected row from
  structured rollout completion; success reading detector source → no row
  (TESTING item 48). Legacy rollouts without completion fields stay invisible.
- Hooks off → settings.json byte-identical to before setup. On again → one
  entry per event.
- Detected rows/day over the next week vs the ~7/day baseline (counts only).

## Decisions (confirm or change at approval)

1. **Failure-only scanning for every adapter**; no structured failure
   signal → no detected rows (recommended).
2. **Drop "No such file or directory" from Missing file/module.** Keep
   `command not found`, `Cannot find module`, `ModuleNotFoundError`.
   Recommended: on a failed command it is still mostly agents probing paths
   (`ls`, `cat` of a guessed file).
3. **Matcher `Bash` only** for `PostToolUseFailure` (recommended: fewer
   events; widen when something needs other tools' failures).
4. **Update prompt** for existing installs (recommended; silent upgrade is
   not allowed without a click).
5. **No tab-state change** from `PostToolUseFailure` (recommended; park an
   error dot).

## Out of scope

- **Stable card IDs** (GPT priority #4). Its own trigger ("when testing
  linked phase cards") hasn't fired; board ↔ phase sync was dropped in Plan
  052. Add IDs with the first feature that references a card by identity
  (agent-reported blockers linked to work, spec-file plan view, templates).
- Parsing free-text tool output for exit codes (Codex, Antigravity).
- Error tab state from failures; Accomplished rows for failed commands.
- Deleting or rewriting existing detected rows.
- Agent-reported blockers (post-trial, Plan 052 follow-on).
- Downloadable beta (Plan 034, next after this per the 2026-10-07 order).
