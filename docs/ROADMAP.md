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
| Events dedupe key | DONE | ~2h | — |
| Re-entry | Phase 6 | 1d | Tab tether |
| Unclaimed results | Phase 6 | 1d | — |
| Nudges | Phase 6 | 0.5d | Unclaimed results |
| Recursive fan-out spawn (RAH) | DONE (Phase 7) | 2d | Tab tether, Versioned hook contract |
| OpenCode adapter | DONE (Phase 8) | — | Versioned hook contract |
| Isolated loops (worktrees) | Phase 9 candidate (was v1.1) | — | Tab tether |
| Model traffic panel (Safe Router) | Phase 9 candidate | 1d | External: Safe Router v0 log |
| Codex adapter | v2, next up | — | OpenCode adapter |
| Remaining adapters (Antigravity, Gemini, Copilot) | v2, after Codex | — | Codex adapter |

Phase boundaries still hard stops. Phase 5 items enter PLAN.md for approval
before build, per process rules.

**Adapter prep docs (2026-08-23):** `Coding Harness Docs/` (untracked,
project root) holds `Open Code/` — 5 files, CLI/SDK/rules/ACP/formatters,
already consumed for Phase 8 — and `Deepseek Harness/`, which turned out on
inspection to be one unrelated academic PDF ("A Programming Paradigm for
Spatiotemporal Composability"), not Deepseek CLI/hook material. No Deepseek
adapter is planned; that folder is misfiled, not a roadmap item. No Codex
prep docs exist yet — needed before that PLAN.md can be written (same bar
OpenCode's docs cleared for Phase 8: hook/event API shape, not ANSI
parsing, per invariant #1).

## Event epoch guard — bugfix, do now

Late subagent completion events (e.g. `SubagentStop` firing after the main
turn's `Stop` — Claude Code recap/away-summary can do this) must never flip a
session back to `WORKING`. Rule: per-session monotonic epoch; only
human-initiated turn starts (`UserPromptSubmit`, `PreToolUse` in a fresh turn)
open a new epoch. Completion events from an older epoch are still appended to
`events` (spine stays append-only) but skip state transitions.

- Tests: event-sequence unit tests (`Stop → SubagentStop` stays IDLE; dup
  events don't double-transition). Gates: cargo test, golden 12/12.

## Events dedupe key — DONE

Landed as migration 6 (`dedupe_key` column + UNIQUE index, `src-tauri/src/lib.rs`).
Key: `tool_use_id` alone where the payload carries one (PostToolUse — a real
Anthropic API id, unique per real call, immune to concurrent subagents
sharing one `session_id` — confirmed real gap, see below); session + agent_id
+ full payload + a 500ms time bucket for types without one (Stop,
Notification, UserPromptSubmit, transcript lines). `dedupeKey`/`addEvent` in
`src/lib/repo.ts`; `INSERT OR IGNORE` keeps the call fail-open. Tests in
`scripts/dedupe-check.ts` (`npm run dedupe:check`).

Mechanism research (external, Claude Code CLI docs + GitHub issues, no code
copied): no documented case of Claude Code firing the *same* hook twice for
one event, and no formal delivery guarantee either way. The one confirmed
real gap: subagents spawned via the Task tool share the parent's
`session_id` with no other disambiguator in the payload but `agent_id`
(already relied on by the epoch guard's subagent handling in
`src/lib/ingest.ts`) — concurrent subagents finishing in the same instant
could produce two genuinely distinct Stop-shaped events with identical
content otherwise. `agent_id` in the fallback key closes that.

<details><summary>Original problem statement</summary>

Named landmine (CLAUDE.md): "Events table has no dedupe constraint yet;
treat duplicate-event bugs as data-corruption severity (Phase 3 decision
tracking depends on clean rows)." Surfaced 2026-08-12 reviewing pingdotgg/
t3code (external code, concept only — no code copied): their event store
hardened the same gap with a `command_id UNIQUE` constraint, insert-or-return-
prior on conflict. Same shape fits us: SQLite native, no new machinery,
invariant #3 stays intact (still a dumb table).

**Do not copy the naive version.** A unique index on raw content
(`session_id, type, payload_json`) is wrong here, not just imprecise: several
of our hook types carry no per-turn distinguishing field. A `Stop` payload
today is `hook_event_name` + `session_id` + `cwd` + `transcript_path` +
`project_key` + `tab_id` — none of which change turn to turn — so every
`Stop` in a session after the first would serialize byte-identical and
silently collapse into one row under content-only dedup. That's worse than
the bug it's fixing.

**Before picking a key, confirm the actual duplication mechanism** — it's
not obviously reproducible today:
- The hook shell command (`ingest.rs` `hook_command`) calls `curl -sf -m 2`
  with no `--retry`; no client-side retry duplication there.
- StrictMode double-mount is already guarded in `App.tsx`'s ingestion effect
  (the `cancelled`/`track` pattern CLAUDE.md's code conventions require) —
  so that's not the open hole either, unless the guard has a gap.
- Check whether Claude Code itself can double-fire a hook for one logical
  event (tool-call retry on error, concurrent subagents, etc.) — that's the
  more likely real source and would point at a different key than the
  StrictMode case would.

Once the mechanism is known, pick between: (a) a natural per-type id where
one exists (`PostToolUse` carries `tool_use_id`) with a content-hash fallback
for types that don't, or (b) content key plus a coarse time bucket (wide
enough that two real `Stop`s in the same session — always well over a second
apart — never collide, tight enough to catch a genuine duplicate delivery).
Don't ship a key that can't explain why it's safe for `Stop`.

Scope like the epoch guard above: a direct bugfix landed with its own tests,
not a phase. Sequence before Phase 6 (Phase 6 migration numbering assumes
this lands first as migration 6).

- Tests: a forced double-insert of the same logical event is caught; a
  realistic same-session double-`Stop` (identical content, several seconds
  apart) is NOT deduped.

</details>

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
   (2 / 0) are three separate projects today. Same for other multi-project
   dirs with their subdirs.

Fix: derive a stable project key by walking up to the nearest `.git` (fall
back to the cwd itself when not in a repo). Applies to tab cwd AND the hook
cwd on the ingestion side — both must resolve identically or the split
returns. This redefines "project" app-wide, hence a phase item, not a patch.

- Not solved by Tab tether: the tether fixes session→tab binding; the project
  key stays cwd-derived either way.
- Decided 2026-07-18: pre-fix rows stay orphaned, no merge migration. They're
  mostly Phase 1–4 test noise, blockers/decisions self-obsolete, and a
  case-only merge wouldn't have touched the dominant subdir split anyway.
- Also seen: one `notes` row keyed `~ /Desktop/some-project` — literal
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

## Model traffic panel (Safe Router) — Phase 8 candidate

Source: a separate project, Safe Router — a headless single-user model router
that all local agent traffic can be pointed at. It writes an append-only SQLite
metadata log (`~/.safe-router/log.db`, table `requests`): timestamp, client key
id, model requested, model actually served, backend, token usage, latency,
disposition, and `client_tag`.

**Why this is a read, not a merge.** Safe Router is deliberately a separate
process and stays that way. Its invariant #1 is *fail closed*; ours is #2,
*fail open*. It is in-path infrastructure; we are an observer (invariant #4,
and the 2026-07-19 positioning decision: Logic Loop observes, it does not
orchestrate). It is a headless Rust daemon with no WebView and no npm tree by
design. Folding it in would import an opposite failure philosophy and a
security-critical trust domain into a Tauri app. We read its log; we never
write its policy, and we never proxy inference ourselves.

**Why the coupling is nearly free.** The router records its generic
`X-Safe-Router-Tag` header verbatim as `client_tag` (max 128 bytes, no control
characters). We emit that header ourselves, carrying the `LOGIC_LOOP_TAB_ID`
we already stamp on every PTY — identical work, and the mapping knowledge
lives on our side, where it belongs: the reader owns the join, not the writer.
So the join to tabs and projects exists with no new ingestion, no new hook,
and no schema change here. The panel is a dumb SQL view over someone else's
append-only table, which is invariant #3 holding at a project boundary rather
than inside one.

- Attach the router DB read-only (`ATTACH DATABASE ... ` or a second
  tauri-plugin-sql connection). **Read-only, enforced at the connection.** A
  write from here to that file is a bug of the same severity as writing to the
  events spine from a panel.
- Fail open (invariant #2): router DB absent, locked, or schema-mismatched →
  the panel hides itself. Terminals and every existing panel are unaffected.
  Never block ingestion on the presence of an external database.
- `client_tag` is untrusted, client-controlled data on that side. Join on it;
  do not derive authority from it, and **escape it on render** — the router
  bounds it but does not sanitize for HTML contexts. Rows whose `client_tag`
  matches no known tab are displayed under the project only, never guessed
  into a tab.
- Our extractor-exemption sentinel may appear in `client_tag` (we put it
  there). It means nothing on the router side — do not conflate the two tether
  semantics (cf. the RAH note on opposite polarity).

**Not yet grounded in §2 — this is the gate.** Every panel we ship maps to a
named cognitive failure mode; "interesting data is available" is not the bar.
The candidate failure mode is a variant of *progress blindness*: with five
agents running you cannot tell which one is burning frontier budget on work
that didn't need it, and you find out at the invoice rather than at the
moment. If that argument holds up, the panel is a per-tab/per-project cost and
tier-distribution view with an unclaimed-result-style flag on tier anomalies.
**If it doesn't, don't build it** — the data being there is not a reason.

**Second, weaker motivation, worth recording:** once heterogeneous agents
(v2 Adapters) route through one endpoint, model identity, token usage, and
cost arrive *uniformly across all of them* with zero per-agent adapter work.
That doesn't justify the panel on its own, but it does mean this item gets
cheaper exactly as Adapters gets more expensive.

- Depends on: Safe Router v0 shipping and being pointed at by at least the
  clients whose tabs live here. Nothing in Logic Loop blocks on it.
- Test: router DB missing → panel absent, all gates still green. Router DB
  present with rows carrying known tab tethers → rows land under the correct
  tab and project. Rows with an unknown tether → project-level only, no
  misattribution.

## Recursive fan-out spawn (RAH) — Phase 7, in progress

Source: Lumer et al., "Recursive Agent Harnesses" (arXiv:2606.13643).
Pattern named *harness recursion*: a parent agent writes ordinary code that
spawns N full subagent harnesses (own context, filesystem, tools) over a
partitioned workload, instead of cramming everything into one context.
Model-agnostic by construction — the paper's gain comes from the harness
shape, backbone swapped between GPT-5 and Claude Sonnet 4.5 with the pattern
unaffected. Fits Logic Loop because we already treat the coding agent as an
opaque PTY + hook-emitting child (invariant #1); a fan-out child is just
another PTY the ingest pipeline already knows how to bind.

**Mechanism.**
- New human-triggered tab action, "Fan out": user (or the agent, via a
  script it writes and the human runs — invariant #4 stays intact, nothing
  autonomous) partitions a workload and launches N child tabs, each spawning
  its own PTY with `LOGIC_LOOP_TAB_ID=<child uuid>` per existing tether
  mechanism.
- Agent CLI per child is configurable, not hardcoded to `claude -p` — the
  whole point of "model-agnostic." Same launch-command abstraction v2
  adapters will need (OpenCode, Antigravity, Codex), so this item should
  land after or alongside early adapter work, not before.
- **Opposite polarity from the extractor tether.** The self-ingest landmine
  (CLAUDE.md) exempts the extractor's `claude -p` child from ingestion via a
  reserved tether value (`ingest::EXTRACTOR_TETHER`). Fan-out children are the
  reverse case — we *want* them observed and bound like any other tab. Reuse
  the stamp-and-check mechanism, but do not reuse the exemption: a fan-out
  child gets a real per-tab uuid, not the extractor sentinel. Get this
  distinction into the PLAN.md explicitly before build; conflating the two
  is exactly the class of bug that produced the original incident.
- Schema (migration 8, as built): two tables — `spawn_groups` (id,
  parent_tab_id, label) and `spawn_group_members` (group_id, child_tab_id,
  cmd) — not a nullable `spawn_group_id` column, since tabs aren't persisted
  rows today (Phase 6 stores `session_bindings`, not tabs).
- New panel surface (parent tab shows aggregate child progress) — unlike
  Phase 5's "no new panels" constraint, this phase's whole value is that
  rollup view. Still a dumb SQL view per invariant #3; aggregation is a
  query, not new intelligence.

**Resolved in PLAN.md (see there for the full reasoning):**
- Partitioning: agent-authored script only, no built-in splitter (YAGNI —
  revisit if a pattern emerges).
- Parent "done": no synthesized group-level event. The rollup shows
  per-child status and a count; "done" is when the human has claimed every
  child, via the existing per-tab unclaimed-result machinery.
- Recursion depth: 1 for this phase. A child is an ordinary tab and could
  fan out again, but `spawn_group_id` is single-level — no ancestor link for
  a grandchild's group. Depth-N ancestry is a later migration if ever needed.

## Open finding: non-Claude fan-out children never leave "running", show the whole project's decisions (surfaced 2026-08-17/18)

Smoke-tested Phase 7 fan-out with three non-Claude launch commands (`codex`,
`agy`/Antigravity, `opencode`) to check the "arbitrary agent CLI" claim RAH
makes. Mechanism holds — PTY spawns, tether is attempted, tabs don't break,
fail-open intact. Two display gaps found, both explained and neither is the
`bindSession` cwd-fallback hijack first suspected (that theory is **wrong**,
retracted — see below).

**Confirmed mechanism (verified against the live sqlite DB, 2/3 CLIs,
agy + opencode reproduced identically):**
- A child's `tab.agentState`/`tab.sessionId` (`src/App.tsx:460`) only ever
  get set inside the hook-payload handler. None of the three CLIs emit
  Claude Code hooks, so neither field is ever set for a child tab — no
  `session_bindings` row, no real event rows tethered to it (checked
  directly in sqlite). Fan-out rollup status
  (`App.tsx:250`, `done = tab.agentState === "idle" || m.landed`) has no
  other input, so it's permanently stuck on "running" — this is *correct*
  degraded behavior for a CLI with no adapter (invariant #1), not a bug.
- `listDecisions`/`listBlockers` (`src/lib/repo.ts:191,247`) are cwd-scoped
  only, no session filter in the SQL — project-wide by design, predates
  fan-out entirely. `SidePanel`'s `scopeBySession(dc, sessionId)` on top is a
  no-op when `sessionId` is null (nothing ever bound), so a hookless child
  legitimately shows the *whole project's* decisions/blockers feed,
  including its own parent tab's. Only `listToolEvents` got real per-session
  scoping in Phase 7's bugfix commit; decisions/blockers never did.

**Retracted:** first read of the codex run looked like `bindSession`'s cwd
fallback (`src/lib/ingest.ts:56`) binding an unrelated outside Claude Code
session onto the child (its panel showed that session's decisions, rollup
said "done"). Traced against the DB: the "outside" session was actually a
real, legitimately-tethered tab (this authoring session, tethered to its own
tab, not fallback-matched) — `bindSession`'s tether branch always wins for
real tethers and never reaches the fallback for it. The stale-decisions part
is fully explained by the cwd-wide-by-design point above with no hijack
needed. The rollup showing "done" for that one codex run is still
unexplained — its group was dismissed before it could be inspected, and
agy + opencode both reproduced "stuck running" cleanly (2/3, consistent with
the confirmed mechanism). Treating it as unreproduced noise unless it recurs.

**Fixed (2026-08-18):** `SidePanel` now treats a fan-out child with no bound
session (`sessionId` null AND it's a fan-out child per its own `fanOut` prop)
as isolated-to-empty for decisions and tool events, instead of falling
through `scopeBySession`'s cwd-wide fallback. A plain tab or genuinely
external terminal in the same state still gets the fallback — only
spawn-launched children, which have a definite identity and no "cd away,
typed claude by hand" justification, are excluded. `scopeBySession` itself
is untouched (still correct for its original callers); the exclusion lives
in `SidePanel.tsx`'s `isUnboundFanOutChild`.

**Not fixed, scope explicitly excluded:** `blockers` has no `session_id`
column at all (checked schema directly) — it's never been session-scoped for
anyone, Claude fan-out included, not just non-Claude agents. Whether
blockers should be project-wide by design (a blocker is a property of the
project, not the session that found it) or need the same isolation is an
open product question, not a bug this patch touches. Would need a migration
if the answer is "isolate."

## RHI thread — deferred, revisit after Adapters (v2)

Source: Lee et al. (Sakana AI), "Recursive Harness Self-Improvement"
(arXiv:2607.15524). Different mechanism from RAH above: represents the
*harness itself* as a versioned prompt-level spec and iteratively refines it
using pairwise feedback over its own revision history. Also model-agnostic —
tested across sonnet/opus backbones with the harness as the thing being
optimized, not the model.

**Why this isn't a phase yet.** RHI needs infra Logic Loop doesn't have:
a versioned store for "the harness" (extraction prompts, session config) as
data rather than static files, an LLM-judge step, and a place to log
pairwise-comparison outcomes. That's new schema plus a new judging loop, not
an incremental add.

**Breadcrumb for later:** our nearest existing artifact to "the harness" is
the extraction prompt set (`docs/golden/`, gated by `npm run golden`
12/12 — CLAUDE.md Phase 3). If RHI gets picked up, start there: version the
golden-set prompts as rows, not just files, before attempting any pairwise
revision loop. Natural sequencing slot is after Adapters (v2) — RHI's value
compounds once there's more than one harness shape (per-agent-CLI) to
compare against itself.

## Isolated loops — v1.1 (unchanged from spec non-goals)

New-tab flow: "isolate this loop" → `git worktree add` under
`~/.context-terminal/worktrees/<project>/loop-<n>`, branch `loop/<user-slug>`
(user names the loop — no generated names), tab bound to worktree path.
Tab close prompts for cleanup; never auto-deletes.

Pick up two things from pingdotgg/t3code's worktree picker (concept only, no
code copied) when this phase gets its own PLAN.md: offer an **existing**
local branch, not just new-branch creation — right-click a branch, "open in
worktree," cwd becomes that worktree. And sanitize branch names used as
directory components (`feature/foo` → `feature-foo`) rather than assuming
branch names are filesystem-safe as-is.

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

Litmus test per provider (sharpened after reviewing pingdotgg/t3code, concept
only): before writing a bespoke adapter, check whether the CLI already speaks
a structured protocol — Agent Client Protocol or equivalent — instead of
hand-rolling a hooks-equivalent. Several providers are converging on ACP;
where one's available it's a straight win over reverse-engineering a log
format.

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
