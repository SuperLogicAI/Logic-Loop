# Plan 039: Add decision and blocker extraction to Pi Agent

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Stop on any condition listed below;
> do not improvise. Update this plan, `plans/README.md`, and
> `docs/TESTING.md` with actual evidence when finished.
>
> **Phase gate**: This plan proposes **Phase 39**. The disposable contract
> spike may run during planning, but repository implementation must not begin
> until the maintainer writes the literal token `PHASE 39 ACCEPTED`. PR 51's
> session-ownership/tab-identity fix must also be merged, and implementation
> must branch from the resulting clean `main`.
>
> **Drift check (run first)**:
> `git diff --stat a38fe73..HEAD -- src-tauri/src/pi.rs src-tauri/src/ingest.rs src/lib/decisions.ts src/lib/onboarding.ts scripts/pi-check.ts scripts/opencode-transcript-check.ts scripts/onboarding-check.ts package.json README.md docs/TESTING.md docs/PROGRESS.md plans/README.md`
> If an in-scope file changed, reconcile it against the current-state section.
> Stop on an incompatible contract and revise this plan before coding.

## Status

- **Status**: DONE 2026-09-22 — Phase 39 accepted; full automated gates and
  maintainer live pass complete
- **Priority**: P1 adapter parity
- **Effort**: M — 1–2 focused build days plus live Pi/macOS checks
- **Risk**: MED — generated code runs inside Pi; event shape, ordering, and
  duplicate behavior require live proof
- **Depends on**: PR 51 merged; clean `main`; `PHASE 39 ACCEPTED`; Step 0 gate
- **Category**: direction
- **Planned at**: commit `a38fe73`, 2026-09-22

## Why this matters

Pi already has live-verified activity and session re-entry, but Setup correctly
reports decision extraction as unavailable. The installed Pi 0.85.1 extension
API documents finalized `message_end` events for user and assistant messages.
If the live contract matches, Pi can send visible conversation text into the
existing decision pipeline without parsing PTY output or Pi session files.

The outcome is deliberately narrow: visible Pi questions and assumptions can
create Decision cards, later structured user messages can reconcile them, and
the capability flips only after live validation. Activity, tool normalization,
re-entry, database schema, extractor prompts, and extractor backends remain
unchanged.

## Current state and conventions

- `src-tauri/src/pi.rs` generates the owned extension at
  `~/.pi/agent/extensions/logic-loop.ts`; `PI_EXTENSION_VERSION` is `1`.
  It sends `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop`, but no
  message text. Posts are authenticated, tethered, fire-and-forget, bounded by
  a two-second abort, and fail open.
- `src-tauri/src/pi.rs:145-153` uses `before_agent_start` for lifecycle only.
  Pi's installed docs expose `event.prompt`, but this plan prefers a single
  finalized-message source if Step 0 proves it complete and one-per-message.
- Pi 0.85.1's installed docs say `message_end` fires for user, assistant, and
  tool-result messages and carries finalized `event.message`; `message_update`
  is streaming. That has not yet been captured live for this feature.
- `src-tauri/src/ingest.rs:105-129` accepts synthetic `TranscriptLine` only
  from authenticated OpenCode requests and emits `ingest://transcript`. Pi is
  already a recognized adapter but cannot use that route.
- `src/lib/decisions.ts` recognizes Claude, Codex, and `opencode_message`
  envelopes. `onTranscript`/`onStop` already own pairing, reconciliation,
  serialization, validation, and fail-open behavior; reuse them unchanged.
- `src/lib/onboarding.ts:85-92` reports Pi as activity/re-entry supported and
  decisions unsupported. The Decisions panel uses this shared metadata, so no
  component branch should be necessary.
- `scripts/pi-check.ts` characterizes generated Pi source.
  `scripts/opencode-transcript-check.ts` is the synthetic-envelope exemplar.
- `plans/026-pi-agent-adapter.md` and `docs/TESTING.md` §§55–56 record Pi's
  existing 0.85.1 contract and must remain valid.

Honor these repository invariants: never parse ANSI/PTY output; use structured
agent APIs for semantics; fail open; never await ingestion from a Pi handler;
treat all message content as untrusted data; never send terminal input; never
hand-edit the installed generated extension.

## Scope

**In scope**:

- `src-tauri/src/pi.rs`
- `src-tauri/src/ingest.rs`
- `src/lib/decisions.ts`
- `src/lib/onboarding.ts`
- `scripts/pi-check.ts`
- `scripts/pi-transcript-check.ts` (new)
- `scripts/onboarding-check.ts`
- `package.json`
- `README.md`
- `docs/TESTING.md`
- `docs/PROGRESS.md`
- `plans/039-pi-decision-extraction.md`
- `plans/README.md`

**Out of scope**:

- DeepSeek, Antigravity, Gemini, Copilot, or another adapter
- PTY parsing, Pi JSON/RPC modes, or Pi session-file parsing
- Database migrations or `src/lib/repo.ts` changes
- Extractor prompts, backends, queues, golden fixtures, or extractor modules
- UI redesign, new panels, autonomous input, or a Pi-specific extractor
- Reasoning/thinking, tool calls/results, images, system/custom messages,
  context files, skills, or full message/session objects
- Treating `ui_prompt_start` as agent content; third-party Pi extensions may
  create those prompts
- Refactoring OpenCode to a generic cross-adapter envelope. Use an explicit
  `pi_message` envelope so the live OpenCode route remains stable.

## Git workflow

- After the dependencies pass, branch `feat/pi-decision-extraction` from clean
  `main`.
- Match recent conventional commits, e.g.
  `feat(pi): add decision extraction from finalized messages`.
- Do not push or open a PR unless instructed. Preserve unrelated work.

## Steps

### Step 0: Prove the finalized-message contract live

Create a disposable extension outside `~/.pi/agent/extensions/` and load it
with `pi -e <path>`. Log only redacted shape metadata: event, role, content
block types, stable message identifier if present, ordering, and counts. Do not
record prompt/reply bodies, credentials, reasoning, tool results, or complete
messages. Do not change global Pi configuration or the installed Logic Loop
extension.

Observe on the installed Pi version:

1. A plain-text turn without tools.
2. A tool-call turn with final prose.
3. Two turns in one session.
4. A queued follow-up or retry-before-idle.
5. A resumed `pi --session <id>` turn.
6. A response containing visible text plus reasoning/tool blocks, if emitted.

Record in `docs/TESTING.md`: version, exact event order, user/assistant content
shape, text-block discriminator, role distinctions, ordering relative to
`before_agent_start` and `agent_settled`, completeness, duplicate behavior,
and whether a stable message ID exists. Compare the user `message_end` with
`before_agent_start.event.prompt`; prefer `message_end` for both roles if it is
complete and deterministic.

**Gate**: proceed only if structured events provide complete visible user and
assistant text, safe role filtering, and a deterministic no-partial/no-duplicate
rule. If live behavior differs from the plan, revise and re-approve it before
coding.

**Verify**: a redacted event-order table is committed to `docs/TESTING.md`; no
production source changed.

### Step 1: Emit finalized Pi messages

In `src-tauri/src/pi.rs::extension_source()`:

1. Bump `PI_EXTENSION_VERSION` to `2`, making stale deployed extensions fail
   visibly until the user explicitly re-enables Pi.
2. Add a pure reducer for the Step 0-proven finalized shape. Accept only
   `user` and `assistant`; join visible `text` blocks in source order; reject
   empty text and all other roles/block types. Never serialize raw fallback
   objects or include reasoning, tool calls/results, images, or system data.
3. Register only the finalized event proven in Step 0 (expected:
   `message_end`). Get current `session_id` and `cwd` through `rowBase(ctx)` and
   use the existing non-awaited `post()` to send:

   ```json
   {
     "hook_event_name": "TranscriptLine",
     "session_id": "<Pi session>",
     "cwd": "<cwd>",
     "line": "{\"type\":\"pi_message\",\"role\":\"user|assistant\",\"text\":\"...\"}"
   }
   ```

4. Add exact session-bounded deduplication only if Step 0 proves it necessary
   and provides a stable ID. Clear it on `session_start`/`session_shutdown`.
   Do not invent hash- or time-based dedupe.
5. Preserve existing lifecycle/tool handlers and `agent_settled` as the only
   `Stop`. Return nothing from the finalized-message handler so it cannot
   replace or mutate Pi's message.

If live messages can exceed the ingest request limit, stop and amend this plan
with a named UTF-8-safe extraction-only cap and tests. Do not blindly slice JS
strings or change the user's actual session content.

Extend Rust tests and `scripts/pi-check.ts` for version 2, event registration,
strict content filtering, exact envelope, fire-and-forget behavior, and
reasoning/tool-result exclusion.

**Verify**: `npm run pi:check` and
`cd src-tauri && cargo test --lib pi::tests` pass.

### Step 2: Admit Pi through synthetic transcript ingestion

In `src-tauri/src/ingest.rs`, allow `TranscriptLine` only for recognized
`opencode` and `pi` markers. Preserve bearer authentication, agent
normalization, response handling, and ordinary hook ingestion. Missing,
unrecognized, Claude, Codex, Antigravity, and DeepSeek markers must not use
this route.

Prefer a small pure closed-set predicate if useful; do not refactor the server.
Test Pi accepted, OpenCode unchanged, other/missing markers rejected, and
malformed payloads dropped rather than emitted as ordinary hooks.

**Verify**: `cd src-tauri && cargo test --lib ingest::tests`, then
`npm run opencode:check && npm run opencode-transcript:check` pass.

### Step 3: Parse `pi_message` without changing extraction semantics

In `src/lib/decisions.ts`:

- Recognize `pi_message` in `transcriptEnvelopeType`.
- Parse only `user`/`assistant` plus nonempty string `text`, matching the
  strict `opencode_message` behavior.
- Do not modify `onTranscript`, `onStop`, prefiltering, reconciliation,
  queueing, schema-drift threshold, or prompts.
- Keep an explicit envelope branch; do not trust arbitrary `{role,text}` JSON.

Create `scripts/pi-transcript-check.ts`, modeled on the OpenCode check, for:
valid roles; malformed/empty/unknown inputs; schema recognition; assistant +
Stop eligibility; assistant + user pairing; and isolation between session IDs.
Register `pi-transcript:check` in `package.json` immediately after `pi:check`
in the aggregate check.

**Verify**: `npm run pi-transcript:check`, `npm run decisions:check`, and
`npm run decision-integrity:check` pass.

### Step 4: Flip truthful capability metadata

After Steps 1–3 pass:

- Set Pi to `{ activity: true, decisions: true, reentry: true }` in
  `src/lib/onboarding.ts`; update `scripts/onboarding-check.ts`.
- Update README to say extraction uses finalized visible in-process messages,
  not terminal output or session files.
- Add Phase 39 sections to `docs/PROGRESS.md` and `docs/TESTING.md`; do not call
  it DONE or live-verified yet.
- Mark the index row BUILT, automated gates clean, live matrix pending.

**Verify**: `npm run onboarding:check`, `npm run empty-state:check`, and
`npm run check` pass.

### Step 5: Run the live acceptance matrix

Rebuild/relaunch, disable/re-enable Pi to deploy v2, then record redacted
PASS/FAIL evidence in `docs/TESTING.md` for all of these:

1. A stale v1 extension reads disabled; explicit re-enable deploys v2.
2. A real plain-text Pi clarifying question creates exactly one correctly
   bound Decision card.
3. A later Pi user reply conservatively reconciles the intended card;
   cancelling Answer now changes nothing.
4. A tool turn preserves Accomplished detail and extracts no tool/reasoning
   content.
5. Two Pi tabs in one cwd do not cross-bind messages or decisions.
6. Retry/queued follow-up yields complete text, no duplicate card, and no
   premature idle.
7. Quit/relaunch/Re-enter recalls context and a new question still binds.
8. Closed/unavailable ingest never delays or breaks Pi.
9. OpenCode plus one Claude or Codex extraction smoke test still passes.

Only after all rows pass, mark the plan DONE/live-verified and finalize README,
progress, testing, and index status with the tested Pi version.

### Step 6: Run final gates

```bash
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

Do not run `npm run golden`. Inspect `git status --short`; every change must be
in scope.

## Done criteria

- [ ] `PHASE 39 ACCEPTED` preceded implementation.
- [ ] PR 51 landed and the feature branch started from clean `main`.
- [ ] Redacted live contract evidence is recorded.
- [ ] Only finalized visible user/assistant text enters extraction through
      authenticated structured events.
- [ ] Reasoning, tools/results, images, system/custom data, and unknown roles
      are excluded by tests.
- [ ] Only Pi and OpenCode can use synthetic `TranscriptLine` ingestion.
- [ ] Existing pairing and extractor prompts remain unchanged.
- [ ] Capability metadata flips only after implementation gates; final docs
      claim live verification only after all nine manual rows pass.
- [ ] Focused and full gates pass; `npm run golden` was not run.
- [ ] `git diff --check` is clean and no out-of-scope file changed.

## STOP conditions

Stop and report if:

- The phase token, merged PR 51, or clean/current `main` prerequisite is absent.
- Finalized events lack complete visible text, leak excluded content, cannot
  distinguish roles, or duplicate without a stable ID.
- The only workable source is PTY output, JSON/RPC control, or session files.
- Structured question support would require treating arbitrary third-party Pi
  UI prompts as assistant decisions.
- Work requires a migration, prompt/backend/queue change, UI redesign, or an
  out-of-scope file.
- The extension would need to await network I/O, replace a message, or affect
  Pi execution on failure.
- A gate fails twice after one focused reasonable fix, or another adapter
  regresses live.

## Maintenance notes

Pi is pre-1.0. Repeat the redacted contract and live matrix after upgrades,
and bump `PI_EXTENSION_VERSION` whenever generated wire behavior changes.
Keep `pi_message` explicit until a separately approved consolidation has more
proven consumers. Review content filtering, duplicate behavior, ordering
relative to `agent_settled`, and the handler's lack of a return value closely.
DeepSeek extraction remains a separate later phase because its custom runner
needs its own final-message assembly and profile redeployment validation.
