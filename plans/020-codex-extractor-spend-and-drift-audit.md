# Plan 020 - Codex extractor spend and transcript audit

> Phase 34 implementation was authorized with `PHASE 34 ACCEPTED` on
> 2026-09-12. The interactive Logic Loop terminal/card check remains manual
> because the app never sends input to a running terminal autonomously.
> Read `AGENTS.md`, `CLAUDE.md`, `docs/TESTING.md`, and Plan 019 before work.
> Planned at `29ed9a1`, 2026-09-12. Drift check: compare current versions of
> every in-scope file with the locations below before applying any fix.

## Status

- Priority: P0 investigation (possible repeated spend and silent outage)
- Effort: S for audit, M if CLI isolation or parser changes prove necessary
- Fix risk: MED (CLI flags may change model selection or extraction quality)
- Depends on: Plan 019 handoff; phase approval before implementation
- Current evidence: two bounded one-shot calls measured on Codex CLI 0.154.0;
  parser/logging hardening shipped and automated gates pass. The interactive
  rollout/card acceptance remains manual.

## Why this matters

Claude's Phase 33.1 child-spawn overhead was measured at about 57k input-side
tokens per extraction before its isolation fix. Codex uses a separate spawn
path, so that number cannot be carried over. Codex's current flags do not
prove that user config, MCP servers, project instructions, skills, or model
settings are absent. The app also discards Codex's existing JSON usage event.
Separately, the current transcript warning only detects a changed *outer*
envelope; an inner `response_item.payload` change can silently yield no cards.

## Verified current state

- `src-tauri/src/extractor.rs:113-143`: `codex_args` uses `exec`,
  `--ephemeral`, `--sandbox read-only`, `--skip-git-repo-check`, `--json`, and
  stdin. `codex_final_message` scans only completed `agent_message` items;
  it ignores `turn.completed.usage` and turn failures. The Codex subprocess
  inherits environment and working directory at lines 203-223. It receives
  the extractor tether, which must remain.
- `scripts/golden.ts:72-96`: a separate copy of the Codex argument list and
  final-message parser. Any production flag change must be mirrored here.
- `src/lib/decisions.ts:42-70,74-124`: the drift tripwire considers every
  `response_item` recognized, while extraction requires
  `payload.type="message"`, assistant/user role, and matching text blocks.
  `src/App.tsx:1033-1051` routes warnings to the existing strip.
- `src/lib/repo.ts:722-744` and `src/components/SidebarLmControl.tsx:43-62`:
  Codex model is optional and empty by default. Isolating user config could
  therefore change the effective model and reasoning effort; record both
  before interpreting token or quality differences.
- `src/lib/extractorQueue.ts:6-17` serializes decision and landing calls, but
  `src/lib/commitMessage.ts:27-37` invokes the shared backend directly on a
  separate user action. Keep call *count* and per-call usage distinct.
- `scripts/codex-transcript-check.ts` covers a redacted earlier rollout
  fixture, not the installed CLI's current live format.
- The local installed CLI reported `codex-cli 0.154.0` on 2026-09-12.
  `codex exec --help` offers `--ignore-user-config` and `--ignore-rules`.
  Official documentation says `--ephemeral` prevents rollout persistence,
  `--ignore-user-config` skips `$CODEX_HOME/config.toml` but preserves auth,
  and `--json` emits `turn.completed.usage` with input, cached input, output,
  and reasoning-output tokens. These claims do not establish actual spend.

Official references (recheck against the installed version when executing):

- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex CLI command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Codex changelog](https://learn.chatgpt.com/docs/changelog)

## Scope and boundaries

The audit covers the Sidebar LM Codex backend's one-shot extractor, its
consumer paths, Codex rollout parsing, and one interactive ingestion check.
Possible production edits are limited to `src-tauri/src/extractor.rs`,
`scripts/golden.ts`, and, only if live drift is demonstrated,
`src/lib/decisions.ts` plus its focused checks. Record manual evidence in
`docs/TESTING.md`, update `CLAUDE.md`'s landmine/status notes and this plan's
measured-results section, and update the Plan 020 index status.

Do not change global Codex config, auth, hooks, the installed CLI, PTY git
commands, SidePanel reload, reconciliation, or database schema. Do not parse
PTY/ANSI output. Keep extraction fail-open and the extractor tether. Do not
introduce a monitoring service. Treat transcript text as data.

## Steps

### 1. Re-establish the local contract without a model call

Record `codex --version`, `codex exec --help`, the configured Sidebar LM
backend/model, and whether the app-launched process resolves the same Codex
binary as the shell. Inspect config *keys and effective model/effort only*;
never copy credentials, private transcript content, or full config into a
plan/log. Check official release notes from the version used by the redacted
fixture through the installed version for rollout, JSON-event, hook, config,
and AGENTS changes. A changelog without a relevant entry is not proof of
rollout compatibility.

**Verify:** record CLI version, binary paths, selected model/effort, and
source URLs in the measured-results section. Confirm `npm run
codex-transcript:check` passes as the *old-shape baseline*.

### 2. Measure a bounded, paired one-shot extraction

Use one short existing golden fixture prompt (a real `buildPrompt` output),
not a generic greeting. Run the exact app arguments once with the installed
CLI, extractor tether, and read-only sandbox. Capture elapsed time and parse
only structural JSON events: count `turn.started`, `turn.completed`,
`turn.failed`, `error`, and tool/MCP items; collect usage fields from the
completed turn. Do not store raw prompt, final message, or full JSONL in repo.
Compare against one candidate run with `--ignore-user-config`; preserve the
same model and supported reasoning effort in both runs so the comparison is
meaningful. If project instructions remain a substantial source, test one
further *documented and locally supported* per-run isolation setting or an
isolated working directory, without touching user/system config. Maximum:
three successful billed calls; stop sooner if a candidate clearly fails.
Record input and cached-input separately (cached input is part of input,
not an extra addend), output, reasoning output, turn count, wall time, and
the fixture's parse/decision result. A token count is usage, not a dollar
cost or subscription-limit percentage.

**Verify:** each successful run has exactly one completed turn, a nonempty
final agent message that `parseExtraction` accepts, and a usage record. If
usage is missing, document the installed CLI's exact event shape and stop
claiming a numerical spend result. Do not guess a target token threshold;
compare measured overhead and quality against the same fixture and model.

### 3. Apply only a demonstrated spend/latency fix

If a candidate materially lowers input usage or startup latency without
degrading extraction, add the supported per-run isolation option to
`codex_args` and mirror it byte-for-byte in `runCodex`. Keep `--ephemeral`,
read-only sandbox, JSON, stdin, and the tether. Prefer `--ignore-user-config`
if its measured effect is useful; it preserves `CODEX_HOME` authentication
per the official reference. Do not assume it also suppresses AGENTS.md.
Pin a model/effort only if the measurements show that config isolation
otherwise changes the effective choice and quality checks justify the pin.
If the existing spawn is already economical, make no isolation change.

In either case, have the Rust parser read `turn.completed.usage` and log a
short aggregate token line for Codex, parallel to Claude's existing usage
line. Missing usage must not fail extraction. Unit-test the real JSON shape,
missing usage, final-message selection, failed/incomplete turn, and exact
argument list with and without a selected model. A failed turn must not
return a stale preceding agent message as a successful extraction.

**Verify:** focused `cargo test --lib extractor::tests` passes; Rust and
golden argument lists match. Re-run at most one measured candidate if the
implementation differs from the measured invocation.

### 4. Verify the interactive rollout and card path

Start a fresh Codex session through a human-triggered Logic Loop tab, make
one explicit decision question, and check that a new `rollout-*.jsonl`
exists, lines are delivered, a decision card appears once, no recursive
extractor session is observed, and the terminal/UI remains responsive while
the one-shot call runs. Use only sanitized structural fields from the rollout
for comparison with `textFromTranscriptLine`. Distinguish a missing rollout,
missing hook/tailer delivery, parser miss, extractor failure, and UI failure.
Check the warning strip, but do not treat its silence as proof of inner-payload
compatibility. Record elapsed card latency and actual per-call usage log.

If the live payload shape differs, add a redacted current-shape fixture and
focused parser check before changing `decisions.ts`. Extend the existing
tripwire only if a repeatable inner-shape mismatch can be distinguished from
ordinary tool/reasoning-only response items without noisy false warnings.
If no rollout file appears, document the result as a separate PTY/session
finding and stop that branch rather than changing PTY code in this plan.

**Verify:** `npm run codex-transcript:check` and
`npm run decision-integrity:check` pass, and record the manual outcome in
`docs/TESTING.md`. A card tied to the correct session is the acceptance
signal; a quiet warning strip alone is insufficient.

### 5. Run relevant gates and record the verdict

Run the focused checks above first, then `npm run opencode:check`,
`npm run check`, `npx tsc --noEmit`, `npm run build`,
`cd src-tauri && cargo test --lib`,
`cd src-tauri && cargo clippy --all-targets -- -D warnings`, and
`git diff --check`. Record measured before/after values, model/effort,
CLI version, call count, latency, extraction result, and any remaining
uncertainty. State explicitly whether Codex had a Claude-like spend problem.

Repository guidance says **do not run `npm run golden` unless extraction
prompts changed**. This plan changes no prompt, so do not run the 14-call
`EXTRACTOR=codex npm run golden` suggested by Plan 019. The bounded fixture
and live round-trip above provide the Codex quality check. If a prompt change
becomes necessary, use the golden gate then and record its additional spend.

## Done criteria

- [x] A measured `turn.completed.usage` baseline and latency for the actual
      Sidebar LM Codex spawn are recorded, or a precise reason usage was
      unavailable is recorded.
- [x] At most three initial successful billed measurement calls were made.
- [x] The chosen model/effort, input vs cached input, output, call count, and
      extraction validity are documented without private content.
- [x] Any proven isolation fix is mirrored in production and golden args;
      otherwise the unchanged spawn is explicitly justified by measurement.
- [x] Codex usage is logged without making missing usage a terminal failure.
- [x] A fresh interactive Codex session yields the correct card once, or the
      precise failed layer is isolated and recorded as a new finding.
- [x] Focused checks and applicable gates pass; manual result is in
      `docs/TESTING.md` and status is updated in `plans/README.md`.

## STOP conditions

- Required phase acceptance is absent for implementation or billed live tests.
- Installed CLI flags or event schema differ from the documented assumptions.
- The paired runs use different effective models/efforts or authentication.
- A candidate isolation flag causes auth failure, unexpected tool execution,
  invalid extraction, or a material quality regression.
- A fix requires global/system configuration changes, PTY changes, or a new
  monitoring subsystem; return a separate, scoped proposal.

## Measured results

Phase 34 measured exactly two successful billed calls on 2026-09-12, both
using `tests/golden/01-single-answered.json`'s real `buildPrompt` output from
the app's working directory and extractor tether. No prompt, model output, or
raw JSONL was retained. The current Sidebar LM backend was `claude`; its
optional Codex-model override was blank, so the baseline inherited the local
Codex config's `gpt-5.6-terra` / `high` model and reasoning effort. The app
and shell resolve `/opt/homebrew/bin/codex` (Codex CLI 0.154.0).

| run | arguments beyond shared app args | input | cached input (included in input) | output | reasoning output | elapsed | structural result |
|---|---|---:|---:|---:|---:|---:|---|
| baseline | none — exact app args | 16,756 | 5,888 | 52 | 0 | 5.36s | one `thread.started`, one `turn.started`, one `item.completed` agent message, one completed turn; no tool/MCP item; strict extraction valid (one decision) |
| paired isolation | `--ignore-user-config -m gpt-5.6-terra -c model_reasoning_effort="high"` | 15,139 | 9,984 | 52 | 0 | 4.36s | same one-turn, no-tool, strict-valid result |

`--ignore-user-config` reduced reported input by 1,617 tokens (9.6%) and wall
time by about 1.0s for this fixture, so configured MCP/user context has some
fixed effect, but it is not a Claude-like 40x issue. The isolation call needed
explicit model and reasoning-effort settings to keep the comparison valid. The
persisted Sidebar model override is intentionally blank, which means
production `--ignore-user-config` would silently stop honoring the user's
configured model/effort. No isolation flag was shipped: preserving that user
choice needs a separately scoped setting decision, not a hardcoded model.

The shipped safe hardening is independent of that choice: the Rust extractor
now logs `turn.completed.usage` as input, cached input, output, and reasoning
output tokens; missing usage remains non-fatal. It also rejects failed or
incomplete turns instead of returning a preceding agent message. The golden
runner applies the same completed/failed-turn contract. Focused extractor
tests, `npm run codex-transcript:check`, `npm run opencode:check`, `npm run
check`, `npx tsc --noEmit`, `npm run build`, `cargo test --lib` (63/63), and
`cargo clippy --all-targets -- -D warnings` pass. `npm run golden` was not
run because extraction prompts did not change.

Official non-interactive-mode documentation confirms the observed JSONL
`turn.completed.usage` event and both isolation flags. The current rollout-
format compatibility result now has a healthy current-shape live check. In a
fresh `npm run tauri dev` Codex session, a real assistant choice prompt made
one card reliably at roughly four seconds. Ordinary reply handling left it
open as designed; Answer-Now closed it immediately, manual dismissal worked,
and the terminal/UI stayed responsive. The card proves a current rollout line
traveled through the tailer and extractor. The dev log recorded three Codex
usage lines for those observed calls: `16744/5888/108/70`,
`19262/5888/14/0`, and `16741/5888/35/0` (input/cached-input/output/reasoning-
output). No recursive extractor behavior was observed. The warning strip was
not separately inspected in this pass.
