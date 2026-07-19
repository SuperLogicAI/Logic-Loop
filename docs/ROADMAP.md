# Logic Loop — Post-Phase-4 Roadmap

Adopted from competitive research (internal codename: Waypoint study). Every
feature below is grounded in the cognitive map (build plan §2), not in any
competitor's implementation. No external code was used or referenced in this
codebase; concepts only, re-derived against our architecture invariants.

## Sequencing

| Item | Slot | Size | Depends on |
|---|---|---|---|
| Event epoch guard | DONE | 0.5d | — |
| Project identity | DONE (Phase 5) | 0.5d | — |
| Tab tether | DONE (Phase 5) | 0.5d | — |
| Versioned hook contract | DONE (Phase 5) | 1h | — |
| Re-entry | Phase 6 | 1d | Tab tether |
| Unclaimed results | Phase 6 | 1d | — |
| Nudges | Phase 6 | 0.5d | Unclaimed results |
| Isolated loops (worktrees) | v1.1 | — | Tab tether |
| Adapters (non-Claude agents) | v2 | — | Versioned hook contract |

Phase boundaries still hard stops. Phase 5 items enter PLAN.md for approval
before build, per process rules.

## Event epoch guard — bugfix, do now

Late subagent completion events (e.g. `SubagentStop` firing after the main
turn's `Stop` — Claude Code recap/away-summary can do this) must never flip a
session back to `WORKING`. Rule: per-session monotonic epoch; only
human-initiated turn starts (`UserPromptSubmit`, `PreToolUse` in a fresh turn)
open a new epoch. Completion events from an older epoch are still appended to
`events` (spine stays append-only) but skip state transitions.

- Tests: event-sequence unit tests (`Stop → SubagentStop` stays IDLE; dup
  events don't double-transition). Gates: cargo test, golden 12/12.

## Project identity — Phase 5, do early

Panels key every row on a raw cwd string, so one project splits into several
SQL keys and each fragment shows a partial view. Found 2026-07-18 while
debugging the Phase 4 residue panel.

Two causes, one fixed:

1. **Case / path spelling** (FIXED 2026-07-18). macOS is case-insensitive:
   `Desktop/Dev/x` and `Desktop/dev/x` open the same folder, are different SQL
   keys. `pty::canon()` now canonicalizes at tab open + bookmark add, so tab
   cwds agree with the cwd hooks report. Unit test in `pty.rs`.
2. **Subdirectory splitting** (FIXED 2026-07-19, Phase 5). `cd src-tauri && claude`
   files against a different project than running claude from the repo root.
   Observed live: `context_terminal` (5 blockers / 11 decisions),
   `context_terminal/src-tauri` (2 / 1), and `dev/context_terminal/src-tauri`
   (2 / 0) are three separate projects today. Same for `super_cowork` and
   `NSSA_2026` with their subdirs.

Fix: derive a stable project key by walking up to the nearest `.git` (fall
back to the cwd itself when not in a repo). Applies to tab cwd AND the hook
cwd on the ingestion side — both must resolve identically or the split
returns. This redefines "project" app-wide, hence a phase item, not a patch.

- Not solved by Tab tether: the tether fixes session→tab binding; the project
  key stays cwd-derived either way.
- Decided 2026-07-18: pre-fix rows stay orphaned, no merge migration. They're
  mostly Phase 1–4 test noise, blockers/decisions self-obsolete, and a
  case-only merge wouldn't have touched the dominant subdir split anyway.
- Also seen: one `notes` row keyed `~ /Desktop/superlogicai_IO` — literal
  unexpanded tilde-space. RESOLVED 2026-07-19: `notes.id=6`, written
  2026-07-15, three days before `canon()` landed. Root cause was a bookmark
  cwd typed with a space after the `~`, which `expand()` passed through raw
  because it only matches a literal `~/` prefix. Closed by canon running at
  tab open — no live write path produces it. Row left orphaned per the
  no-migration decision above.
- Test: run claude from a repo root and from a subdir → both file against the
  same project; panel counts don't split.

## Tab tether — Phase 5

Spawn each PTY with `LOGIC_LOOP_TAB_ID=<uuid>`. Hooks inherit the env and
include it in their POST payload. Ingestion binds session→tab by tether;
cwd matching demoted to fallback. Replaces the known-fragile binding function.

- Test: two tabs, same cwd, sessions bind to the correct tabs.

## Re-entry — Phase 5

Failure mode: re-entry friction / state reconstruction (§2). The agent's own
context is the biggest state store we currently throw away on quit.

- Migration (new, numbered): `session_bindings` (tab_tether, claude_session_id,
  transcript_path, cwd, project_id, updated_at). Populated from `SessionStart`
  hook payload.
- Dead tab / app relaunch: tab renders a **Re-enter** button; click respawns
  the PTY with `claude --resume <session_id>` as the launch command.
- Invariant #4 intact: spawning a process at tab start is bookmark-equivalent;
  the app never types into a live terminal. Human clicks.
- Exit criterion: quit with 3 live sessions, relaunch, all 3 re-enter with
  full agent context.

## Unclaimed results — Phase 5

Failure mode: progress blindness (§2). An agent finishing while you're
elsewhere is a result nobody has claimed; the tab must say so at a glance.

- `Stop` while tab unfocused (or app unfocused) → append `result_landed`
  event. Tab gains focus → append `result_claimed`. Append-only; tab-state
  view derives `DONE` (unclaimed) vs `IDLE` (claimed).
- Focusing claims. Un-focusing never un-claims.
- UI: green dot + soft glow until claimed; Accomplished panel headlines
  unclaimed items on re-entry.

## Nudges — Phase 5

Failure mode: non-viable switches — paying attention cost to *discover* an
agent needs you.

- Tauri notification plugin. Fire on transition to `WAITING_ON_YOU` and
  `DONE`, only when that tab is not focused-and-visible.
- Per-project mute in settings. Fail-open: notification failure never touches
  ingestion (invariant #2).
- OS-notification behavior is a manual test → docs/TESTING.md.

## Versioned hook contract — Phase 5 hardening

Add `"v": 1` to hook POST payloads and a version marker in the
settings.json hook entry we write. Ingest logs-and-ignores unknown versions.
Byte-identical-reversal tests must stay green.

## Spec-file detection — Phase 6+ candidate

From neurophysica/claude-workflow-template: convention where the unit of work
is a spec file under `docs/dev/specs/`. Machine-detectable — if a project uses
this pattern, re-entry / unclaimed-results panels could link sessions and
decisions to the spec file that drove them (richer anchor than the raw prompt).
Cheap: path convention + panel query, no new ingestion. Their
"superseded, never edited" decision-log rule also maps cleanly onto our
append-only decisions table — surfacing supersedes-links in the decisions
panel is a related idea.

## Isolated loops — v1.1 (unchanged from spec non-goals)

New-tab flow: "isolate this loop" → `git worktree add` under
`~/.context-terminal/worktrees/<project>/loop-<n>`, branch `loop/<user-slug>`
(user names the loop — no generated names), tab bound to worktree path.
Tab close prompts for cleanup; never auto-deletes.

## Split-pane tabs — v1.x UI

Chrome-style side-by-side panes inside one tab, so two agent CLIs are
visible at once (e.g. Claude + Codex on the same project). Pure xterm.js
layout work — no ingestion or schema changes. Note WebGL landmine: only one
pane gets the WebGL addon; the other uses DOM renderer.

## Adapters — v2 (multi-agent observation)

Positioning (decided 2026-07-19): Logic Loop observes heterogeneous agents;
it does not orchestrate them. Agent-to-agent collaboration is already free —
OpenAI's codex-plugin-cc runs inside any Claude Code session in a tab
(adversarial review, delegation). Building our own cross-agent orchestration
would duplicate that and violate invariant #4. The differentiated product is
one pane of glass over a mixed agent fleet.

Adapter order:
1. **OpenCode** first — real plugin/event API, client-server architecture,
   built to be scripted. Richest semantic surface after Claude.
2. **Antigravity** second, shallow — its statusline scripts receive a JSON
   payload on stdin (`agent_state`, vcs, context usage). A forwarder script
   (exit 0, fail open) gives presence/momentum signals only; no per-tool
   events or transcript equivalent yet. Deep panels wait for real hooks.
3. Codex / Gemini / Copilot as their hook/log surfaces mature.

Standing design constraint unchanged: keep `events.type` and payloads
agent-agnostic — agent-specific knowledge stays inside ingestion; never
screen parsing (invariant #1 survives).
