# OpenCode Implementation Plans

> **Executor instructions**: This file contains eight ordered implementation
> plans for Logic Loop's OpenCode integration, reviewed and verified against
> live code on 2026-09-06 at commit `340e71c`. Read the complete plan before
> editing. Run every verification command and confirm the expected result
> before moving to the next step.
>
> **Drift check (run first)**:
> `git diff --stat 340e71c..HEAD -- src-tauri/src/opencode.rs src-tauri/src/ingest.rs src-tauri/src/pty.rs src-tauri/src/lib.rs src/lib/ingest.ts src/lib/decisions.ts src/lib/repo.ts src/lib/delta.ts src/lib/loop.ts src/App.tsx src/types.ts src/components/AgentStatusBar.tsx scripts/ docs/TESTING.md docs/ROADMAP.md`
> If any in-scope file changed since this plan was written, compare the
> current-state excerpts below with the live code. A mismatch is a STOP
> condition.
>
> **Source review**: an external review (OpenCode adapter pass, dated
> 2026-09-06, companion to the Codex and Antigravity reviews) found one
> high-impact functional gap (no transcript ingestion, so the Decision
> Tracker / loop digest are dead for OpenCode sessions), two medium
> correctness gaps (no agent identity marker; tool-error detection broken),
> and five smaller items. The plans below are ordered by leverage. All event
> names and hook-wire shapes were confirmed against the OpenCode plugin docs
> (`https://dev.opencode.ai/docs/plugins/`) and the `@opencode-ai/plugin`
> type declarations captured from the `anomalyco/opencode` repo at tag
> `47f33329` on 2026-09-06. Where a payload field's exact shape is not yet
> confirmed against a **live** OpenCode run, the plan says so and gates the
> code on that verification — do not skip it.

## Shared repository context

Logic Loop is a Tauri v2 macOS-first terminal application. Rust owns PTY
creation and the localhost ingest server; React/TypeScript owns tab state and
SQL-backed panels. The app observes structured agent hooks and never parses
ANSI terminal output for meaning (invariant #1). Hook commands must fail
open: a broken, slow, or unreachable ingest server must never block OpenCode
or affect terminal use (invariant #2).

This adapter is architecturally unique among the four:

- **In-process plugin, not a shell hook.** Claude/Codex/Antigravity are all
  wired through `ingest::hook_command()`'s `sh -c` curl one-liner, which
  reads `~/.context-terminal/ingest.env` fresh on every event. OpenCode's
  plugin is a Node ESM module loaded in-process by OpenCode itself; it reads
  `ingest.env` once and caches the result, and POSTs with `fetch` + a 2s
  AbortController timeout. This means "fail open" for OpenCode is the
  plugin's own try/catch + fire-and-forget design, not a detached curl.
  Respect that: an accidental `await` inside a plugin hook is a real stall
  risk, not just a lost event.
- **No transcript file to tail.** Claude writes JSONL under
  `~/.claude/projects/` and the ingest server's `ensure_tailer()`
  (`ingest.rs:158`) tails it; the server's gate is `is_claude_transcript_path()`
  (`ingest.rs:143-145`), which is Claude-exclusive by deliberate Phase 10
  decision. OpenCode has no flat transcript file, so the whole
  `textFromTranscriptLine` → `onTranscript` → `onStop` → `extract` pipeline
  (decisions.ts) is unreachable for OpenCode sessions — finding 001.
- **Global config is `~/.config/opencode/opencode.json`** (XDG-resolved:
  `$XDG_CONFIG_HOME` on every platform, including Windows — no per-OS
  branch, `opencode.rs:20-25`). The plugin entry is injected into the
  `"plugin"` array as a `file://` URL to `~/.context-terminal/logic-loop-opencode-plugin.mjs`.
  OpenCode also auto-loads files dropped in `~/.config/opencode/plugins/`,
  but the plan files keep the `"plugin"` array injection because it's the
  path the existing `is_ours`/`strip_ours` idempotency machinery already
  covers.
- **Adapter identity is currently absent.** `RECOGNIZED_AGENTS`
  (`ingest.rs:273`) is `["codex"]` only. The OpenCode plugin sends no
  `X-Logic-Loop-Agent` header (it's the only adapter that has its own POST
  code path, so it can't inherit the header from `hook_command_with_agent`).
  `recognized_agent` (`ingest.rs:278-280`) silently drops unrecognized
  values, so today OpenCode events persist with no `agent` field at all —
  statistically indistinguishable from Claude rows.

The relevant repository verification commands are:

| Purpose | Command | Expected result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Exit 0 with no errors |
| Rust tests | `cd src-tauri && cargo test --lib` | All tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Exit 0 with no warnings |
| TypeScript checks | `npm run check` | Every check script passes |
| Golden set | `npm run golden` | 12/12 passing (extraction prompts untouched by these plans) |
| Diff hygiene | `git diff --check` | No whitespace errors |

Match the idempotent adapter tests in `src-tauri/src/opencode.rs:268-327`
and the pure state-machine tests in `scripts/epoch-check.ts` and
`scripts/bind-check.ts`.

## OpenCode event surface (the wire shapes this adapter translates)

OpenCode plugin hooks available (`@opencode-ai/plugin`, confirmed against the
live type declarations 2026-09-06):

| OpenCode hook | Input (relevant fields) | Output | Used today |
|---|---|---|---|
| `event` | `event.type` ∈ `session.created`, `session.idle`, `permission.asked`, `session.error`, `session.status`, `session.updated`, `session.diff`, `session.compacted`, `session.deleted`, `tool.execute.after`(as event), `file.edited`, … | — | `EVENT_MAP` subset only |
| `chat.message` | `{ sessionID, agent?, model?, messageID?, variant? }` | `{ message: UserMessage, parts: Part[] }` | sessionID only |
| `tool.execute.after` | `{ tool, sessionID, callID, args }` | `{ title: string, output: string, metadata: any }` | wrapped whole → `tool_response` |
| `tool.execute.before` | `{ tool, sessionID, callID }` | `{ args }` (can mutate) | not registered |
| `permission.ask` | `Permission` | `{ status: "ask"\|"deny"\|"allow" }` | not registered ([Pre* latency rule] — see risk notes in 005) |

The plugin's `sessionIdOf()` (`opencode.rs:77-79`) probes
`props.sessionID` → `props.info.sessionID` → `props.info.id` →
`props.session.id` because OpenCode's docs list event *names* but not a
locked payload schema for the generic `event` stream. That defensive probe
must stay; a wrong guess yields a dropped event, never a malformed row.

## Executor rules specific to this adapter

1. **Never block the agent loop.** Every change to the plugin keeps the
   fire-and-forget shape: `post()` returns without awaiting `fetch`, every
   handler is wrapped in try/catch, and a translation failure must not throw
   into OpenCode. A plugin hook that `await`s I/O on the critical path is a
   regression, not an improvement.
2. **The plugin is a string literal in Rust** (`opencode.rs:53-158`, produced
   by `plugin_source()`). Any plugin-side change means editing that string
   AND updating the `plugin_source_embeds_the_version_and_ingest_contract`
   test (`opencode.rs:320-326`) if the contract surface it asserts on
   changes. Bump `OPENCODE_PLUGIN_VERSION` (`opencode.rs:11`) when the
   translated payload shape changes in a way a reader must know about.
3. **`post()` re-reads `ingest.env` only at module init** today
   (`loadIngestEnv()` at `opencode.rs:63-75`). Plans that depend on the
   server being present at session start must move the load inside `post()`
   (finding 004) or accept the follow-up.
4. **`stateForHook` branch points** (`src/lib/ingest.ts:227-256`) are the
   single place OpenCode events become `AgentState`. All state-mapping changes
   in these plans must route through it, and `epoch-check.ts` must gain a case
   per new terminal event.
5. **Hook payload versioning**: the plugin sets `X-Logic-Loop-Hook` to
   `String(VERSION)` (currently 1). The ingest server records it
   (`ingest.rs:122-125`) but nothing branches on it yet. A payload shape
   change that existing readers would mis-read must bump the version.

---

# Plan 001: OpenCode transcript ingestion (decision extraction, loop digest, landing notes)

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (but see 002 — batch them, the transcript payload rides the same POSTs)
- **Category**: feature / correctness
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

Today an OpenCode session posts events, binds a tab, and drives the
state dot — but the new-claude-shaped features that feed on transcripts are
silently empty: the Decision Tracker never opens a card, Stop never enqueues
an extraction (`decisions.ts:onStop`), the loop digest
(`loop.ts:groupIterations` reads `transcript` rows) never sees text, and the
landing-note draft has no material. The product's flagship panel is a no-op
for the second supported agent. OpenCode's hooks expose the message content —
it's a wiring gap, not an upstream limitation.

## Current state

- `src-tauri/src/opencode.rs:130-136` — `chat.message` handler drops
  everything but `sessionID`:
  ```js
  "chat.message": async (input) => {
    try {
      if (!input?.sessionID) return;
      post({ hook_event_name: "UserPromptSubmit", session_id: input.sessionID, cwd: directory });
    } catch { /* fail open */ }
  },
  ```
- `src-tauri/src/ingest.rs:143-145` — tailer gate:
  ```rust
  fn is_claude_transcript_path(path: &str) -> bool {
      path.contains("/.claude/projects/")
  }
  ```
- `src/lib/decisions.ts:62-80` — `onTranscript` only accepts lines that parse
  as Claude JSONL (`textFromTranscriptLine` reads `obj.type` +
  `obj.message.content` arrays with `type === "text"` blocks).
- `src/lib/loop.ts:100-105` — `transcript` rows feed `firstAssistantText` /
  `lastAssistantText` for noop detection.
- `src/lib/ingest.ts:73-77` — `onTranscriptLine` listener currently carries
  `{ session_id, line }` where `line` is a raw Claude JSONL string.

## Design: a second wire shape for transcript content

OpenCode has no tailable file, so transcript rows must arrive **over the same
HTTP POSTs** the adapter already sends. The plugin will attach message
content to its existing `chat.message` and (new) `message.updated`
handlers, and the ingest server/frontend will translate it into the existing
`transcript` event shape. This is a deliberate new ingestion primitive:
`transcript` rows currently come exclusively from the file tailer; this plan
adds a hook-carried path. Both carry `{ session_id, line }` where `line` is a
JSON string that `textFromTranscriptLine` can parse.

### Step 1 (gate): confirm the live message shapes

Before writing any code, capture real payloads from a live OpenCode run
(start one with the adapter installed, ask it to edit a file, read
`~/.config/opencode/opencode.json` to confirm the plugin is loaded). Log the
raw `chat.message` input/output and `message.updated` input for a few turns.
Confirm at minimum:

- `chat.message` output `.message.content` shape — is it an array of parts
  (`{ type: "text", text }` etc.) or a combined string? OpenCode's `Part[]`
  types show text parts as `{ type: "text", text, ... }`.
- For assistant-side content: does `message.updated` fire per assistant
  message, and does its output expose the assembled `parts`? If it does not
  fire per message, STOP and report back before proceeding — the
  assistant-side transcript needs that hook, and improvising on a missing
  hook violates this repo's invariant #1/no-guessing rules.
- Whether `chat.message` fires only for the user message at turn start (docs
  say "Called when a new message is received"), or also for the assistant
  reply. The user-side mapping (below) assumes user-only; if it fires for
  both, dedupe by `input.messageID`.

**Escape hatch**: if `message.updated` cannot deliver assistant text
reliably, do not fake it from tool events or model prose (invariant #1 and
#5). Defer the assistant half; land the user-side transcript (decisions turn
pairs need the *user* reply plus the assistant text, and the user reply alone
plus a `Stop`-paired empty assistant is a degraded but honest extraction).

### Step 2: plugin-side translation

In `plugin_source()` (`opencode.rs:53-158`), give `chat.message` a second
responsibility:

```js
"chat.message": async (input, output) => {
  try {
    if (!input?.sessionID) return;
    post({ hook_event_name: "UserPromptSubmit", session_id: input.sessionID, cwd: directory });
    const text = textOf(output?.message?.content);
    if (text) post({ hook_event_name: "UserPromptSubmit", session_id: input.sessionID, cwd: directory,
                    _transcript: true, transcriptish: { role: "user", text, ts: Date.now() } });
    // _transcript is a private marker; the ingest server converts it to a
    // transcript emit before the row persists. Not persisted as _transcript itself.
  } catch { /* fail open */ }
},
```

where `textOf()` collapses `message.content` — string or parts array — into a
single text string, mirroring `textFromTranscriptLine`'s Claude behavior
(`src/lib/decisions.ts:11-36`). Register a new `message.updated` handler with
the same shape but `role: "assistant"`, bounded to message types that carry
text (skip `tool` parts, `reasoning` parts, etc.).

**Plugin-structure note**: the object returned by `LogicLoopAdapter` is a
flat hook map (`event`, `chat.message`, `tool.execute.after`). Adding
`message.updated` means adding a fourth key. Keep the map flat — don't refactor
to a class; the executor's job is additive.

Bump `OPENCODE_PLUGIN_VERSION` to 2 (`opencode.rs:11`) — the payload now
carries a new field existing readers could not have known about.

### Step 3: ingest-server conversion (not persisted directly)

The OpenCode plugin sends `_transcript` as an in-band marker so it stays on
the same authenticated POST path (no new endpoint, no new token surface).
In `ingest.rs`'s handler (`ingest.rs:100-131`), before the generic `emit`:

- If the parsed payload has `_transcript === true`, extract `transcriptish`,
  rename it to the transcript emit shape, and **emit a `ingest://transcript`
  event instead of `ingest://hook`** — the frontend `onTranscript` pipeline
  (decisions.ts) only listens on the transcript channel. Do NOT write it to
  the `events` table via `addEvent` — the transcript channel is
  frontend-only today; routing it through `addEvent` would need `dedupeKey`
  changes (the key is transcript-line-shaped already, but the row type
  `transcript` is produced by the frontend's `repo.addEvent` in App.tsx's
  `onTranscriptLine` — keep a single producer, see the landmine note in
  CLAUDE.md about never adding a second `events` insert site).
- The emitted payload must be exactly what `onTranscriptLine` expects:
  `{ session_id, line }` where `line` is a JSON string with `type` + `text`
  (and no `message` wrapper) — the frontend then runs
  `textFromTranscriptLine(line)` which handles both Claude's
  `{ type, message: { content } }` and OpenCode's flattenable
  `{ type, text }`.
- Do NOT relax `is_claude_transcript_path` to ingest OpenCode files. OpenCode
  has no flat transcript; the gate's Phase 10 purpose (stop tailing Codex
  rollouts) stays intact.

### Step 4: frontend flush on Stop (unchanged code path)

The existing `onStop` in `decisions.ts:84-90` already fires 2s after a
`Stop` and flushes buffered assistant text. Because OpenCode's `Stop` is
mapped from `session.idle` (`opencode.rs:83`), no frontend change is needed
for the turn-close: the buffered pairs flush exactly as Claude's do. Verify
in the live session that the 2s delay is long enough for the trailing
`message.updated` POST to land (the tailer equivalent; if the plugin's
assistant text races Stop, bump `onStop`'s delay for OpenCode only via the
`agent` field from 002).

### Step 5: tests

- Rust (`opencode.rs` tests): plugin source contains `_transcript`,
  `message.updated`, and role markers; version bumped to 2.
- `ingest.rs`: a unit test for the `_transcript` payload → transcript emit
  branch, kept pure by extracting the branch into a testable function
  (e.g. `fn transcript_payload(payload: &serde_json::Value) -> Option<serde_json::Value>`).
- `scripts/`: extend `epoch-check.ts` (or add `opencode:check`) with a case
  that a `UserPromptSubmit_with_transcript` + `Stop` produces a
  buffered-pair flush — assert the `onTranscript` → `onStop` handoff
  fires for an OpenCode-shaped transcript line.

## Done criteria

- Live OpenCode session (manual test, TESTING.md §27 candidate): user asks a
  question with an explicit fork ("should I do A or B?"); the Decisions panel
  opens a card for it; the loop digest shows assistant text.
- `npm run check`, `npx tsc --noEmit`, `cargo test --lib`, clippy all clean.
- No new `// panic`, no new `expect()` in plugin or server code.

---

# Plan 002: Carry OpenCode adapter identity through ingestion

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (prerequisite for 003's agent-scoped flush tuning and any future agent-specific behavior)
- **Category**: correctness / tech-debt
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

Every OpenCode event persists with no `agent` field (the allowlist
`RECOGNIZED_AGENTS = ["codex"]` at `ingest.rs:273` drops the unrecognized
header), making them indistinguishable from Claude rows. Plan 001's assistant
flush tuning (if needed) and any future agent-specific panel behavior are
blocked on a reliable discriminator. This mirrors Codex Plan 001 which
shipped in Phase 16.

## Changes

1. `src-tauri/src/ingest.rs:273` — extend the allowlist:
   ```rust
   const RECOGNIZED_AGENTS: [&str; 2] = ["codex", "opencode"];
   ```
   Update the unit test `recognized_agent_accepts_only_the_allowlist`
   (`ingest.rs:449-454`) to assert `recognized_agent(Some("opencode")) ==
   Some("opencode")`. Unknown values must still return `None` (the negative
   tests already pin that).
2. `src-tauri/src/opencode.rs` plugin source — add the header to `post()`:
   ```js
   "X-Logic-Loop-Agent": "opencode",
   ```
   alongside the existing `X-Logic-Loop-Tab` / `X-Logic-Loop-Hook` headers
   (`opencode.rs:102-107`). This is a Rust-selected fixed constant, never
   adapter-controlled input — same rule as the Codex marker.
3. `plugin_source` test (`opencode.rs:320-326`) — assert the source contains
   `X-Logic-Loop-Agent: opencode`.

No frontend change: `stateForHook` doesn't branch on `agent`, and
`hook_command()` (the curl path) is untouched — this only affects the
OpenCode POST code path.

## Done criteria

- A live OpenCode event lands in `events` with `payload_json` containing
  `"agent": "opencode"` (inspect via sqlite during the manual test).
- `cargo test --lib`, clippy, `npm run check` all clean.

---

# Plan 003: Normalize tool responses so OpenCode tool errors read as failures

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (depends on live verification of OpenCode's error signal — see below)
- **Depends on**: 002 (so any agent-scoped adjustment keys on `agent`)
- **Category**: correctness
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

The tab state dot never shows "error" for a failed OpenCode tool call.
`stateForHook` (`ingest.ts:236-239`) only reads
`tool_response.is_error === true`, but the plugin wraps OpenCode's raw
`output` object — `{ title, output, metadata }`, which has no top-level
`is_error` — into `tool_response` at `opencode.rs:141-147`. So every OpenCode
tool call reads as a clean "working" → "idle" transition regardless of
failure. The Accomplished panel and loop-digest error counts
(`loop.ts:96-99`) carry the same blind spot.

## Step 1 (gate): confirm whether OpenCode exposes a failure signal

The docs type the `tool.execute.after` output as
`{ title: string, output: string, metadata: any }` — no obvious error
field — but `metadata` is untyped and may carry one. Live-verify: run a
failing tool (a bash command that exits non-zero) and a success, log the raw
`output`. Record what distinguishes them.

## Step 2: normalization in the plugin (not the frontend)

Whatever the answer, the plugin should stop passing raw `output`:
- If a failure signal exists in `output.metadata` (e.g. `metadata.isError` /
  an error key), map it:
  ```js
  tool_response: { is_error: !!meta?.isError, output: output.output, meta: output.metadata }
  ```
- If no signal exists, send an explicit non-error default so the read is
  decided, not guessed:
  ```js
  tool_response: { is_error: false, output: output.output }
  ```
This keeps intelligence in the ingestion layer (invariant #3) and mirrors the
Antigravity handling (`antigravity.rs:174-207`) where a genuinely
unobservable failure is pinned as a known limit, not hacked around. If the
signal is genuinely absent, add a comment exactly like `antigravity.rs`'s —
"do not fix this by parsing tool output text" — and a unit test pinning the
negative.

## Step 3: tests

`epoch-check.ts` (or `opencode:check`) — a `PostToolUse` with
`tool_response.is_error === true` transitions to `error`; with `false` to
`working`. Update `opencode.rs`'s `plugin_source` contract test if the emitted
shape changed.

## Done criteria

- A failing OpenCode bash command turns the tab dot red; a success stays
  working→idle.
- Loop digest logs `(N failed)` for a covering run.
- All verification commands clean.

---

# Plan 004: Re-load ingest.env per POST so a restarted app reconnects automatically

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: reliability
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

`loadIngestEnv()` runs once, at module init, and `post()` returns
immediately when it returns null (`opencode.rs:88,96`). If the ingest server
isn't up when OpenCode launches (Logic Loop not yet running, or running but
mid-restart), every event for that OpenCode process is dropped forever —
even after Logic Loop comes back. Claude's curl hooks re-read `ingest.env`
per event and recover on the next hook; OpenCode's single read does not.

## Changes

1. Move the `loadIngestEnv()` call inside `post()` (rename to reflect it's
   per-post): at `opencode.rs:88` remove the module-init load; at `opencode.rs:96`
   load fresh. Cost is one small file read per event — negligible against the
   2s abort timeout already budgeted.
2. Keep the 2s `AbortController` timeout — a *pending* fetch to a cold port
   must still not outlive the event.
3. Comment: this is the in-process-curl equivalent of `hook_command()`'s
   per-invocation `. $HOME/.context-terminal/ingest.env`.

## Done criteria

- Start OpenCode with the ingest server down, then start Logic Loop; the next
  OpenCode event lands in the DB without restarting OpenCode (manual test).
- `cargo test --lib`, clippy clean.

---

# Plan 005: Map session.error to the Error tab state

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

OpenCode emits `session.error` on session failure. `EVENT_MAP`
(`opencode.rs:81-85`) doesn't list it, so the event is silently dropped and
the tab never shows a failure — the same visibility gap Plan 003 fixes for
tool failures, at the session level.

## Changes

1. `opencode.rs:81-85` — add `"session.error": "Error"` to `EVENT_MAP`.
2. `ingest.ts:227-256` — add an `"Error"` case to `stateForHook`:
   ```ts
   case "Error":
     stoppedSessions.add(p.session_id);
     return "error";
   ```
   (session errors close the epoch, so a late PostToolUse from a doomed
   session can't re-green the tab — same reasoning as the Plan 003 mapping.)
3. `ingest.rs:282` — add `"Error"` to `HOOK_EVENTS` if the server's
   `strip_ours`/`apply_setup` machinery should ever manage it; today it's
   only used for Claude settings, so this is optional — add it only if a test
   asserts it.
4. `epoch-check.ts` — case: `Error` event transitions to `error` and a
   following `PostToolUse` stays suppressed.

## Done criteria

- A live session aborted by Ctrl+C / crash shows the red dot.
- `npm run check` clean.

---

# Plan 006: Extract the plugin to a real file instead of a Rust string literal

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (touches the most-tested surface; drift risk only)
- **Depends on**: none
- **Category**: DX / maintainability
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

`plugin_source()` at `opencode.rs:53-158` is a `format!()` string with all
braces doubled. No syntax highlighting, no linter, no type-check against
`@opencode-ai/plugin`, and every plugin change forces a full Rust rebuild
plus `cargo test`. The other three adapters are wire configs (short strings /
hooks.json entries); OpenCode is the only one whose whole runtime is embedded.

## Design

1. Create `src-tauri/resources/logic-loop-opencode-plugin.mjs` — a real,
   plain `.mjs` file with the *current* plugin body (the `VERSION` const stays,
   bumped per normal process). The `version N` banner stays.
2. `opencode.rs` — replace `plugin_source()`'s body with a read of that file at
   runtime:
   ```rust
   const PLUGIN_RESOURCE: &str =
       include_str!("../resources/logic-loop-opencode-plugin.mjs");
   fn plugin_source() -> String { PLUGIN_RESOURCE.to_string() }
   ```
   Since the plugin has no `{number}` substitutions left (VERSION is a const
   inside the file), no `format!` is needed — the file is byte-identical to
   what ships. This is the biggest win: the shipped artifact matches the
   source file exactly, no escape-stage.
3. `include_str!` keeps the resource inside the binary, so there is no runtime
   file dependency and no tauri.conf.json `resources` entry needed — matches
   the repo's single-binary story.
4. Tests: `plugin_source_embeds_the_version_and_ingest_contract` stays and
   still passes (the file embeds `version {VERSION}` and the header
   constants). Add an assertion that the file parses as loadable ESM at
   **build time only** (not a unit test — no `node` dependency in tests):
   leave a comment; do not add a node-in-test dependency.

## Done criteria

- `cargo test --lib`, clippy, `npm run check` all clean.
- The shipped plugin file is byte-identical to `resources/...mjs`.
- Removing the `.mjs` from the tree breaks the Rust build loudly (via
  `include_str!`) — intent.

---

# Plan 007: Map session.status for finer-grained working/idle state

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (payload shape unconfirmed)
- **Depends on**: 002 (agent-scoped only if needed), 003 (error dot parity)
- **Category**: feature
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

The tab dot flips at the coarse session lifecycle only (created → idle);
OpenCode's `session.status` carries intermediate states (running/waiting/idle
per the TUI's own rendering) that would make the dot reflect whether the
agent is *currently* working or mid-parse — the same granularity the
`working`/`waiting` distinction gives Claude turns today (via
`session.idle` → Stop + `permission.asked` → Notification).

## Step 1 (gate): live-verify the `session.status` payload

Raw `event` payload for `type === "session.status"`. The docs do not lock the
inner shape; `sessionIdOf()` already handles the id probe. Confirm the status
field name (`status`, `state`, `data`?) and its values
(`waiting`, `input`, `connecting`, `running`, `idle`, …).

## Step 2: mapping

Extend `EVENT_MAP` handling from a static object to a small function because
the target `hook_event_name` depends on the status value:
- `running` → no new event (PostToolUse already drives working) or map to
  nothing
- an awaiting-input status → a `Notification`-equivalent so the dot can go
  amber (`waiting`)
- `idle` continues to be `Stop`
Do this in the `event` handler with the same fail-open try/catch, and gate on
the verified field/value set. If a mapping would double-fire with
`permission.asked`'s existing `Notification`, dedupe (the events table's
`dedupe_key` handles collisions, but prefer fewer rows to deduped rows).

## Done criteria

- Live session shows `waiting` (amber) when OpenCode awaits user input that
  isn't a permission.
- `epoch-check.ts` covers the new transition.
- No logic branch in the frontend — mapping stays in the plugin.

---

# Plan 008: Standalone check script + manual-test section for the adapter

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 002, 003 (the script asserts what they change)
- **Category**: DX / test coverage
- **Planned at**: commit `340e71c`, 2026-09-06

## Why this matters

The other adapters gained check scripts in their phases;
`scripts/` has no `opencode`-specific gate, so a regression in the plugin's
event shape or the server's agent allowlist isn't caught by `npm run check`.

## Changes

1. New `scripts/opencode-check.ts` (mirror `scripts/epoch-check.ts`'s pure
   quickcheck style — runnable standalone, no Tauri runtime):
   - `RECOGNIZED_AGENTS`-style pure assertions extracted into a small Rust-side
     test OR a TS mirror of the allowlist; prefer extending the existing Rust
     unit test as the single source of truth and keep the script focused on
     the plugin contract string.
   - assert the plugin source (read from `src-tauri/resources/...mjs` after
     006, or the string otherwise) contains: `X-Logic-Loop-Agent: opencode`,
     `_transcript`, `tool.execute.after`, `message.updated`;
   - assert `stateForHook` behaviors for the OpenCode event set.
2. Wire into `package.json`'s `check` aggregate (now 12 scripts —
   will be 13+).
3. `docs/TESTING.md` — add §27: live OpenCode session across the gate steps:
   adapter toggle, binary detection, fan-out child binding, decision
   extraction, tool error dot, unclaimed-result flag after idle, plumbing
   check via sqlite (`SELECT payload_json FROM events ORDER BY id DESC LIMIT 5`).

## Done criteria

- `npm run check` includes `opencode:check` and passes.
- TESTING.md §27 drafted and runnable by a human.

---

## Execution order & dependencies

| Step | Plan | Why here |
|---|---|---|
| 1 | 002 Agent marker | Prereq; unblocks agent-scoped logic everywhere, trivial |
| 2 | 001 Transcript ingestion | The flagship feature; gated on 001's step-1 live verify |
| 3 | 003 Tool error normalization | Shares 001/002's live-verification session |
| 4 | 004 ingest.env reload | Reliability; independent |
| 5 | 005 session.error | Small; independent |
| 6 | 006 Plugin to file | Do before writing more plugin string — escapes compound |
| 7 | 007 session.status | Feature; after 003's dot-parity groundwork |
| 8 | 008 Check + manual test | After the behavior lands |

Recommendation: batch live verification for 001/002/003 in **one** OpenCode
session (capture `chat.message`, `message.updated`, `tool.execute.after`
raw payloads for good and failing tools, and confirm `agent` lands in sqlite).
Then batch code for 002+001+003. Run 004-008 as convenient follow-ups.

## Findings considered and rejected

- **Assistant-side transcript via OpenCode session files.** OpenCode stores
  session state in an internal DB/storage format (not a tailable flat JSONL like
  Claude's). Replacing the tailer with an OpenCode storage reader couples the
  server to OpenCode's internal format — invariant #2 risk for zero gain over
  the hook-carried approach in 001. Rejected; hooks are the documented surface.
- **Full decision extraction from `session.diff`.** OpenCode's `session.diff`
  events carry changed-file metadata, not conversation text. Not a transcript
  source. Rejected for 001 (still a candidate for future file-focused
  Accomplished-panel enhancement).
- **`tool.execute.before` for PreToolUse-style warnings.** Its output can
  mutate `args` (blocking-capable on an input hook, same async-stall class the
  repo's [Pre* latency rule] reserves for `PreToolUse` in agy). Not needed for
  observation; rejected to keep the plugin pure-observation (invariant: the
  app never mutates agent behavior).
- **Relaxing `is_claude_transcript_path` to OpenCode paths.** There is no such
  path; doing so would widen a Phase-10-scoped gate for a tool that has no file
  to tail. Rejected.
- **Sending `notification`/`toast` TUI events.** Would need `Notification`
  payload shape verification and is decorative; not planned.