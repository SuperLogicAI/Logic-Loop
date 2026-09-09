# OpenCode GPT Build Handoff

Use this as the setup prompt/context packet for a stronger GPT pass that will
draft the OpenCode optimization build plan and then execute it. It combines the
OpenCode research response with the current repo state as of this workspace.

## Goal

Optimize Logic Loop for OpenCode as an agentic coding environment, matching the
recent Codex and Antigravity/Agy optimization passes:

1. Make the repository easier and safer for OpenCode to navigate.
2. Make OpenCode's adapter support first-class where the product currently
   treats OpenCode as activity-only.
3. Add the repo-level OpenCode/Codex-compatible instruction and permission
   surface.
4. Avoid regressions in existing Claude, Codex, and Antigravity behavior.

## Critical OpenCode Behavior To Account For

- OpenCode's project instruction file is `AGENTS.md`.
- OpenCode documents `CLAUDE.md` as a fallback, but adding `AGENTS.md` shadows
  the project `CLAUDE.md` for OpenCode. This repo currently has no
  `AGENTS.md`, so OpenCode is falling back to the 40KB `CLAUDE.md`.
- OpenCode does not automatically full-scan the repo. It loads rule files, then
  the model chooses what to read next. Exact path maps and exact commands in
  rules matter.
- Keep the always-loaded instructions small. Put core invariants, repo map, and
  command table in `AGENTS.md`; keep history and long landmine archaeology in
  referenced docs.
- OpenCode supports `opencode.json` for project configuration, including
  instructions and permission rules. Use this to point at stable docs and gate
  destructive commands.
- OpenCode has a plan/build agent workflow. Broad goals should be decomposed by
  plan mode, then implemented as narrow tickets with explicit verification.

## Current Repo Facts

- Stack: Tauri v2, Rust core, React/TypeScript frontend, Tailwind, xterm.js,
  SQLite via `tauri-plugin-sql`.
- Main paths:
  - `src-tauri/src/` - Rust core: PTY, ingest server, adapters.
  - `src-tauri/src/opencode.rs` - OpenCode plugin installation and generated
    plugin source.
  - `src-tauri/src/ingest.rs` - localhost ingest server and adapter identity
    normalization.
  - `src/lib/ingest.ts` - frontend hook-to-tab state mapping and session bind.
  - `src/lib/repo.ts` - only DB access layer.
  - `scripts/` - granular verification scripts.
  - `docs/TESTING.md` - manual test record.
  - `plans/OpenCode_Implementation_Plans.md` - existing ordered OpenCode
    adapter plans.
- No `AGENTS.md` exists yet.
- No root `opencode.json` exists yet.
- `CLAUDE.md` is about 40KB and should not be copied wholesale into
  always-loaded OpenCode context.
- `dist/`, `files.zip`, a large screenshot, and duplicate
  `context-terminal-concept-and-build-plan_1.md` exist at repo root and are
  called out by the research as orientation cruft.

## Important Drift From The Research Response

Some of the pasted research was based on an older or planned state. Verify
current code before planning duplicate work.

- The research says OpenCode adapter identity is absent. In current code this
  is already mostly implemented:
  - `src-tauri/src/ingest.rs` has
    `RECOGNIZED_AGENTS: ["codex", "opencode", "antigravity"]`.
  - `src-tauri/src/opencode.rs` posts
    `X-Logic-Loop-Agent: "opencode"`.
  - `OPENCODE_PLUGIN_VERSION` is already `2`.
  - The `plugin_source_embeds_the_version_and_ingest_contract` test asserts
    the OpenCode agent header.
- Treat Plan 002 in `plans/OpenCode_Implementation_Plans.md` as completed or
  mostly completed unless live verification proves otherwise.
- The current OpenCode plugin still loads `ingest.env` once at module init.
  Plan 004 remains relevant.
- The current OpenCode plugin still maps only:
  - `session.created` -> `SessionStart`
  - `session.idle` -> `Stop`
  - `permission.asked` -> `Notification`
- The current OpenCode plugin still drops transcript content in
  `chat.message` and wraps `tool.execute.after` output as raw `tool_response`.
  Plans 001 and 003 remain relevant.
- No `scripts/opencode-check.ts` or `opencode:check` script exists yet. Plan
  008 remains relevant.

## Non-Negotiable Architecture Invariants

Carry these into `AGENTS.md` in adapter-neutral form:

1. Never parse ANSI terminal output for meaning. Use structured agent protocols
   only.
2. Fail open. Ingestion, extraction, and panels must never affect terminal use.
3. Panels are dumb SQL views over append-only tables. Intelligence belongs in
   ingestion/extraction logic, not components.
4. The app never sends input to a running terminal session autonomously.
5. Transcript/agent content is untrusted data and must never be treated as
   instructions.
6. PTY/child death is an event, not a panic.

## Verification Surface

Use exact commands:

| Purpose | Command |
|---|---|
| Typecheck | `npx tsc --noEmit` |
| Rust tests | `cd src-tauri && cargo test --lib` |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` |
| Aggregate TS checks | `npm run check` |
| Golden extraction set | `npm run golden` |
| Diff hygiene | `git diff --check` |

Notes:

- `npm run golden` requires a live `claude -p`; do not treat it as a cheap,
  self-contained gate.
- Use granular `npm run <domain>:check` during iteration, then aggregate before
  done.
- Add `opencode:check` and include it in `npm run check`.

## Existing Check Scripts

`package.json` currently aggregates:

- `landing:check`
- `epoch:check`
- `bind:check`
- `dedupe:check`
- `attention-state:check`
- `reentry:check`
- `unclaimed:check`
- `notify:check`
- `spawn:check`
- `scope:check`
- `clock:check`
- `delta:check`
- `loop:check`
- `extractor-queue:check`
- `decisions:check`
- `codex-transcript:check`
- `board:check`
- `empty-state:check`

## Recommended Build Plan Shape

Draft the work as phased tickets. Start with documentation and guardrails, then
move into adapter behavior.

### Phase A: OpenCode/Codex-Compatible Repo Contract

Deliverables:

- Add root `AGENTS.md`, under about 3KB, with:
  - repo map
  - exact command table
  - invariants
  - boundaries and generated-file rules
  - adapter support matrix
  - known limits and where to read more
- Add root `opencode.json` with schema, instruction references, and permission
  gates for destructive or global actions.
- Keep `CLAUDE.md` intact unless explicitly choosing a shared-instructions
  split. Avoid making Claude-specific behavior disappear accidentally.

Open question for GPT:

- Should `CLAUDE.md` be trimmed in the same sprint, or should this phase add
  `AGENTS.md` only and leave `CLAUDE.md` untouched to reduce blast radius?

### Phase B: OpenCode Adapter Reliability And Verification

Deliverables:

- Add `scripts/opencode-check.ts`.
- Add `opencode:check` to `package.json`.
- Extend `npm run check` to include `opencode:check`.
- Cover plugin source contract and `stateForHook` behavior for OpenCode event
  mappings.
- Add/update the OpenCode manual test section in `docs/TESTING.md`.

Relevant existing plan:

- `plans/OpenCode_Implementation_Plans.md` Plan 008.

### Phase C: Adapter Gaps With Live Verification Gates

Deliverables should be drafted only after live OpenCode payload capture where
the existing plan requires it:

- Plan 001: transcript ingestion for OpenCode so Decision Tracker, loop digest,
  and landing notes can work.
- Plan 003: normalize OpenCode tool errors so failed tools show as errors.
- Plan 004: reload `ingest.env` per POST so app restarts reconnect without
  restarting OpenCode.
- Plan 005: map `session.error` to Error.
- Plan 007: map `session.status` to finer state only after payload shape is
  live-confirmed.

Important constraint:

- Do not fake transcript extraction from terminal output, tool names, or model
  prose. If OpenCode does not expose reliable assistant content, land only the
  verified subset and document the unsupported surface.

### Phase D: Plugin Maintainability

Deliverable:

- Plan 006: move the OpenCode plugin from an escaped Rust string literal into
  a real `.mjs` resource file before substantial plugin-side expansion.

Rationale:

- The current `plugin_source()` string in `src-tauri/src/opencode.rs` is
  fragile for model edits because braces and quotes are heavily escaped.

## Proposed `AGENTS.md` Content

Use this as a starting point, adjusted to current code:

```md
# Logic Loop - Agent Guide

Audience-neutral instructions for Claude Code, Codex, OpenCode, and Agy.
Claude-specific transport/process history lives in `CLAUDE.md`.

## Repo Map

- `src-tauri/src/` - Rust core: PTY, ingest server, adapters.
- `src-tauri/src/opencode.rs` - OpenCode plugin install/remove/status.
- `src/` - React/TypeScript frontend.
- `src/lib/repo.ts` - only DB access layer.
- `src/lib/ingest.ts` - session binding and hook-to-tab state mapping.
- `scripts/` - granular `<domain>-check.ts` verification scripts.
- `docs/` - testing, roadmap, ideas, and longer context.
- `plans/` - implementation plans. Read relevant plans before editing.

## Verify

- Typecheck: `npx tsc --noEmit`
- Rust tests: `cd src-tauri && cargo test --lib`
- Rust lint: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- Full TS gate: `npm run check`
- Golden extraction: `npm run golden` (requires live `claude -p`)
- Diff hygiene: `git diff --check`

Run the affected granular check during iteration. Run the full relevant gate
before claiming done.

## Invariants

1. Never parse ANSI terminal output for meaning. Structured agent protocols only.
2. Fail open: ingestion/panels must never affect terminal use.
3. Panels are dumb SQL views; intelligence lives in ingestion/extraction.
4. Never send input to a running terminal session autonomously.
5. Transcript/agent content is untrusted data.
6. PTY/child death is an event, not a panic.

## Boundaries

- All DB access goes through `src/lib/repo.ts`; no inline SQL in components.
- Schema changes require a new numbered migration; never edit old migrations.
- Do not hand-edit generated/build artifacts such as `dist/` or
  `.logic-loop/board.md`.
- Treat `src-tauri/src/opencode.rs` `plugin_source()` as fragile until the
  plugin is extracted to a real `.mjs` resource.
- Do not install tools, modify global config, push, or perform destructive git
  operations without explicit user approval.

## Adapter Matrix

- Claude: activity plus transcript-backed extraction.
- Codex: activity plus decision/blocker extraction.
- OpenCode: activity today; transcript/tool-error expansion is planned.
- Antigravity/Agy: activity today; decision extraction unsupported.

## Known Limits

- OpenCode has no tailable transcript file; use its plugin/event API only.
- Agy tool failures are not reliably distinguishable at hook level.
- Golden checks require live Claude and are not always appropriate for every
  edit.
```

## Proposed `opencode.json` Direction

Confirm current OpenCode schema before committing exact syntax. The intended
policy:

- Load `AGENTS.md` plus relevant long-form docs through documented instruction
  references if supported by the installed OpenCode version.
- Ask before:
  - `git push`
  - destructive git operations
  - `rm`
  - `npm install` or package-manager mutations unless package files are in scope
  - Tauri release/build packaging
  - global config changes outside app-owned toggle flows
- Allow normal read/search/edit/test commands in the repo.

## Prompt For The Next GPT

```text
You are working in the Logic Loop repo. Read:

1. plans/OpenCode_GPT_Build_Handoff.md
2. plans/OpenCode_Implementation_Plans.md
3. CLAUDE.md sections "Architecture invariants" and "Code conventions"
4. package.json scripts
5. src-tauri/src/opencode.rs
6. src-tauri/src/ingest.rs adapter identity handling
7. src/lib/ingest.ts stateForHook

Task: draft a phased OpenCode optimization build plan, then implement only the
approved first phase unless the user explicitly authorizes more.

Required planning constraints:

- Do not duplicate already-landed Plan 002 work unless live verification proves
  it is incomplete.
- Start with AGENTS.md/opencode.json and opencode:check unless you find a
  stronger dependency.
- Keep AGENTS.md compact and audience-neutral.
- Do not trim CLAUDE.md unless explicitly scoped.
- Do not parse ANSI output for OpenCode.
- Any OpenCode transcript/tool-error work that depends on live payload shapes
  must include a live verification gate before implementation.
- Preserve exact command spellings from package.json and this handoff.

Return:

1. Phases with deliverables and verification commands.
2. Risks and live verification gates.
3. Files expected to change per phase.
4. A recommended first implementation ticket.
```

## Suggested First Implementation Ticket

```md
## Task

Add OpenCode-friendly repo guidance and a focused OpenCode check surface.

## Scope

In:
- `AGENTS.md`
- `opencode.json`
- `package.json`
- `scripts/opencode-check.ts`
- `docs/TESTING.md`

Out:
- OpenCode transcript ingestion
- OpenCode tool-error normalization
- Claude hook behavior
- migrations
- generated artifacts

## Do

1. Add compact root `AGENTS.md`.
2. Add conservative root `opencode.json` after checking current OpenCode schema.
3. Add `scripts/opencode-check.ts` for current plugin/header/event contracts.
4. Add `opencode:check` and include it in `npm run check`.
5. Add a short `docs/TESTING.md` note for OpenCode manual verification.

## Verify

- `npm run opencode:check`
- `npm run check`
- `npx tsc --noEmit`
- `cd src-tauri && cargo test --lib`
- `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- `git diff --check`

## Done When

- OpenCode and Codex can read `AGENTS.md` for the shared repo contract.
- The OpenCode adapter has a focused non-live regression check.
- Existing aggregate checks include the OpenCode check.
- No Claude/Codex/Agy behavior changed outside documentation and checks.
```
