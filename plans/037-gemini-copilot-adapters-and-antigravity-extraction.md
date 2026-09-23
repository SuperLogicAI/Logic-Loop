# Plan 037: Gemini + Copilot adapters, and Antigravity decision extraction

> Supersedes this file's original content (a "land the Antigravity re-entry
> branch" plan that turned out moot before any code was written — Agy 003/004
> were already merged to `main` via PR #32 on 2026-09-16; see git history of
> this file if that record is needed). Swapped 2026-09-21 for three scoped
> items: two new adapters and one bounded feature on an existing adapter.

## Status

CANDIDATE — not implemented or approved. P1/P2 mixed (see per-item status
below); effort **L overall** — each new adapter is "Codex/OpenCode-sized,
not a small patch" per this repo's own standing guidance
(`docs/IDEAS.md`'s Prime Agent entry), and neither CLI is installed on this
machine, so build cannot start before a live spike installs and probes the
real binary. Antigravity decision extraction is smaller and its blocker is
already fully understood (see Part C). Depends on: none blocking; all three
items are independent of each other and can be built/landed in any order or
split into separate PRs even though tracked in one plan file.

**Planned at**: `main` `e8d37e4`, 2026-09-21. Neither `gemini` nor `copilot`
CLI is installed on this machine as of drafting (`which gemini` /
`which copilot` both empty); `~/.copilot/config.json` exists (no
`settings.json`), suggesting an older or partial prior install — do not
treat that as evidence the hooks contract below is live-verified. All
contract details in Parts A and B come from Context7-fetched upstream docs
(`/google-gemini/gemini-cli`, `/github/copilot-cli`), not from a live
probe. This repo has hit real doc-vs-live drift on every adapter built so
far (Codex hook trust, Antigravity `PostToolUse` merge bug and
`PreInvocation` firing count, both in `docs/LANDMINES.md`) — treat every
contract fact below as "docs say," gated by Step 0/1 in each part before
any hook-registration code ships.

## Why this matters

`docs/ROADMAP.md` has carried "Remaining adapters (Gemini, Copilot) — v2"
with no plan behind it since the adapter-order section was written. Four
adapters are live (Claude, OpenCode, Codex, Antigravity); Gemini and
Copilot are the two mainstream CLIs still unaddressed. Antigravity
decision extraction is explicitly deferred in
`plans/Antigravity_Implementation_Plans.md`'s rejected-findings section —
correctly deferred as "a separate product feature, not a prerequisite for
stable lifecycle integration," but never actually scheduled once lifecycle
integration shipped. Antigravity is the only live adapter besides OpenCode
with no decision/blocker extraction at all.

---

# Part A: Gemini CLI adapter

## Status

P1. Real hook contract confirmed via upstream docs (`/google-gemini/gemini-cli`,
fetched 2026-09-21): `docs/hooks/index.md`, `docs/hooks/reference.md`,
`docs/hooks/writing-hooks.md`. Not live-verified — `gemini` is not
installed here.

## What the docs say (unverified against a real process)

- Hook events: `SessionStart`, `BeforeAgent`, `BeforeToolSelection`,
  `BeforeTool`, `AfterTool`, `AfterModel`, `AfterAgent`, `SessionEnd` —
  richer than Claude's set and structurally close to it (matcher groups of
  `{name, type: "command", command, timeout}`, same shape Antigravity and
  Codex already use).
- Base hook input schema (all events): `session_id`, `transcript_path`
  (absolute path to a session transcript **JSON** file — note: JSON, not
  necessarily JSONL; unconfirmed), `cwd`, `hook_event_name`, `timestamp`.
  This is the richest transcript signal of any adapter besides Claude
  itself if it holds up live — worth checking whether decision extraction
  could reuse the existing Claude transcript-reading path rather than
  needing bespoke parsing.
- Settings/hook config resolves through four layers, highest precedence
  first: project `.gemini/settings.json`, user `~/.gemini/settings.json`,
  system `/etc/gemini-cli/settings.json` (or platform equivalent),
  extension-provided hooks.
- Non-interactive mode: `gemini -p "<prompt>"` — a `claude -p`/`codex exec`
  analog, relevant both for PTY resume investigation and as a possible
  future Sidebar-LM extractor backend (out of scope here, note only).

## The landmine to verify before writing any install code

**`~/.gemini/` is not neutral ground.** Antigravity's own CLI already lives
at `~/.gemini/antigravity-cli/` on this machine (confirmed:
`ls ~/.gemini` shows `antigravity`, `antigravity-cli`, `antigravity-ide`,
`config`, plus account/oauth files) and Logic Loop's existing
`antigravity.rs` already owns `~/.gemini/config/hooks.json` for Antigravity's
own hook registration (`docs/LANDMINES.md`). A real Gemini CLI install's
user settings file — `~/.gemini/settings.json` per the docs above — is a
sibling path in the same directory tree, not the same file, so it should
not collide on disk. But the product relationship (Antigravity appears to
be built on the Gemini CLI codebase, sharing `~/.gemini/`) means it is not
safe to assume the two hook systems are fully independent processes with
no shared state, shared settings inheritance, or shared session identifiers
— that must be live-checked, not assumed, before this adapter's setup code
writes anything under `~/.gemini/`.

## Current state

No Gemini code exists (`src-tauri/src/gemini.rs` does not exist). Adapter
count in `README.md`'s table would go from 4 to 5. `src-tauri/src/lib.rs`
wires each adapter's `apply_setup`/`translate`/hook-status functions in
alongside `mod antigravity;` etc.

## Scope

**In scope**: new `src-tauri/src/gemini.rs` (mirroring `antigravity.rs`'s
shape: `HOOK_NAME`, event set, `apply_setup`, `translate`,
`*_hooks_status`), `src-tauri/src/lib.rs` (module wiring), `src/lib/repo.ts`
(`VERB` map entries once tool names are known), `src/App.tsx` (agent
recognition, same pattern as the other three), `src/components/AgentStatusBar.tsx`
(toggle + tooltip), `docs/TESTING.md`, `README.md`'s adapter table,
`docs/ROADMAP.md`.

**Out of scope**: decision extraction for Gemini on this first pass (land
lifecycle/activity parity first, matching every prior adapter's own
sequencing — Claude got extraction because it was the reference adapter,
Codex got it as a Phase 16 follow-up, not on adapter day one); PTY resume
(follow Antigravity's own sequencing — ship lifecycle first, re-entry as a
later, separately-gated plan); using `gemini -p` as an extractor backend.

## Steps

### Step 0 (gate — do not skip): Install and live-probe

Install `gemini` CLI. Run one real multi-turn session with a temporary,
isolated test hook registered for every event in the docs' list, logging
raw stdin to a file, printing `{}` on stdout. Confirm: (a) none of the
`Before*` events block, deny, or measurably stall the agent loop under a
slow (3s sleep) or malformed (empty stdout) response — same class of check
Antigravity's Plan 001 Step 1 required, for the same reason; (b) the actual
firing count/order per turn (does `BeforeAgent` fire once per turn the way
`SessionStart` fires once per session, matching the docs' implication, or
does anything fire multiple times per turn the way Antigravity's
`PreInvocation` surprisingly did?); (c) `transcript_path`'s real format —
open the file, confirm JSON vs JSONL and whether message content is
present verbatim or redacted/summarized; (d) whether `~/.gemini/settings.json`
already exists from the Antigravity install and, if so, whether adding a
`hooks` key to it is additive-safe or Antigravity's settings file shares
schema/precedence with it in a way that could break Antigravity's own
setup. Record CLI version and every finding in this plan before Step 1.

**If Step 0 shows any `Before*` hook can block/deny/hang**: do not register
that event; fall back to the same timestamp-grace pattern Antigravity's
Plan 001 Step 2b used, and document why.

### Step 1: Build the adapter (shape TBD by Step 0's findings)

Register the event subset Step 0 proved safe. Map to the existing
`hook_event_name` vocabulary (`SessionStart`, `UserPromptSubmit`,
`PostToolUse`, `Stop`, etc.) reusing `stateForHook`'s existing cases —
do not add new frontend state-machine branches unless Step 0 finds a signal
with no existing analog. Normalize tool-field names the way Antigravity's
Agy 002 did, once real tool payload shapes are captured live (not
guessed from docs).

**Verify**: `cd src-tauri && cargo test --lib gemini::tests` — new tests
for setup idempotency, translation, and matcher scoping, using real
captured payload shapes as fixtures (same discipline as `antigravity.rs`'s
test module).

### Step 2: Wire into the frontend and Setup checklist

`App.tsx` agent recognition, `AgentStatusBar.tsx` toggle/tooltip
(accurately describing whatever subset of activity this ships with — do
not claim extraction or re-entry support it doesn't have), Setup detection
for the installed CLI.

**Verify**: `npm run check`; manual — Setup shows Gemini detected, toggle
turns hooks on/off byte-identically on repeat toggling (same idempotency
bar every other adapter meets).

### Step 3: Manual regression and docs

Real multi-turn Gemini session in a Logic Loop tab: tab state transitions
correctly across at least two turns (the exact bug class Antigravity's
Plan 001 existed to fix — check for it here too, don't assume it's absent).
Update `README.md`'s adapter table and `docs/ROADMAP.md`.

**Verify**: full gate list (`tsc --noEmit`, `cargo clippy -D warnings`,
`cargo test --lib`, `npm run check`, `git diff --check`).

## Done criteria

- [ ] Step 0's live findings recorded before any shipped hook registration.
- [ ] A Gemini tab shows correct state across a real multi-turn session.
- [ ] No blocking/denial/hang risk shipped for any registered event.
- [ ] `~/.gemini/settings.json` changes verified not to interfere with the
      existing Antigravity `~/.gemini/config/hooks.json` setup, live.
- [ ] All gates pass.

## STOP conditions

- Step 0 finds any `Before*` event can block/deny/hang — implement the
  grace-window fallback, do not register the blocking event.
- The Antigravity/Gemini shared-`~/.gemini/`-directory check finds real
  interference (e.g. Gemini's settings write clobbers a key Antigravity's
  setup also writes) — stop and redesign the settings-merge logic rather
  than shipping a write that can silently break the existing adapter.
- `transcript_path` turns out not to contain usable message content — note
  it and move on; this plan does not need it for Part A's activity-only
  scope, only future extraction work would.

---

# Part B: GitHub Copilot CLI adapter

## Status

P1. Real hook contract confirmed via upstream docs (`/github/copilot-cli`,
fetched 2026-09-21): `_autodocs/configuration.md`,
`_autodocs/endpoints-hooks.md`, `_autodocs/api-reference/modes-and-features.md`.
Not live-verified — `copilot` is not on `PATH` here, though `~/.copilot/`
exists with a `config.json` (not `settings.json`) — a stale or partial
prior install, not evidence of a working hooks setup.

## What the docs say (unverified against a real process)

- Hook events use **camelCase**, not Claude/Gemini/Antigravity's
  PascalCase: `sessionStart`, `sessionEnd`, `userPromptSubmitted`,
  `agentStop`, `toolCall`. Each is a **single command**, not an array of
  matcher groups — no per-tool matcher scoping at the config level for most
  events.
- `toolCall` is the one event with a `phase` field (`"before"`/`"after"`)
  in its stdin payload instead of being split into separate before/after
  event names — one registration covers both directions. Payload:
  `{event, phase, sessionId, toolName, toolInput, timestamp}`. Response can
  set `block: true` and/or `modifiedInput` — a real blocking decision
  point, useful for a future waiting-signal feature (out of scope here,
  noted for later).
- `sessionEnd`'s doc explicitly states an **epoch quirk of its own**: "In
  piped mode, this hook fires once per completed agent turn rather than
  just at final shutdown" — i.e., the exact Stop-vs-turn-boundary ambiguity
  that drove Antigravity's Plan 001 turn-epoch bug. Expect to need an
  epoch guard here from day one rather than discovering it live the way
  Antigravity did.
- Config file: global `~/.copilot/settings.json`; no project-level hooks
  file documented (project config exists at `.github/copilot.json` but is
  described as general project config, not hooks-specific — confirm live).
- 10 MiB output cap per hook invocation (documented, unusual to call out —
  suggests hook stdout is read fully into memory; irrelevant to a `{}`-only
  response strategy but worth knowing before ever echoing tool output back).
- Non-interactive mode: `echo "..." | copilot -p` / `copilot -p < file` —
  another `claude -p` analog, same out-of-scope note as Gemini's.

## Current state

No Copilot code exists. Same wiring shape as Part A applies
(`src-tauri/src/copilot.rs`, `lib.rs`, `repo.ts`, `App.tsx`,
`AgentStatusBar.tsx`).

## Scope

Same in/out-of-scope split as Part A, substituting `copilot.rs` for
`gemini.rs`. Decision extraction and PTY resume are out of scope for this
first pass here too.

## Steps

### Step 0 (gate — do not skip): Install and live-probe

Install `copilot` CLI (note: `~/.copilot/config.json` already present
suggests a prior install existed — check `copilot --version` first,
upgrade/reinstall if the binary itself is actually missing from `PATH`
despite the config directory). Run a real multi-turn session with a
temporary test hook on every event, same discipline as Part A Step 0:
confirm no blocking/hang on slow/malformed responses for `toolCall`
specifically (it's the one event with response-driven `block`, so it is
the one with real synchronous-hook risk, same category as Antigravity's
`ask_question` `PreToolUse`); confirm the `sessionEnd`-fires-per-turn
behavior the docs already flag, and work out the actual once-per-session
"turn is really over" signal (if any) versus the once-per-turn one;
confirm whether any transcript/session-log file exists on disk at all (the
docs excerpts fetched here did not surface one — if none exists, Copilot
has no future extraction path without deeper investigation, note that
plainly rather than assuming).

**If Step 0 shows `toolCall`'s response can hang the agent on a slow or
malformed reply**: do not respond beyond `{}`/no block; if even that risks
blocking, do not register `toolCall` at all and ship activity-blind (tab
state from `sessionStart`/`sessionEnd`/`userPromptSubmitted` only) rather
than risk a hung terminal.

### Step 1: Build the epoch-safe adapter

Given the pre-known `sessionEnd`-per-turn quirk, design the epoch guard
alongside the initial build rather than as a Phase-16-style follow-up
patch — reuse the general grace-window pattern from Antigravity's Plan 001
Step 2b if Step 0 confirms the same shape, rather than re-deriving it.

**Verify**: `cd src-tauri && cargo test --lib copilot::tests` — setup
idempotency, translation, and specifically a multi-turn epoch test proving
turn 2 doesn't read as still-stopped.

### Step 2 & 3: same shape as Part A's Step 2/3

Frontend wiring, Setup detection, manual multi-turn regression, docs.

## Done criteria

Same shape as Part A, substituted for Copilot; plus: the `toolCall`
blocking-response risk is explicitly resolved (registered-safe, or not
registered at all) before any shipped code, not deferred.

## STOP conditions

Same shape as Part A; plus: `copilot --version` shows no real install path
forward on this machine or account (e.g. requires a paid seat/token not
available) — report and park this half of the plan rather than guessing at
undocumented behavior.

---

# Part C: Antigravity decision/blocker extraction

## Status

P2. Smaller and better-understood than Parts A/B — the blocker is a known,
named gate in existing code, not an unknown CLI contract.

**Phase 41 approved 2026-09-22.** Part C's Step 1 gate passed live on agy
1.2.8, and Steps 2–3 are built on `feat/antigravity-decision-extraction`.
Automated checks pass; the real in-app Decisions-card check remains open.
This supersedes the 2026-09-21 quota pause below for Part C only.

**Blocked 2026-09-21**: `agy` quota exhausted, ~41h cooldown reported by the
maintainer. Step 1 needs a real live Antigravity session, so it cannot be
delegated to another adapter — parked until cooldown clears.

**Correction, same day:** the earlier note here about running Parts A/B's
handoff prompts via OpenCode instead is retracted. The maintainer wants
Agy itself running all three parts of this plan once quota resets, for
accuracy — not delegated to a different coding agent mid-plan. **All of
Plan 037 (Parts A, B, C) is paused, not just Part C**, until Agy's cooldown
clears. See Plan 038 for the OpenCode-focused work picked up in the
meantime.

## Why this matters

Every live adapter except OpenCode and Antigravity supports decision/
blocker extraction (`README.md`'s table). Antigravity already sends
`transcript_path` on relevant events (`antigravity.rs:279`) — the adapter
itself is not the blocker. `src-tauri/src/ingest.rs`'s `is_transcript_path`
(line ~144) is: `Some(_) => false` for every agent except `None` (Claude)
and `"codex"`, by explicit design — the doc comment above it warns "An
ungated tailer call here would tail arbitrary files and can self-amplify
through agent subprocesses." This is exactly the "deliberate, reviewed
widening rather than a drive-by change" the Antigravity plans file already
flagged as the real prerequisite.

## Current state

- `src-tauri/src/ingest.rs:144-152` — `is_transcript_path`; Antigravity
  falls through to `Some(_) => false`.
- `src-tauri/src/antigravity.rs:279` — `transcript_path` already populated
  on the relevant translated payloads.
- Step 1's real agy 1.2.8 probe confirmed an append-only JSONL file at
  `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/
  transcript_full.jsonl`. `USER_INPUT` carries the submitted text inside
  `<USER_REQUEST>`, alongside injected metadata; completed
  `PLANNER_RESPONSE.content` carries the visible assistant reply. The
  second turn appended to the same file. See `docs/TESTING.md`.
- `src-tauri/src/extractor.rs` — existing Claude/Codex extraction path;
  reuse its shape, don't fork a parallel pipeline.

## Scope

**In scope**: `src-tauri/src/ingest.rs` (widening `is_transcript_path` for
`"antigravity"`, scoped to Antigravity's actual transcript directory the
way `is_codex_rollout_path` scopes Codex's — not a blanket allow),
`src-tauri/src/antigravity.rs` (if the transcript format needs
adapter-specific parsing before feeding the shared extraction path),
`src/lib/decisions.ts` (the shared JSONL envelope reader and drift tripwire),
`docs/TESTING.md`.

**Phase 41 scope clarification:** `src/lib/onboarding.ts` and its existing
checks are also required to flip Antigravity's decision capability once
extraction is enabled. Without it, Setup and the Decisions empty state would
continue to say the feature is unavailable. `README.md` is required by
Step 3's documentation. No adapter installer or terminal behavior changes.

**Out of scope**: any change to Claude/Codex/OpenCode extraction; any
relaxing of invariant #5 (transcript content stays untrusted data, never
instructions) — extraction prompts must treat Antigravity transcript
content with the exact same untrusted-data handling Claude/Codex already
get, no exceptions for a "simpler" adapter.

## Steps

### Step 1 (gate): Live-read a real Antigravity transcript file

**Passed live 2026-09-22.** A fresh agy turn and a re-entered turn produced
five append-only lines in one `transcript_full.jsonl`: two `USER_INPUT`, two
completed `PLANNER_RESPONSE`, and one `SYSTEM_MESSAGE`. Earlier lines stayed
unchanged, and no duplicate `step_index` or `RUNNING` planner rewrite was
observed. Read-only replay through the new parser recognized all five lines,
extracted the four visible messages, and ignored the system line.

Run a real Antigravity session, locate the file at the `transcript_path`
a live hook event actually reports, and read it directly (not through any
new code) to determine: format (JSON array vs JSONL), whether user/
assistant message text is present verbatim, and the real on-disk directory
shape (needed to scope the `is_transcript_path` widening precisely, the
same way Codex's path gate checks `.codex/sessions/<year>/<month>/<day>/
rollout-*.jsonl` rather than trusting any path string). Record findings
before Step 2.

**If the transcript has no usable message content** (e.g. only tool-call
metadata, matching the hook-payload-level stripping already documented in
`docs/LANDMINES.md` for `PostInvocation`): stop here and report — this
plan is not viable under Antigravity's actual on-disk contract, same as
any other STOP-and-report finding in this repo's adapter work.

### Step 2: Scope-widen `is_transcript_path` and wire extraction

Add an `"antigravity"` arm to `is_transcript_path`, scoped to the real
directory shape found in Step 1 (mirroring `is_codex_rollout_path`'s
structure, not a bare substring match). Wire the existing extraction path
(`extractor.rs`) to read Antigravity transcripts the same way it reads
Claude/Codex ones, adding format-specific parsing only if Step 1 found a
different shape than Claude's JSONL.

**Verify**: `cd src-tauri && cargo test --lib` — new tests for the scoped
path gate (accepts real Antigravity transcript paths, rejects everything
else, mirroring `transcript_paths_are_agent_scoped`'s existing coverage
style).

### Step 3: Manual verification and docs

Real Antigravity session with an actual open question/decision in it;
confirm the Decisions panel surfaces it the way it does for Claude/Codex.
Update `README.md`'s adapter table (Antigravity's extraction column goes
from `—` to `✅`) and `docs/TESTING.md`.

**Verify**: full gate list, plus `npm run golden` **only if** an extraction
prompt change was actually needed (Step 1's findings decide this — don't
run it speculatively).

## Done criteria

- [x] Step 1's live findings recorded (format, directory shape, message
      content presence) before any shipped parsing code.
- [x] `is_transcript_path` widening is scoped to Antigravity's real
      directory structure, not a blanket allow.
- [ ] A real Antigravity session's open question surfaces in the Decisions
      panel.
- [ ] Invariant #5 (untrusted transcript content) holds — no new prompt
      injection surface introduced.
- [ ] All gates pass.

## STOP conditions

- Step 1 shows no usable message content in the transcript file — close
  this part as not viable under the current `agy` contract, do not ship
  partial/misleading extraction.
- Scoping the path gate would require trusting an unscoped or
  easily-spoofable path shape — narrow further or stop, matching the
  Codex precedent's own care here.

---

## Execution contract (applies to all three parts)

This is a candidate draft, not authorization. First read AGENTS.md,
CLAUDE.md, CONTRIBUTING.md, and this file in full. Confirm current phase
acceptance; each part gets its own live-verification gate before any code
for that part ships — a pass on Part A's Step 0 does not authorize
skipping Part B's or Part C's. Use isolated `feat/<slug>` branches per
part so a STOP on one part doesn't block landing the others. Never run
`npm run golden` speculatively. Match existing conventional commit style.

Keep Tauri v2/Rust/portable-pty/React/strict TypeScript/Tailwind/xterm/
SQLite. All DB access through `src/lib/repo.ts`, migrations new and
numbered, structured semantics only, PTY bytes untouched, no autonomous
terminal input. Agent/transcript text is untrusted (invariant #5 — applies
with extra weight to Part C, which is the whole point of that part's
scope guard). Hooks/panels fail open (invariant #2). Never treat a
Context7-fetched doc excerpt as equivalent to a live-verified fact — every
contract detail in Parts A and B is explicitly flagged "docs say" for this
reason, and this repo has been burned by doc-vs-live drift on every
adapter built so far.

## Final acceptance and stop rules

- Each part's own Done criteria and STOP conditions govern that part
  independently.
- `git diff --name-only` per part stays within that part's listed scope
  plus this plan file, `plans/README.md`, `docs/ROADMAP.md`,
  `docs/TESTING.md`.
- Record real manual/live evidence (CLI versions, dates, actual payload
  excerpts) in `docs/TESTING.md` — no part is "DONE" on gate-passing alone
  given this repo's adapter history.
- Report and stop for: missing phase approval, unavailable CLI/account
  access, a live finding that contradicts this plan's assumptions, or any
  required scope expansion — propose a plan revision rather than silently
  widening scope.
