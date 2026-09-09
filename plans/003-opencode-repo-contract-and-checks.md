# Plan 003: Establish the OpenCode repo contract and baseline adapter checks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat c0c0cdd..HEAD -- AGENTS.md opencode.json package.json scripts/opencode-check.ts docs/TESTING.md src-tauri/src/opencode.rs src-tauri/src/ingest.rs src/lib/ingest.ts`
> If an in-scope file changed since this plan was written, compare the current
> state below with live code before proceeding. A mismatch is a STOP condition.

## Status

- **Candidate phase**: Phase 23, after Phase 22 is accepted and committed
- **Priority**: P1
- **Effort**: S (about 0.5-1 engineering day plus a short manual OpenCode pass)
- **Risk**: LOW-MED (documentation and tests are low risk; a bad permission
  pattern can interrupt normal OpenCode commands)
- **Depends on**: Phase 22 acceptance and commit; current OpenCode identity
  work in that phase
- **Category**: DX / tests / docs
- **Planned at**: commit `c0c0cdd`, 2026-09-08, with uncommitted Phase 22 work
  present in the planning workspace

## Why this matters

OpenCode `1.18.30` currently falls back to the repository's roughly 40 KB
`CLAUDE.md` because no root `AGENTS.md` exists. Adding `AGENTS.md` changes what
OpenCode loads: for the installed v1 line, the project `AGENTS.md` wins over
the project `CLAUDE.md`. The repository therefore needs a compact,
adapter-neutral contract before relying on OpenCode for implementation work.

The OpenCode adapter also has Rust unit coverage but no focused TypeScript
check in `npm run check`. This phase adds a baseline check for behavior that
exists now. It deliberately does not claim transcript ingestion, normalized
tool errors, or `session.error`/`session.status` handling before those payloads
are captured from a live OpenCode session.

## Current state

- `CLAUDE.md:7-55` defines phase gates, architecture invariants, and code
  conventions. It is Claude-specific and 40,367 bytes; do not copy it wholesale
  into always-loaded OpenCode context.
- No root `AGENTS.md` or repo-local `opencode.json` exists.
- Installed OpenCode is `1.18.30`. Its v1 rules documentation says a project
  `AGENTS.md` shadows the project `CLAUDE.md`. OpenCode v2 documents different
  discovery behavior, so v2 migration is not part of this phase.
- `src-tauri/src/opencode.rs:12` sets `OPENCODE_PLUGIN_VERSION` to `2` in the
  current Phase 22 working tree.
- `src-tauri/src/opencode.rs:78-82` currently maps:

  ```text
  session.created -> SessionStart
  session.idle -> Stop
  permission.asked -> Notification
  ```

- `src-tauri/src/opencode.rs:128-150` maps `chat.message` to
  `UserPromptSubmit` and `tool.execute.after` to `PostToolUse`.
- `src-tauri/src/opencode.rs:99-105` sends the version, tab tether, bearer
  token, and `X-Logic-Loop-Agent: opencode` headers.
- `src-tauri/src/ingest.rs:303-309` allows only `codex`, `opencode`, and
  `antigravity` adapter markers in the current Phase 22 working tree.
- `src/lib/ingest.ts:233-263` is the shared hook-to-tab state machine.
- `scripts/epoch-check.ts` is the exemplar for a fast, standalone assertion
  script. `scripts/codex-transcript-check.ts` is the exemplar for reading a
  repository fixture/source and asserting a provider-specific contract.
- `package.json:13-31` registers granular `tsx scripts/*-check.ts` commands and
  chains them through `npm run check`.
- `docs/TESTING.md` currently ends with Phase 22 manual checks and the shared
  quality-gate ledger. Add the next numbered section; do not renumber history.
- The existing `plans/OpenCode_Implementation_Plans.md` is stale where it says
  OpenCode identity is absent. Its Plan 008 also expects future transcript and
  tool-error behavior. This phase pulls forward only a baseline check for the
  behavior that is already implemented.

Relevant upstream references, checked 2026-09-08:

- OpenCode v1 rules and precedence: `https://opencode.ai/docs/rules`
- OpenCode permissions and last-match-wins patterns:
  `https://opencode.ai/docs/permissions/`
- OpenCode configuration schema: `https://opencode.ai/config.json`

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Installed target | `opencode --version` | `1.18.30` or another `1.x` version |
| Focused check | `npm run opencode:check` | exit 0 and `opencode-check: all assertions passed` |
| Aggregate checks | `npm run check` | every registered check passes |
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Rust tests | `cd src-tauri && cargo test --lib` | all library tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | exit 0, no warnings |
| Build | `npm run build` | exit 0 |
| Diff hygiene | `git diff --check` | no output, exit 0 |

Do not run `npm run golden`: no extraction prompts change, and the command
requires a live `claude -p` process.

## Scope

**In scope** (the only files to modify):

- `AGENTS.md` (create)
- `opencode.json` (create)
- `scripts/opencode-check.ts` (create)
- `package.json`
- `docs/TESTING.md`
- `plans/README.md` (status only)

**Read-only evidence files**:

- `CLAUDE.md`
- `src-tauri/src/opencode.rs`
- `src-tauri/src/ingest.rs`
- `src/lib/ingest.ts`
- `scripts/epoch-check.ts`
- `scripts/codex-transcript-check.ts`

**Out of scope**:

- Editing, trimming, or splitting `CLAUDE.md`
- OpenCode transcript ingestion or decision/blocker extraction
- Tool-response/error normalization
- `ingest.env` reload behavior
- `session.error` or `session.status` mapping
- Extracting the generated plugin from its Rust string literal
- Claude, Codex, or Antigravity runtime behavior
- Database migrations, dependencies, lockfiles, global OpenCode config, and
  generated/build artifacts

## Git workflow

- Create the phase branch only after Phase 22 is accepted and committed.
- Suggested branch: `feat/phase23-opencode-contract`.
- Use one logical commit matching repository history, for example:
  `feat(phase23): add OpenCode repo contract and checks`.
- Do not push or open a PR unless explicitly instructed.

## Target design

### `AGENTS.md`

Keep the file ASCII and at or below 3,072 bytes. Use these sections:

1. One-paragraph product/stack summary.
2. `Repo map` with exact paths for Rust core, React UI, DB layer, ingestion,
   check scripts, docs, and plans.
3. `Workflow` preserving the literal phase-acceptance gate from `CLAUDE.md`:
   planning is allowed, implementation of phase N+1 waits for
   `PHASE N ACCEPTED`.
4. `Verify` with exact commands from this plan and guidance to run the focused
   check first.
5. `Invariants` containing all six shared invariants from `CLAUDE.md:21-41`,
   rewritten without Claude-only wording.
6. `Boundaries` covering the typed repo layer, additive migrations,
   StrictMode listener cleanup, generated-file rules, no autonomous terminal
   input, no global changes without approval, and untrusted agent content.
7. `Adapter matrix` stating current capability honestly: Claude and Codex have
   transcript-backed extraction; OpenCode and Antigravity provide activity but
   not decision extraction.
8. `Read on demand` pointing to `CLAUDE.md`, `CONTRIBUTING.md`,
   `docs/ROADMAP.md`, `docs/TESTING.md`, and the relevant file under `plans/`.

Do not phrase file references as automatically loaded. OpenCode v1 does not
resolve arbitrary references written in `AGENTS.md`; `opencode.json` handles
the one additional always-relevant instruction file.

### `opencode.json`

Use valid JSON, not JSONC. Use this exact initial shape unless the installed
v1 schema rejects it:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["CONTRIBUTING.md"],
  "permission": {
    "external_directory": "ask",
    "bash": {
      "*": "allow",
      "git push*": "ask",
      "git reset*": "ask",
      "git clean*": "ask",
      "git checkout --*": "ask",
      "rm *": "ask",
      "npm install*": "ask",
      "npm uninstall*": "ask",
      "npm update*": "ask",
      "pnpm add*": "ask",
      "yarn add*": "ask",
      "cargo add*": "ask",
      "npm run tauri*build*": "ask",
      "cargo tauri build*": "ask",
      "npx tauri build*": "ask"
    }
  }
}
```

Ordering is load-bearing because the documented rule is "last matching rule
wins": the catch-all must remain first. These rules are workflow guardrails,
not a security sandbox. Do not add `CLAUDE.md` to `instructions`, because that
would restore the large always-loaded context this phase is intended to avoid.
Do not add model/provider preferences; those belong to each developer.

### `scripts/opencode-check.ts`

Follow the `node:assert` quickcheck style and end with exactly:

```ts
console.log("opencode-check: all assertions passed");
```

The script must run without Tauri, a database, network access, or a live
OpenCode process. Cover these contracts:

- Parse `opencode.json` and assert the schema URL, `CONTRIBUTING.md`
  instruction, `external_directory: ask`, catch-all bash allow, and named ask
  rules for push, destructive git, removal, package mutation, and Tauri build.
- Read `AGENTS.md`; assert it is non-empty and no more than 3,072 bytes. Assert
  the six invariant concepts and exact core verification commands are present.
- Read `src-tauri/src/opencode.rs`; assert plugin version `2`, the OpenCode
  agent header, current `EVENT_MAP` entries, `chat.message`,
  `tool.execute.after`, `UserPromptSubmit`, and `PostToolUse`.
- Assert the generated hook bodies call `post(...)` without `await post(...)`,
  preserving fail-open/fire-and-forget behavior. Keep this assertion narrowly
  scoped enough that comments cannot satisfy it accidentally.
- Exercise `resetEpochGuard` and `stateForHook` using the current translated
  event sequence: `SessionStart -> null`, `UserPromptSubmit -> working`,
  `PostToolUse -> working`, `Notification -> waiting`, `Stop -> idle`, then a
  late `PostToolUse -> null`.
- Do not assert `_transcript`, `message.updated`, `session.error`,
  `session.status`, or tool-error state; those features do not exist yet.

## Steps

### Step 1: Confirm the phase base and OpenCode major version

Confirm Phase 22 has been accepted and committed, and the working tree does
not contain someone else's changes to an in-scope file. Run the drift command
from the header and `opencode --version`.

**Verify**: Phase 22 is committed; OpenCode reports a `1.x` version; no
unexplained in-scope drift remains.

### Step 2: Add the compact shared contract

Create `AGENTS.md` from the target design. Reconcile every statement with the
live repository. Keep historical details and provider-specific archaeology in
the referenced docs.

**Verify**: `test "$(wc -c < AGENTS.md)" -le 3072` exits 0, and
`rg -n 'npx tsc --noEmit|npm run check|cargo test --lib|cargo clippy' AGENTS.md`
finds all four commands.

### Step 3: Add conservative OpenCode project configuration

Create `opencode.json` with the target shape. Preserve catch-all-first rule
ordering. Do not configure a model, provider, plugin, formatter, or global
path.

**Verify**:
`node -e 'JSON.parse(require("node:fs").readFileSync("opencode.json", "utf8")); console.log("valid")'`
prints `valid` and exits 0.

### Step 4: Add the focused baseline check

Create `scripts/opencode-check.ts` with the specified assertions. Add
`"opencode:check": "tsx scripts/opencode-check.ts"` to `package.json` and add
`npm run opencode:check` to the aggregate `check` chain. Preserve all existing
Phase 22 script entries and their order.

**Verify**: `npm run opencode:check` prints the exact success line and exits 0.

### Step 5: Add manual verification for the phase

Append the next numbered section to `docs/TESTING.md`. Include:

- Launch OpenCode `1.x` from the repository and confirm it can state the repo's
  phase gate, primary TypeScript/Rust checks, and structured-only ingestion
  invariant from `AGENTS.md`.
- Request `git push --dry-run`, `rm` against a disposable test file, and one
  package mutation command; confirm each asks for approval, then reject it.
- Confirm ordinary `git status`, `rg`, focused checks, edits inside the repo,
  and `npm run opencode:check` do not gain unexpected prompts.
- Toggle the Logic Loop OpenCode adapter on, start a new OpenCode session, and
  confirm current activity still binds to the correct tab and is stored with
  `agent: opencode`. Do not claim transcript or tool-error support.
- Restart the session after editing `AGENTS.md` only if validating instruction
  changes; rule content is session context, not a live-reloaded UI setting.

**Verify**: `rg -n 'OpenCode repo contract|opencode:check|git push' docs/TESTING.md`
finds the new section and its key checks.

### Step 6: Run phase gates and inspect scope

Run the focused check, aggregate TypeScript checks, typecheck, build, Rust
tests, Rust lint, and diff hygiene. Inspect `git status --short` and confirm
only in-scope files changed.

**Verify**: every command in "Commands you will need" exits 0, except the
intentionally omitted golden set; `git status --short` contains no out-of-scope
changes introduced by this phase.

## Test plan

- `scripts/opencode-check.ts` is the new automated characterization check.
- Configuration tests cover valid JSON and the load-bearing permission order.
- Instruction tests cover size, invariants, and exact verification commands.
- Plugin tests characterize only the current generated plugin source with
  `OPENCODE_PLUGIN_VERSION = 2`; this does not refer to OpenCode v2.
- State tests prove the translated OpenCode events remain compatible with the
  shared state machine, including the late-event epoch guard.
- Existing Rust test `plugin_source_embeds_the_version_and_ingest_contract`
  remains the source-side unit test and must stay green.
- Manual tests cover real OpenCode rule loading, approval prompts, and one live
  adapter smoke test without expanding product behavior.

## Done criteria

- [ ] Phase 22 was accepted and committed before implementation began.
- [ ] `AGENTS.md` exists, is at most 3,072 bytes, and contains the agreed
  adapter-neutral contract.
- [ ] `CLAUDE.md` is byte-for-byte unchanged by this phase.
- [ ] `opencode.json` parses and matches the target project-local policy.
- [ ] `npm run opencode:check` passes with the exact success line.
- [ ] `npm run check`, `npx tsc --noEmit`, and `npm run build` pass.
- [ ] `cd src-tauri && cargo test --lib` passes.
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings` passes.
- [ ] `git diff --check` passes.
- [ ] The new `docs/TESTING.md` section contains results for every manual item.
- [ ] No runtime behavior, dependency, lockfile, migration, generated artifact,
  or global config changed.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back instead of improvising if:

- Phase 22 is not accepted and committed. This plan overlaps its
  `package.json` and `docs/TESTING.md` files.
- `opencode --version` reports major version `2` or later. V2 documents
  different instruction discovery, and its `instructions` entries may not yet
  be resolved into model context; revise this plan as a migration instead.
- The installed `1.x` build rejects any target `permission` or `instructions`
  field. Capture the validation error and propose the smallest schema-correct
  change.
- Current OpenCode identity/version/header behavior is absent after Phase 22 is
  committed. Fixing that belongs to the Phase 22 reconciliation, not this
  phase.
- A check requires exporting private Rust implementation details into
  production APIs. Keep the test source-reading based or stop for review.
- The work appears to require `CLAUDE.md`, runtime adapter code, a dependency,
  a lockfile, a migration, or global configuration changes.
- A verification fails twice after a reasonable correction.

## Maintenance notes

- When OpenCode transcript ingestion or tool-error normalization lands, extend
  `opencode-check.ts` in that implementation phase and then mark the applicable
  portion of OpenCode Plan 008 complete.
- When the repository adopts OpenCode v2, re-check AGENTS discovery,
  `instructions` resolution, config precedence, and permission syntax before
  changing this contract.
- Reviewers should scrutinize permission pattern ordering and claims in the
  adapter matrix. Both can silently drift while syntax continues to pass.
- Keep `AGENTS.md` concise. Long phase history belongs in `CLAUDE.md`, roadmap,
  testing records, and plans, loaded only when relevant.
