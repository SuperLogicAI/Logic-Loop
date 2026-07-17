# Logic Loop — Post-Phase-4 Roadmap

Adopted from competitive research (internal codename: Waypoint study). Every
feature below is grounded in the cognitive map (build plan §2), not in any
competitor's implementation. No external code was used or referenced in this
codebase; concepts only, re-derived against our architecture invariants.

## Sequencing

| Item | Slot | Size | Depends on |
|---|---|---|---|
| Event epoch guard | Now (spine correctness bugfix) | 0.5d | — |
| Tab tether | Phase 5 | 0.5d | — |
| Re-entry | Phase 5 | 1d | Tab tether |
| Unclaimed results | Phase 5 | 1d | — |
| Nudges | Phase 5 | 0.5d | Unclaimed results |
| Versioned hook contract | Phase 5 (hardening) | 1h | — |
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

## Isolated loops — v1.1 (unchanged from spec non-goals)

New-tab flow: "isolate this loop" → `git worktree add` under
`~/.context-terminal/worktrees/<project>/loop-<n>`, branch `loop/<user-slug>`
(user names the loop — no generated names), tab bound to worktree path.
Tab close prompts for cleanup; never auto-deletes.

## Adapters — v2

Codex / Gemini / Copilot expose native hook or extension systems, so
multi-agent support never requires screen parsing (invariant #1 survives).
Zero build work now; standing design constraint: keep `events.type` and
payloads agent-agnostic — Claude-specific knowledge stays inside ingestion.
