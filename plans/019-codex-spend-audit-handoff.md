# Handoff to GPT/Codex — audit the Codex CLI backend for the same landmines Claude's had

## Why this document exists

This repo (Logic Loop) lets a user pick a backend for its Decision Tracker's
extraction call in **⚙ Sidebar LM**: `claude`, `codex`, or `lmstudio`. Since
Phase 33 landed, a long chain of live debugging on the **Claude** backend
found and fixed a series of expensive, silent failure modes — a 40x token
overspend, an app-wide UI freeze, and a silent extraction outage. All of it
was found by instrumenting and live-testing the Claude path specifically.
**Nobody has done the equivalent audit on the Codex path.** The maintainer
is bringing in a GPT/Codex-based coding session (this one) to do that half,
because you have better native insight into the actual `codex` CLI's flags
and behavior than a Claude-based session does.

This document is a complete briefing so you don't have to rediscover any of
this from scratch. It's organized as: what broke on Claude's side (context,
skip if you trust the summary), then a scoped, concrete list of what to
actually go verify/fix on Codex's side.

## Where the Codex backend lives in this repo

- `src-tauri/src/extractor.rs` — `run_extractor`/`run_extractor_blocking`
  dispatches to `codex_bin()`/`codex_args()`/`codex_final_message()` when
  `backend == "codex"`. This is the **headless, one-shot extraction call**
  path — spawns `codex exec --ephemeral --sandbox read-only
  --skip-git-repo-check --json -` per turn, piping a prompt on stdin,
  parsing the final `item.completed`/`agent_message` event from stdout.
- `src-tauri/src/pty.rs` — `resume_command()`'s `Some("codex") =>
  format!("codex resume {sid}; exec {shell} -l")` branch is the
  **interactive session resume** path, unrelated to extraction spend but
  part of the same adapter.
- `src-tauri/src/codex.rs` — installs Codex's own `~/.codex/hooks.json`,
  reusing Claude's `ingest::hook_command()` almost verbatim (Codex's hook
  contract is a near-clone of Claude's).
- `src-tauri/src/ingest.rs` — `is_codex_rollout_path()` gates which files
  get tailed: `~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl`.
- `src/lib/decisions.ts` — `textFromTranscriptLine()` parses Codex's rollout
  lines via `obj.type === "response_item"` with a `payload.role`/`content`
  shape distinct from Claude's `assistant`/`user` envelope.
- `scripts/golden.ts` — `runCodex()` mirrors the same spawn for the golden
  test harness; `EXTRACTOR=codex npm run golden` runs the extraction fixtures
  against the real Codex CLI.

## What broke on Claude's side — summary, most relevant first

### 1. Unstripped child spawn = ~40x overspend (Phase 33.1)

**The bug:** `claude -p` for a ~1-2k character extraction prompt was booting
a *full* Claude Code environment — every configured MCP server's tool
schema, every skill description, CLAUDE.md discovery, the default system
prompt. Measured live via `--output-format json`'s `usage` field:
**57,293 fixed input-side tokens per call**, for a prompt that needed maybe
1,500.

**The fix:** `claude_args()` in `extractor.rs` added `--strict-mcp-config
--tools "" --setting-sources "" --no-session-persistence --system-prompt
"<one line>"`. Cut fixed overhead to **1,402 tokens** (41x). `--bare` was
tried and rejected — it forces API-key auth and breaks OAuth/subscription
logins.

**Codex-side status: UNVERIFIED, this is your #1 job.** `codex_args()`
already has `--ephemeral --sandbox read-only --skip-git-repo-check` — but
**nobody has ever measured what that actually costs**. Grep confirms zero
mentions of Codex token/usage numbers anywhere in this repo's docs. Does
`codex exec` load an `AGENTS.md`, a Codex config file, MCP servers, or any
other fixed context by default the way `claude -p` did? Does `--ephemeral`
already suppress all of that, or does it need its own equivalent of
`--strict-mcp-config`/`--tools ""`? **Find codex's own equivalent of
`--output-format json`'s usage field (or whatever real cost signal it
exposes) and measure a real extraction call's fixed overhead, the same way
Phase 33.1 did for Claude.** If it's already minimal, document that number
so nobody has to re-ask this question. If it's not, fix `codex_args()` the
same way `claude_args()` was fixed, and update
`scripts/golden.ts`'s `runCodex()` to match (mirroring the two in Phase
33.1's own pattern is a requirement here, not optional — the golden runner
drifting from the real app's spawn args is exactly the bug Phase 33.1 fixed
for Claude by making golden mirror `claude_args()` verbatim).

### 2. Guessed reconciliation, removed entirely (Plan 016)

**Not backend-specific, already fully fixed for every backend.** The
Decision Tracker used to re-run extraction on every user reply to guess
whether it answered an older open question — a second LLM call per turn,
on top of extraction. This was removed entirely: `reconcile()` in
`decisions.ts` now only does a deterministic string match (Answer-Now), no
model call, ever, for any backend. **Nothing to do here** — just know this
class of spend (a second per-turn model call) doesn't exist anymore,
Claude or Codex.

### 3. App-wide UI freeze (Plan 017)

**Not backend-specific, already fully fixed, has nothing to do with which
LM backend is selected.** A live `sample` capture during a real ~31s
beachball found the cause: `SidePanel.tsx`'s `reload()` (fired after nearly
every ingested event, any backend) awaits five plain synchronous Tauri
commands (`git_log`, `git_current_branch`, `git_has_changes`,
`git_untracked_files`, `read_board`) that ran on the app's actual
main/event-loop thread by Tauri v2's default. All 15 git-shelling commands
in `pty.rs` (plus `read_board`/`write_board`) are now `async fn` +
`spawn_blocking`. Separately, an unintended `~/.git` had been letting these
commands silently walk up and operate on the whole home directory for any
project without its own `.git` — fixed with a `has_own_repo()` boundary
guard. **Nothing to do here for the Codex path specifically** — this
affects every user regardless of backend, and is already shipped. Only
relevant to you as context: if you're about to investigate something that
*looks* like a Codex-triggered freeze, check first whether it's actually
this class of bug (a slow synchronous Tauri command) before assuming it's
Codex CLI's fault.

### 4. Silent transcript schema drift (Plan 018)

**Partially backend-specific — your #2 job.** Claude Code CLI v2.1.270 was
found live adding new preamble/metadata line types to its local transcript.
First read (mine) wrongly concluded the whole format changed — corrected
same day once a real extraction round-trip proved the actual
`assistant`/`user` message lines were untouched. Real standing risk though,
confirmed by Claude Code's own docs: "[the transcript] entry format is
internal to Claude Code and changes between versions, so scripts that parse
these files directly can break on any release."

**The fix (backend-agnostic infrastructure, already built):**
`transcriptEnvelopeType()` in `decisions.ts` tracks a per-session streak of
transcript lines whose top-level `type` doesn't match any recognized
envelope (`"assistant"`/`"user"` for Claude, `"response_item"` for Codex).
Past 20 consecutive misses, it fires a warning through the existing
`adapterWarnings` UI strip, naming the agent. This mechanism already covers
Codex — the `"response_item"` check has been there since the adapter shipped
(Phase 21).

**What's actually unverified on Codex's side:** does Codex's own rollout
JSONL format carry the same "no compatibility guarantee" risk? Has anyone
checked whether Codex's `response_item`/`payload.type`/`payload.role` shape
(the one `textFromTranscriptLine` parses) has already drifted on a recent
Codex CLI version, the same way Claude's did? **Check Codex's current
release notes/changelog for any transcript/rollout format changes, and run
a real extraction round-trip against your current Codex CLI version to
confirm cards still extract correctly** — the same live verification that
caught (and then corrected) the Claude finding. If Codex's format has
already moved, the tripwire should fire — check the side panel for a
`codex: transcript format doesn't match...` warning during your testing; if
real drift exists but the tripwire doesn't fire, that's a bug in the
tripwire's threshold/logic worth reporting back, not something to
silently patch around.

### 5. Interactive-session PTY oddity (Plan 017 addendum — genuinely unsolved, flagging not assigning)

Separately and still unexplained: a Claude session spawned through Logic
Loop's own PTY wrote **zero** local transcript file, in a directory where an
identical Terminal.app-launched session wrote one fine. Never root-caused —
ran out of runway chasing it. **Worth a quick check on the Codex side too:**
does a Codex session started via `pty_spawn` (a new tab, then typing `codex`
manually — there's no auto-launch, see `pty.rs`'s `pty_spawn`, `launch_cmd`
is fan-out-only) produce a rollout file normally? If Codex doesn't have this
problem, that's useful negative evidence about whether it's a portable-pty
issue in general or something specific to how Claude Code CLI decides to
persist. If Codex *does* have the same problem, that's a stronger signal
worth its own investigation later — don't rabbit-hole on it now, just note
what you find.

## Concrete action items, in priority order

1. **Measure Codex's real fixed-overhead spend** for a `codex exec
   --ephemeral --sandbox read-only --skip-git-repo-check --json -`
   extraction call, using whatever real usage/cost signal the Codex CLI
   exposes (check `codex exec --help`, `--json` output shape, or Codex's own
   docs for a usage/cost field — same rigor as Phase 33.1's
   `--output-format json` measurement for Claude). Document the number,
   whatever it is, in this repo's CLAUDE.md landmines section or a new
   plan file, the same way Phase 33.1's table lives there now.
2. **If overhead is high, strip it** the same way `claude_args()` was
   stripped — find Codex's equivalent flags for "no MCP config", "no tool
   loading", "no session persistence", whatever applies — and mirror the
   change into `scripts/golden.ts`'s `runCodex()` so golden keeps measuring
   what the app actually spends.
3. **Live-verify decision extraction still works end-to-end on Codex CLI**:
   `EXTRACTOR=codex npm run golden`, plus a real interactive test (start a
   Codex session in a Logic Loop tab, ask something that should produce a
   decision card, confirm it appears). If it doesn't, check whether the
   schema-drift warning fired before assuming something else is wrong.
4. **Check Codex's changelog for any recent rollout-format changes** and
   report back either way (clean or drifted) so this doesn't have to be
   re-asked next time someone touches this path.
5. **Spot-check the PTY-transcript-file question** (see §5 above) — quick
   negative/positive check, not a deep investigation.

## What NOT to do

- Don't touch `pty.rs`'s git_* commands, `has_own_repo()`, or anything in
  `SidePanel.tsx`'s `reload()` — that freeze fix is done, backend-agnostic,
  and live-confirmed. Re-touching it without a new, specific finding would
  just be scope creep.
- Don't re-add any form of guessed/automatic reconciliation — Plan 016
  removed it deliberately after live-testing showed it wasn't load-bearing
  and was the source of two separate bugs. If Codex-side testing tempts you
  toward "let's guess whether this reply answers an old question," don't —
  raise it with the maintainer first.
- Don't invent a new spend-tracking subsystem, changelog-watching agent, or
  monitoring service for this. If you find Codex needs an evergreen
  drift-detection mechanism, the precedent already exists
  (`transcriptEnvelopeType()`, Plan 018) — extend that pattern, don't build
  a parallel one.

## Where to write up what you find

This repo tracks work like this as numbered files in `plans/` (see
`plans/013` through `plans/018` for the exact style — root cause, what was
measured, what was fixed, verification checklist) plus a summary entry in
`CLAUDE.md`'s "Phase status" section and `plans/README.md`'s index table.
Follow that convention for whatever you find and fix here — call it
Plan 020 (019 is this document) or whatever the next free number is by the
time you get to it.
