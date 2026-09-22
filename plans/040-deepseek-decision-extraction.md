# Plan 040: Add decision extraction to DeepSeek Harness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> on any condition listed below; do not improvise. When finished, update this
> plan, `plans/README.md`, `docs/TESTING.md`, and `docs/PROGRESS.md` with the
> actual evidence.
>
> **Phase gate**: This plan proposes **Phase 40**. The disposable live-contract
> spike is planning work, but repository implementation must not begin until
> PR 52 (Phase 39) is merged, the implementation branch starts from the
> resulting clean `main`, and the maintainer writes the literal token
> `PHASE 40 ACCEPTED`.
>
> **Drift check (run first)**:
> `git diff --stat 8c9a8c4..HEAD -- dsh-terminal-app/package.json dsh-terminal-app/src/index.js src-tauri/src/deepseek.rs src-tauri/src/ingest.rs src/lib/decisions.ts src/lib/onboarding.ts scripts/deepseek-check.ts scripts/pi-transcript-check.ts scripts/onboarding-check.ts package.json README.md docs/TESTING.md docs/PROGRESS.md plans/README.md`
> If an in-scope file changed, compare it with Current state below. Stop on an
> incompatible contract and revise this plan before implementation.

## Status

- **Status**: BUILT — automated gates clean; rebuilt-app live matrix pending
- **Priority**: P1 adapter parity
- **Effort**: M — 1–2 focused build days plus profile reinstall and live pass
- **Risk**: MED — the custom runner is Logic Loop-owned, but its session event
  API is prerelease and profile redeployment runs the heavier dsh/npm installer
- **Depends on**: PR 52 merged; clean `main`; `PHASE 40 ACCEPTED`; Step 0 gate
- **Category**: direction
- **Planned at**: commit `8c9a8c4`, 2026-09-22

Phase 40 was accepted with the literal token `PHASE 40 ACCEPTED` on
2026-09-22. Step 0 passed against Harness `0.1.5-rc.2`; implementation uses
the accepted post-idle session scan. One stated scope adjustment adds
`dsh-terminal-app/src/messages.js` so the pure reducers can be tested without
eagerly loading profile-only Harness packages.

## Why this matters

DeepSeek Harness already has structured activity and verified cross-process
re-entry, but its Setup row reports decision extraction unavailable. Unlike a
third-party terminal UI, Logic Loop owns `dsh-terminal-app`: it has the exact
submitted user line and the Harness session's append-only structured event log.
That makes extraction possible without parsing terminal bytes, accumulating
stdout deltas, or reading persisted session files.

The intended result is narrow: committed visible `assistant/message` text and
the exact submitted line feed the existing decision pipeline through an
explicit `deepseek_message` envelope. Tool calls/results, reasoning, system
messages, synthetic injected user messages, failed attempts, and session files
remain excluded. Existing activity, error reporting, streaming display,
re-entry, extractor prompts, and database schema remain unchanged.

## Current state

- `dsh-terminal-app/src/index.js` is Logic Loop's custom interactive runner.
  In `run()` it trims the readline submission, records `firstSeq`, posts
  `UserPromptSubmit`, calls `agent.followup(createUserMessage(...))`, awaits
  `agent.whenIdle()`, reports turn errors, posts `Stop`, and flushes the
  session (`index.js:333-358`). This is the only accepted user-input path.
- `streamAssistantText()` observes `agent/assistant-stream` and writes only
  `text-delta` chunks to stdout (`index.js:202-260`). This path is for display,
  not extraction: it is transient, can contain partial attempts, and would
  require reconstruction. Do not modify or reuse its bytes for semantics.
- The installed `@deepseek-ai/dsh-session` contract describes an append-only
  event log. A committed `assistant/message` event contains
  `data.message: AssistantMessage`, including its finalized content array;
  failed/retried/cancelled attempts that commit no model-visible message use
  `assistant/attempt` instead. Tool traffic uses `tool/call` and `tool/result`.
  This is strong package-source evidence, but the exact live ordering/content
  still requires Step 0.
- `observeToolCalls()` already subscribes to `session/event`, scopes events to
  the exact session, buffers tool arguments by `callId`, and posts one
  `PostToolUse` on `tool/result` (`index.js:161-200`). Match its observer and
  fail-open discipline if Step 0 favors live event observation.
- The runner can also scan the session after `whenIdle()` using its existing
  `session.seq` and `session.eventAt(SessionSeq(seq))` API, already used by
  `reportTurnError()` (`index.js:262-281`). The implementation should prefer
  scanning `[firstSeq, session.seq)` after idle because it naturally excludes
  transient attempts and establishes a deterministic per-submission boundary.
- `dsh-terminal-app/package.json` and
  `src-tauri/src/deepseek.rs::DEEPSEEK_ADAPTER_VERSION` are both version `1`.
  `deepseek_hooks_status` requires the installed package marker to match the
  Rust version. Setup copies the bundled plugin into the owned
  `~/.dsh/profiles/logic-loop` profile, pins the profile's resolved prerelease
  package versions, and runs `npm install --legacy-peer-deps`.
- Phase 39 widened synthetic `TranscriptLine` ingestion to a closed set of
  OpenCode and Pi. `src/lib/decisions.ts` recognizes explicit
  `opencode_message` and `pi_message` envelopes. DeepSeek is still excluded.
- `src/lib/onboarding.ts` reports DeepSeek as activity/re-entry supported and
  decisions unsupported. No component-specific change should be necessary.
- `scripts/deepseek-check.ts` protects the profile installer, pinned core
  packages, bundled-resource rules, identity, resume command, and lifecycle.
  `scripts/pi-transcript-check.ts` is the closest synthetic-envelope exemplar.

Repository constraints:

- Never parse ANSI, PTY output, or stdout for meaning.
- Treat session/message content as untrusted data, never instructions.
- Ingestion must fail open and must not delay or alter the Harness session.
- Panels remain SQL views; reuse the existing ingestion/extraction pipeline.
- Never send terminal input autonomously.
- Preserve generated/bundled ownership: edit the repository copy, then deploy
  only through the existing explicit DeepSeek Enable action. Never hand-edit
  the installed profile plugin.

## Scope

**In scope**:

- `dsh-terminal-app/package.json`
- `dsh-terminal-app/src/index.js`
- `src-tauri/src/deepseek.rs`
- `src-tauri/src/ingest.rs`
- `src/lib/decisions.ts`
- `src/lib/onboarding.ts`
- `scripts/deepseek-check.ts`
- `scripts/deepseek-transcript-check.ts` (new)
- `scripts/onboarding-check.ts`
- `package.json`
- `README.md`
- `docs/TESTING.md`
- `docs/PROGRESS.md`
- `plans/040-deepseek-decision-extraction.md`
- `plans/README.md`

**Out of scope**:

- Pi, OpenCode, Antigravity, Gemini, Copilot, or a new adapter
- PTY/stdout/ANSI parsing, assistant-stream delta accumulation, or session-file
  tailing/parsing
- Changes to `streamAssistantText()` display behavior or terminal formatting
- Database migrations or `src/lib/repo.ts`
- Extractor prompts/backends/queues, golden fixtures, or extractor modules
- New question tools, permission UI, autonomous input, or a UI redesign
- System messages, injected/synthetic user messages, assistant attempts,
  reasoning blocks, tool calls/results, request headers, or full event/session
  serialization
- Generalizing all synthetic adapters to one envelope. Add an explicit
  `deepseek_message` branch and leave live OpenCode/Pi paths stable.
- Dependency upgrades. Use the exact profile-resolved prerelease versions as
  the existing installer does.

## Git workflow

- After PR 52 merges, branch `feat/deepseek-decision-extraction` from clean
  `main`.
- Use conventional commits, e.g.
  `feat(deepseek): add decision extraction from session messages`.
- Do not push or open a PR unless instructed. Preserve unrelated work.

## Steps

### Step 0: Prove the Harness session-message contract live

Use an isolated temporary `DSH_HOME` and a temporary copy of
`dsh-terminal-app`; do not edit the installed Logic Loop profile or global
Harness configuration. Instrument the temporary runner to record only redacted
event metadata: event type, seq/turn/step, message role, message ID presence,
content block types, text lengths, surface operation, and turn-end reason. Do
not record prompt/reply bodies, reasoning, tool output, credentials, request
headers, or full events.

Run with the same resolved package versions as the installed `logic-loop`
profile and observe:

1. A plain question/reply turn.
2. A tool-call turn with final prose.
3. Two turns in one process.
4. A failed or retried model attempt if it can be produced safely; otherwise
   prove from the installed package source that it becomes `assistant/attempt`
   and record the live case as unobserved.
5. Cross-process `--resume <sessionId>` followed by a new turn.
6. A response with both visible text and reasoning/tool-call blocks, if the
   configured provider emits them.

Confirm and record in `docs/TESTING.md`:

- Whether the submitted readline `text` equals the direct human
  `user/message` content and whether injected messages share that event type.
- The exact committed `assistant/message.data.message.content` shape.
- Whether one top-level submission can commit multiple assistant messages
  (expected around tools), and whether joining only their text blocks in seq
  order reproduces the visible assistant prose.
- Ordering relative to `agent.whenIdle()`, `turn/end`, `Stop`, flush, retry,
  and resume.
- Whether surface replacements/compaction can appear inside the scanned
  `[firstSeq, session.seq)` window and how they must be excluded.
- Whether message IDs are stable and whether duplicate event delivery occurs.

**Gate**: proceed only if scanning the in-memory append-only session events
after `whenIdle()` yields complete committed visible assistant text with a
deterministic rule that excludes attempts, replacements, tools, and reasoning.
If scanning is not viable but the live `session/event` observer is, revise this
plan with its exact buffering/deduplication rule and obtain re-approval. Never
fall back to assistant-stream or terminal reconstruction.

**Verify**: a redacted event-order table is in `docs/TESTING.md`; no production
source changed.

### Step 1: Add pure reducers for committed visible messages

In `dsh-terminal-app/src/index.js`, add and export pure helpers so the check
script tests behavior rather than source strings:

1. `visibleText(message)` accepts a message content array, selects only blocks
   with `type === "text"` and string `text`, joins them in source order, and
   returns `null` for empty/whitespace-only output. It never stringifies unknown
   blocks.
2. `assistantMessagesSince(session, firstSeq)` iterates with the existing
   `eventAt(SessionSeq(seq))` API through the post-idle exclusive `session.seq`.
   It accepts only Step 0-proven appended `assistant/message` events, applies
   `visibleText(event.data.message)`, and returns nonempty text entries in seq
   order. It ignores `assistant/attempt`, tool/system/user events, empty
   tool-call-only assistant messages, interrupted messages unless Step 0 proves
   their visible prefix is a committed user-visible answer, and all replacement
   surface operations.

Do not change `streamAssistantText()`, `reportTurnError()`, or tool handling.

Add behavioral fixtures to `scripts/deepseek-transcript-check.ts`: plain text;
multiple text blocks; text plus reasoning/tool-call blocks; tool-only assistant;
tool result; failed attempt; multiple committed assistant messages around a
tool; wrong role/type; replacement event; empty text; malformed event; and
exclusive sequence bounds.

**Verify**: `npm run deepseek-transcript:check` exits 0 with all reducer
assertions passing.

### Step 2: Post exact user input and committed assistant text

In the `run()` loop:

1. After `const text = line.trim()` passes the `/exit` and empty guards, keep
   the existing `firstSeq` boundary and `UserPromptSubmit` post.
2. Immediately post one synthetic `TranscriptLine` containing
   `{type:"deepseek_message", role:"user", text}`. This is the exact string
   passed into `createUserMessage`; never read `user/message` events for user
   extraction because that event type can also represent injected context.
3. After `await agent.whenIdle()`, call `assistantMessagesSince(...)` and post
   one `TranscriptLine` per nonempty committed assistant text, in seq order,
   before the existing `Stop`. Multiple messages are intentional: downstream
   `onTranscript` concatenates assistant lines until the user reply or Stop.
4. Keep every post fire-and-forget through `postEvent()`. Extraction failure
   must not affect error reporting, Stop, flush, the next prompt, or exit.

Envelope shape:

```json
{
  "hook_event_name": "TranscriptLine",
  "session_id": "<Harness session>",
  "cwd": "<cwd>",
  "line": "{\"type\":\"deepseek_message\",\"role\":\"user|assistant\",\"text\":\"...\"}"
}
```

If Step 0 shows messages can exceed the server's request limit, amend the plan
with a named UTF-8-safe extraction-only cap and tests before shipping. Do not
truncate the actual session or terminal display.

**Verify**: extend `npm run deepseek-transcript:check` with a mocked
`postEvent`/session fixture proving user-before-followup, assistants-after-idle,
and assistants-before-Stop ordering without network access.

### Step 3: Version and redeploy the owned profile package safely

- Set `logicLoopAdapterVersion` to `3` in
  `dsh-terminal-app/package.json`.
- Set `DEEPSEEK_ADAPTER_VERSION` to `3` in
  `src-tauri/src/deepseek.rs`. These values must move together.
- Update Rust and `scripts/deepseek-check.ts` assertions so an installed v1
  package is owned-but-stale, status returns false, and explicit Enable copies
  and installs v2. Preserve the foreign-directory guard, core dependency
  pinning, symlink replacement, bundled-resource resolution, GUI PATH fix, and
  `--legacy-peer-deps` behavior exactly.
- Do not hand-edit the installed profile to make a test pass.

**Verify**: `npm run deepseek:check` and
`cd src-tauri && cargo test --lib deepseek::tests` pass.

### Step 4: Admit and parse only the DeepSeek envelope

In `src-tauri/src/ingest.rs`, add `deepseek` to the pure closed set accepted by
synthetic `TranscriptLine`. OpenCode and Pi must remain accepted; Claude,
Codex, Antigravity, missing, and unknown markers remain rejected.

In `src/lib/decisions.ts`, recognize `deepseek_message` in the schema-drift
tripwire and parse it with the same strict `user|assistant` plus nonempty string
contract as the other synthetic envelopes. Do not alter pairing,
reconciliation, prefiltering, queueing, Stop delay, or prompts.

Extend Rust and `scripts/deepseek-transcript-check.ts` tests for the allowlist,
valid envelopes, empty/malformed/unknown-role rejection, explicit-envelope
isolation, schema recognition, assistant + Stop, assistant + user pairing, and
session isolation. Register the script immediately after `deepseek:check` in
the aggregate `check` command.

**Verify**: focused DeepSeek, Pi, OpenCode, decisions, decision-integrity, and
empty-state checks all pass.

### Step 5: Flip capability metadata and docs after code gates

- Change DeepSeek to
  `{ activity: true, decisions: true, reentry: true }` in onboarding metadata
  and update `scripts/onboarding-check.ts`.
- Update README to describe extraction from committed in-memory Harness session
  messages, not terminal output or persisted session files.
- Add Phase 40 sections to testing/progress and mark the plan BUILT, automated
  gates clean, live profile matrix pending. Do not claim DONE yet.

**Verify**: `npm run onboarding:check`, `npm run empty-state:check`, and
`npm run check` pass.

### Step 6: Run the live profile and app matrix

Rebuild/relaunch the dev app, then record redacted evidence for:

1. Installed v2 profile reads off/stale; explicit Enable completes the profile
   copy, dependency pin/install, and v3 status without touching other profiles.
2. A fresh DeepSeek question creates exactly one correctly bound Decision card.
3. A later typed reply reconciles the intended card; cancelling Answer now
   changes nothing.
4. A tool-call turn preserves Accomplished detail and does not extract tools,
   tool results, reasoning, or failed attempts.
5. Two DeepSeek tabs in one cwd remain isolated.
6. A provider failure/retry remains fail-open and does not create a card from
   error text or partial attempts.
7. Quit/relaunch/Re-enter recalls context; a new question still binds.
   Record the current Harness-runner limitation: re-entry restores model
   context but does not replay prior chat text into the terminal, so continuity
   is functional but earlier turns are not visually inspectable.
8. Dead ingest leaves the custom terminal responsive and multi-turn capable.
9. Disable/re-enable refuses a foreign plugin directory and redeploys an owned
   stale package safely.
10. OpenCode, Pi, and one Claude/Codex extraction smoke test still pass.

Only after all rows pass, mark the plan DONE/live-verified with exact Harness
and resolved core package versions.

### Step 7: Run final gates

```bash
npm run deepseek:check
npm run deepseek-transcript:check
npm run pi:check
npm run pi-transcript:check
npm run opencode:check
npm run opencode-transcript:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Do not run `npm run golden`; no extraction prompt changes. Inspect
`git status --short` and confirm every changed path is in Scope.

## Test plan

- Behavioral JS fixtures for message reduction and per-turn session scanning,
  using exported pure helpers from the bundled runner.
- Mocked run-order fixture: user transcript before followup; committed
  assistant transcripts after idle and before Stop; posting failures swallowed.
- Rust: adapter v2 stale/v3 current; synthetic transcript allowlist is exactly
  OpenCode/Pi/DeepSeek.
- Parser: strict `deepseek_message` envelope and schema-drift recognition.
- Existing installer, activity, resume, OpenCode, Pi, and extraction checks.
- Ten-row live matrix above.

## Done criteria

- [x] PR 52 merged, clean `main`, and `PHASE 40 ACCEPTED` preceded code work.
- [x] Redacted live event-contract evidence is recorded before implementation.
- [x] Exact submitted user text and only committed appended assistant text feed
      extraction through authenticated structured events.
- [x] No PTY/stdout/session-file semantics exist.
- [x] Attempts, replacements, reasoning, tools/results, system/injected content,
      and unknown shapes are excluded by behavioral tests.
- [ ] Profile/Rust adapter versions are both 3; stale/incomplete v2 explicit redeploy awaits live testing.
- [x] Existing extraction pipeline and prompts remain unchanged.
- [ ] DeepSeek capability flips only after code gates and claims live support
      only after all ten manual rows pass.
- [x] Focused/full gates pass; golden is not run; diff is in scope and clean.

## STOP conditions

Stop and report if:

- PR 52, clean/current `main`, or the literal phase token is missing.
- Committed `assistant/message` events do not reproduce complete visible text,
  or retries/replacements cannot be excluded deterministically.
- The only viable source is assistant-stream accumulation, PTY/stdout parsing,
  persisted session parsing, or full raw-event forwarding.
- Direct human input cannot be distinguished from injected `user/message`
  events; keep using the controlled readline string rather than guessing.
- The profile reinstall would overwrite a foreign directory, loosen package
  pinning, bundle node_modules, or require global/system configuration changes.
- Work requires a migration, extractor prompt/backend/queue change, UI redesign,
  autonomous input, dependency upgrade, or file outside Scope.
- A post would need to be awaited or extraction failure could affect the
  Harness loop.
- A gate fails twice after one focused reasonable fix or another adapter
  regresses live.

## Maintenance notes

DeepSeek Harness packages are prerelease and the terminal UI is Logic
Loop-owned. Re-run the redacted event contract and full profile matrix after a
core package upgrade. Keep package/Rust adapter versions synchronized. Review
the seq window, surface-operation filter, text-block allowlist, post ordering,
and installer preservation carefully. Do not consolidate the three synthetic
envelopes until that refactor has its own regression plan; explicit shapes keep
adapter contract drift visible.
