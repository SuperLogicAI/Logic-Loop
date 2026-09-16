# Logic Loop — Draft ideas (parking lot)

Not scheduled, not key features, no PLAN.md yet. Candidates surfaced
2026-08-27 discussing what's a cheap add given the current architecture.
Review at some point; promote to `docs/ROADMAP.md`'s sequencing table (with
its own PLAN.md) if/when one of these is actually next.

## Split-pane tabs

Already tracked in `docs/ROADMAP.md` ("Split-pane tabs — v1.x UI") — not
duplicated here, just noting it's the one item in this list that already has
a home.

## Diff/file preview pop-out

Click a "Wrote X"/"Edited X" row in the Accomplished panel → show the diff.
Cheap: `git_diff_cached` already exists (Commit & Push footer), the
Accomplished panel already carries `file_path` per row (`listToolEvents`,
`src/lib/repo.ts`). Read-only, no schema change, no new dependency for a v1
(raw diff text; syntax highlighting can come later if it's worth it).

## Detach tab to its own OS window

Tauri v2's native multiwindow. No new dependency. Still human-triggered
(a click), still just hosting the same PTY — doesn't touch invariant #4.

## Dev-server preview pop-out

Embedded webview pointed at `localhost:PORT`, opened from a tab. Tauri
webview windows are built-in, no heavy new dependency. Main open question is
port detection UX (read it off recent tool activity vs. just let the user
type/pick a port) — more work than the two above but still pure observation,
no ingestion/schema change.

## Editable code view pop-out — considered, not recommended

Flagged during the same discussion, kept here so it doesn't get silently
re-proposed without the reasoning: this is a mini-IDE, not a pop-out. Real
scope — new editor dependency, undo semantics, and a genuine save-race the
moment the agent is mid-edit on the same file while the user types in the
pop-out. Also duplicates what the agent and the user's actual editor already
do. The diff/file preview pop-out above gets ~90% of the value with none of
the risk — build that instead unless a concrete case shows up that the
read-only version doesn't cover.

## Decisions cleanup — grouped by session, bulk-dismiss

**Renumbered to Phase 17** (2026-09-06 — actual Phase 16 landed as Codex/
Antigravity adapter follow-ups, not this; sequencing table below corrected),
ahead of Idea Board (now Phase 18) —
user hit this live during Phase 15 §25 manual testing: 80 open decisions
accumulated on this project alone, oldest ~2 months old, no way to work
through them except one at a time in a flat list.

**Why not a bug.** `decisions` is deliberately project-scoped, not
session-scoped (`decisionCounts`/`listDecisions`, `repo.ts:254,268`) — the
badge counts every unanswered question ever asked in the project, forever.
Confirmed against the live DB: no duplicates, all 80 genuinely distinct,
real backlog from real dogfooding, not a scoping leak.

**Sketch — no migration needed.** `decisions.session_id` already exists
(`lib.rs:62`). New repo queries only:
- `decisionsBySession(cwd)` — `SELECT session_id, count(*), min(ts), max(ts)
  FROM decisions WHERE cwd=$1 AND status='open' GROUP BY session_id`.
- `dismissSession(sessionId)` — bulk `UPDATE decisions SET
  status='answered' WHERE session_id=$1 AND status='open'`.

SidePanel's decisions section groups into collapsible session clusters
(most recent expanded, older collapsed) instead of one flat list. Each
cluster: relative age + count ("~2 months ago · 12 decisions") since a raw
session_id UUID means nothing to a human; "dismiss all" bulk button per
cluster; individual decisions still dismissable one at a time underneath.

Own PLAN.md when its turn comes — not a quick patch, real UI surface change
to a panel every phase touches.

---

# Fable 5.1 concepts (review of 2026-09-02)

Source: Fable 5.1 build review, 2026-09-02. Five concepts were proposed;
## 1 (since-you-left delta) and #2 (clock on state) were accepted on the spot
and live in `PLAN.md` as Phase 14. The three below are parked here with
enough of a build plan that whoever picks one up doesn't re-derive it.
Priority as agreed with the user: #3 likely next, #4 long-term (design for
it, don't build it), #5 off the table for now.

Review's framing, kept because it drives all three: Chrome tabs are fine as
a **viewport** and fail as **status**. Documents don't stall, don't age,
don't run twelve iterations while you sleep, don't owe you an answer.
Phase 14 adds time; #3 adds provenance; #4 moves status out of the tab
strip entirely.

## 3. Turn provenance + loop digest — DONE (Phase 15)

**What.** Tag every turn as `human` or `auto`, then group consecutive
`auto` turns into iterations so a `/loop`- or graph-running session can be
digested as "12 iterations · 3 files · 1 decision waiting · last: 'no
change'" instead of a 200-row trace.

**Limitation addressed.** Unattended-activity blindness. Today a `/loop`
wakeup and a human prompt both arrive as `UserPromptSubmit`; the app cannot
tell a loop from a chat, so Phase 14's delta over-counts "turns" and the
Decision Tracker can't say "the agent decided this for you 8 iterations
ago and kept going".

**Signal (deterministic, invariant #1-safe).** The app owns the PTY write
path (`pty_write`, `pty.rs`) — it already knows when the human types. No
output parsing, no transcript heuristics:
- `pty.rs` (or the TS side in `pty.ts`, which is simpler) records
  `lastInputTs` per tab whenever a write carries printable bytes or a
  newline. Paste counts; arrow keys/resizes don't (filter on byte class,
  not content — never inspect what was typed).
- Ingest: a `UserPromptSubmit` bound to a tab is `human` if
  `now - lastInputTs < PROVENANCE_WINDOW_MS` (start at 5s), else `auto`.
  Stamp `provenance` into the payload before `addEvent` so it lives in
  `events.payload_json` — no migration, and SQL can `json_extract` it.
- Edge: a session started with a prompt on the command line
  (`claude "do X"`) fires `UserPromptSubmit` with no PTY input after
  spawn; treat "spawn-time launch command" as human (spawn args are already
  human-triggered by invariant #4).

**Iterations.** Pure reducer `groupIterations(events)`: an iteration opens
at an `auto` `UserPromptSubmit` and closes at the next `Stop`. Per
iteration: first assistant text line (from `transcript` rows), tool count,
`is_error` count, decisions opened (`decisions.ts` within the window),
whether the closing assistant text is a no-op ("no change", "still
waiting", "nothing to do" — a short allowlist, not NLP; misses are fine,
they just don't collapse).

**Surface.**
- Side panel: when a session has ≥2 consecutive `auto` turns, the
  "Since you left" section (Phase 14) switches to loop shape: iteration
  count, collapsed no-op run ("×7 no change"), every non-noop iteration as
  one line, decisions opened inside the loop pinned to the top in red.
- TabBar: a small `⟳` glyph on tabs whose last turn was `auto` — the tab
  is running itself.
- Human turns keep today's single-shot shape.

**Slots into.** `pty.ts` (input timestamp) → `App.tsx` hook handler
(stamp provenance) → `events` (no schema change) → `src/lib/loop.ts`
(pure reducer, `loop:check` script) → `SidePanel.tsx`. No Rust changes if
the input timestamp is taken on the TS side of `pty_write`.

**Non-goals.** No attempt to detect loops from prompt text. No cross-
session graphs (fan-out already models the parent/child case). No
per-iteration LLM summaries.

**Risks.** A human who types a prompt, then Cmd-Tabs away for 6s before
hitting Enter is tagged `auto` — window is measured from the last
printable byte, not from Enter, so this only bites on a >5s pause between
last keystroke and Enter. Start at 5s, tune from dogfood.

## 4. Global obligation inbox — long-term, design for it now

**What.** One cross-project list of everything that needs the human,
ranked by age × blocking: open decisions, `waiting` sessions, stalled
sessions (Phase 14b), unclaimed results, unresolved blockers. Click → tab.
Cmd-K palette or a left-rail view. Tabs stay the way you *open* a thread;
the inbox becomes the way you *choose* one.

**Limitation addressed.** "Which tab needs me?" Chrome never answers it;
per-tab badges stop scaling around 6 tabs, and a badge can't rank a
3-second-old question against a 40-minute-old permission prompt.

**Why not yet.** It's the one concept that changes what the tab strip is
for. Dogfood Phase 14 + #3 first; if the human still scans tabs left-to-
right to find work, that's the evidence this needs.

**Schema readiness — rules to keep now, so the inbox is a query later,
not a migration:**
1. Every obligation-bearing row carries `(project_key or cwd, session_id,
   ts)`. `decisions` and `blockers` already do; `result_landed` carries
   `cwd` and must keep it; `tab_left` (Phase 14a) carries `cwd`+`tab_id`.
2. Age is derivable from `events`: `MAX(ts) … GROUP BY session_id` —
   never stash "last activity" in a mutable column.
3. "Seen by human" is an **event** (`result_claimed`, `tab_left`), never a
   flag on the obligation row. Append-only, invariant #3 intact.
4. Tab tether appears in payloads (`tab_id`) so an inbox row can jump to
   a tab without a join through `session_bindings`.
5. No new obligation *kind* gets its own table unless it has fields the
   others don't. A `kind` discriminator in a view is enough.

**Build sketch (when it's time).** `repo.inbox()` = one UNION ALL over the
sources above producing `{kind, project_key, session_id, tab_id, ts,
text, weight}`; `weight` = kind base × age. Pure `rankInbox()` reducer
with a check script. UI: `Cmd-K` opens a list; Enter activates the tab
(and `claimTab` fires as today). Dock badge count moves from
"tabs with anything" to "inbox length". Est. 1.5d.

## 5. Agent-emitted structured status — parked, do not build yet

**What.** Have the agent end each turn with a one-line
`LL-STATUS: next=… blocked=… ask=…` by returning `additionalContext`
from the `UserPromptSubmit` hook (the ingest server answers with a JSON
body instead of 204; curl's `>/dev/null` is dropped so Claude Code reads
it). Parse deterministically; works for every adapter that supports
prompt-time context injection.

**Limitation addressed.** The LLM-extraction ceiling: Decision Tracker is
Claude-only, gated on a `?|assum` regex prefilter, and never reconciles a
decision answered after Stop-extraction. Structured status would make
decisions/next-action/blockers deterministic and adapter-neutral.

**Why parked (user decision 2026-09-02).** It's the only concept that
changes how the agents behave, not just how they're observed. Turning it
on mid-dogfood muddies every result Phase 14 / #3 produce — a cleaner
delta could be the status line, not the panel. Also adjacent to invariant

##4 in spirit: the app would be shaping agent output, even if it nevertypes into the terminal.

**If it ever ships:** explicit toggle, default off, README-documented,
and a golden-style fixture set for the parser. Not before #3 has a month
of dogfood behind it.

## 6. Idea Board — bottom dock, markdown-backed (user concept 2026-09-02)

**What.** A collapsible strip under the terminal pane (wireframe:
`~/Desktop/Screenshot 2026-09-02 at 1.16.59 PM.png`). Status columns and
cards with a `+` to add. The visual is the front end; the back end is one
terse markdown file per project the UI parses and rewrites.

**Limitation addressed.** Ideas are generated faster than they're chased.
Some get built, some get parked, most get lost between sessions. This is
the project-management-fundamentals layer the original concept doc
gestured at: a visible queue of *intended* work next to the *live* work,
so re-entry can start from "what did I mean to do here" as well as "what
did the agent do".

**Decision (2026-09-02): new format, not a view over existing docs.**
`docs/IDEAS.md` / `docs/ROADMAP.md` are agent-facing — rationale,
landmines, history, `<details>` blocks, optimized for loading context,
not for scanning. Parsing their `## ` headings into cards yields fifteen
400-char blobs in boxes: same clunk, different frame. Terse is fine for
agents; verbose is bad for humans. So the board is a file that is
human-shaped by construction, and agents read it too.

**Board = index. Docs = detail.** A card carries what/status/next and a
link; the *why* lives in the doc it points at. Second-source-of-truth
drift is real but small, and one line in CLAUDE.md process rules ("phase
accepted → move its card to `done`") keeps agents maintaining it.

**Format contract (keep it this dumb).** `.logic-loop/board.md`, one per
project (`project_key`), committed. Valid markdown — renders in GitHub /
Obsidian, agent reads it in one `Read`.
```
## <title>
status: idea | planned | building | later | done
<one-liner, ≤ 2 lines by convention>
link: PLAN.md            (optional; path relative to repo root or URL)
next: <one physical action>   (optional)
```
- Card = one `## ` heading. Anything above the first `## ` is preamble,
  preserved untouched. Unknown lines in a card body are kept verbatim.
- Columns = `status:` values. **Move = edit one line.** No file moves.
- `+` = quick add: title optional; empty title → first line of body
  becomes the title, status `idea`. That is the "Brain Dump" — an
  affordance, not a column.
- Create = append block. Edit/move/delete = splice by heading range.
  **Never** rewrite the file wholesale from parsed state.
- Pure module `src/lib/board.ts`: `parseBoard(md) → Card[]`,
  `spliceCard(md, card) → md`, `appendCard(md, card) → md`.
  `board:check` roundtrips a fixture with preamble, unknown body lines,
  and a table inside a card: parse → splice one card → byte-identical.

**Per-project only (v1).** No global "later" file. A cross-project view
is a Cmd-K query over every open project's board later — which is
concept #4's inbox, and it should arrive with it, not before.

**Momentum tie-in (the leverage).** Momentum Builder today surfaces only
*leftovers*: landing note → oldest open decision → oldest blocker;
nothing open → no card. The board adds *intent* as the fourth fallback:
the top `planned` card's `next:` line (else its title). Re-entry stops
being only "what did the agent do" and becomes "what did I mean to do
here". `SidePanel.tsx`'s momentum chain gains one branch; Done on that
card sets `status: building` (not `done`) so the card follows the work.

**Slots into.** Two Rust commands (`read_text_file`, `write_text_file`)
with a path guard — the path must resolve under the tab's `project_key`;
no writes into `~`. UI: `src/components/IdeaBoard.tsx`, mounted under
`Terminal`, height-resizable the same way the side panel is (Phase 7
pattern), collapsed state + height in `settings`. Reload the board on
window focus, tab switch, and before every own write (reload-before-
write is the two-writer mitigation: re-read, splice, write, never write
from stale parse). Missing file → empty board with `+` live; first card
creates `.logic-loop/board.md`.

**Bootstrapping this repo.** Not the UI's job. One agent turn writes the
initial `board.md` from `docs/IDEAS.md` + `docs/ROADMAP.md`'s sequencing
table, each card linking back to its section.

**Non-goals v1.** No drag-and-drop ("move to…" menu is one line). No
markdown rendering inside cards — plain text, click to expand raw. No
per-card agent actions. No cross-project view. No sync beyond git.

**Sequence.** After Phase 14. Est. 1.5d: `board.ts` + check (0.5),
Rust commands + guard (0.25), component + momentum branch (0.75).

---

# Compass study concepts (review of 2026-09-04)

Source: competitive research, internal codename Compass study — concept
only, no code copied. Worktree isolation (the concrete lesson from this
review) was promoted straight to `docs/ROADMAP.md`'s "Isolated loops"
section, not parked here. The four below are lower-conviction or
larger-scope; parked for later review.

## Usage / rate-limit tracking + account hot-swap

Validates the already-parked "Model traffic panel (Safe Router)" idea in
`docs/ROADMAP.md`. The Codex-only meter below has a different source from
Safe Router traffic: Codex's own account/usage interface. The router log
does not establish Codex subscription quotas. Account hot-swap remains a
separate, unplanned action feature; a read-only meter must not switch accounts.

## Codex model and account-limit meters in the project sidebar — build brief

**Status:** idea / planning only (2026-09-14). Promote to its own numbered
plan, review against the accepted phase baseline, and obtain that plan's
approval before implementation. Codex only; Claude, OpenCode, and
Antigravity each need their own source proof and plan. Independent of
candidate Plan 022 (`plans/022-safe-router-traffic-view.md`): this can work
when Codex does not route through Safe Router, and it does not enable router
`client_tag` attribution.

**Failure mode and UI.** When several Codex tabs are running, the person can
see their turn state but must enter Codex or leave Logic Loop to learn the
active model and whether the shared Codex allowance is nearly exhausted.
In the expanded `SidePanel` for the active, bound Codex tab, place a small
"Codex" usage block immediately below the project/session heading, before
event sections. Show the verified current session model (or "Model unknown")
and, when supplied, two bars: "Codex account · short window" and "Codex
account · weekly" with used percentage, remaining percentage, and reset
time. "Session limit" here means Codex's rolling account allowance, not the
tab's context-window fill. Use the actual `windowDurationMins` in the
short-window label (do not hard-code five hours); call a window "weekly"
only when its returned duration is seven days, otherwise label the
returned duration. A tooltip/caption says
"Shared across this Codex account, including activity outside this project."
This is quota consumption, not dollar spend or tokens billed to this tab.
Never put the account bar inside a session-labelled row or sum it across
tabs. No meter for an unbound tab or an agent whose marker is not `codex`.
The compact rail may have a quiet "Codex usage" entry that opens the
expanded block, but no persistent alarm/badge. Respect Lock-in and narrow
width; no new terminal overlay, PTY decoration, or autonomous input.

**Codex sources to prove before building UI.** Official OpenAI documentation
currently specifies `account/rateLimits/read` on the Codex app-server JSON-RPC
interface. It returns `rateLimitsByLimitId` (or legacy `rateLimits`) with
nullable primary/secondary windows, `usedPercent`, `windowDurationMins`, and
`resetsAt`; it may not return a weekly window. It also documents
`account/usage/read` token-activity summaries, `thread/read` by exact thread
ID without resuming it, and `thread/tokenUsage/updated` for app-server-owned
active threads. None proves that a separate app-server process can subscribe
to a Codex CLI session already running inside our PTY. The installed CLI was
`codex-cli 0.154.0` when this idea was drafted. Start with a read-only spike
against that exact version: (a) compare a known Logic Loop-bound Codex
`session_id` with an app-server `thread/read` result; (b) verify the model
field and whether a second app-server can read a live CLI
thread; (c) call `account/rateLimits/read` through a bounded local client
using existing Codex auth, with no login, account mutation, config write, or
model request. Record redacted response shapes, exact client version, window
durations, and missing/null cases in the promoted plan. If the account call
cannot work read-only on this installation, stop that part and show no quota
bars. Do not scrape a web dashboard or Codex's rendered footer.

For multiple `limitId` buckets, identify which applies to the active model
from a documented field or live-verified mapping. If that link is absent,
show each returned named bucket at account scope (bounded count) or an
"Account limits available; model bucket unknown" state; never choose the
most convenient percentage or combine buckets. A missing secondary window
stays missing.

**Session model fallback.** Logic Loop already tails Codex rollout JSONL
through `src-tauri/src/ingest.rs` and receives lines at `onTranscriptLine` in
`src/App.tsx`; those are structured agent data, while terminal bytes are not.
If `thread/read` cannot report the active CLI model reliably, inspect the
installed rollout's metadata/turn-context event shape (keys only in shared
test artifacts), then add a narrowly validated Codex-only metadata parser
in ingestion. Match by exact bound `session_id` and `tab_id` via the existing
`bindSession` path; never infer from cwd, a router model name, or the Sidebar
LM extractor setting (`codex_model` is a separate subprocess). Update the
display when Codex changes model mid-session; an old observation must not
survive a new session bound to the same tab. Rollout structure is an internal
format, so unknown shape yields "Model unknown" plus a bounded adapter
warning, not a guess. If an app-server and rollout disagree, report the
source conflict in tests and prefer an explicit, documented per-thread
field only after a live proof; do not silently pick one.

**Implementation shape after the spike.** Add one bounded Rust command/module
for the local Codex app-server read client, with fixed JSON-RPC method(s),
timeouts, output-size limits, validated numeric ranges, and no caller-supplied
method or arbitrary thread ID. It accepts only the currently bound Codex
session ID supplied by the app; the existing binding remains the authority
for which tab receives session data. Keep account snapshots in transient app
state first (no migration needed); account polling runs only while a Codex
sidebar is visible, at a conservative interval no faster than 60 seconds,
with one request in flight, generation guards on tab/account change, and
StrictMode-safe cleanup. `src/App.tsx` owns polling and passes a typed
snapshot to `SidePanel`; database access, if later needed, goes through
`src/lib/repo.ts`, never inline SQL in a component. Account data is global
to the authenticated Codex account and must be invalidated when auth/account
identity changes, rather than copied into project events. If the app-server
reader itself would require persistent auth/config changes, state that scope
change in the promoted plan and ask before making it.

**States and proof.** Distinguish loading, available, unavailable (API-key
only/unsupported auth), missing window, error, and stale last-good data.
Clamp/reject malformed percentages rather than drawing an overfull bar;
display reset times in the user's timezone and never manufacture a weekly
zero or reset date. An account read failure cannot delay hook ingestion,
decision extraction, terminals, or Safe Router Traffic. Test exact-session
model binding with two Codex tabs in one project, model switch/resume, wrong
or missing session ID, unknown rollout shape, no account auth, null secondary
window, multiple `limitId` buckets, stale responses after tab switch, poll
cleanup, and a hung app-server process. Record a manual macOS pass in
`docs/TESTING.md`: compare the displayed model and quota windows with the
same account's Codex UI, then exercise no-router, router-running, and
non-Codex tabs. Run focused checks first, then the repository gates in
`AGENTS.md`; no live model call is needed for automated verification.

**Boundary with Traffic.** Plan 022's `v_requests_v2` rows remain a global
router-only request audit. Codex account-limit snapshots neither contain a
Safe Router request ID nor prove `X-Safe-Router-Tag` propagation, so do not
join, add project labels, or calculate dollars from them. Any cross-source
request-to-tab attribution still requires Plan 022's separate live Codex
header experiment and approval.

Sources checked 2026-09-14: [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server),
[Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
(`tui.status_line` is a rendered TUI footer, not a data API), and local
`src/lib/ingest.ts`, `src/App.tsx`, `src/components/SidePanel.tsx`.

## Claude Code model and account-limit meters in the project sidebar — build brief

**Status:** idea / planning only (2026-09-14), same standing as the Codex
brief above. Promote to its own numbered plan, review against the accepted
phase baseline, and get that plan's approval before implementation. Claude
Code only — the Codex proof above does not transfer; OpenCode and Antigravity
still each need their own. Independent of candidate Plan 022
(`plans/022-safe-router-traffic-view.md`) for the same reasons as the Codex
brief.

**Same UI, same failure mode.** Same sidebar placement (below the
project/session heading, before event sections), same Lock-in/width/no-
autonomous-input constraints, same "Model unknown" language, same "shared
across this account, including activity outside this project" caption
pattern as the Codex brief above — do not respecify that here. This section
covers only what differs for Claude Code as a source.

**Model row: cheap, already have the data.** Unlike Codex, which needed a
new rollout-metadata parser as a fallback, the active model is already
sitting in every assistant transcript line: `message.model` on each
`type: "assistant"` entry the existing tailer reads (`decisions.ts`'s
`textFromTranscriptLine`; Plan 018's `transcriptEnvelopeType()` already
classifies this exact line shape). No new parser, no spike needed — read the
last assistant line's `message.model` for the bound session/tab, matched via
the same `bindSession` path Codex uses. Update on a model change mid-session
same as Codex; a stale value must not survive a new session bound to the
same tab.

**Correction (same day, 2026-09-14): a real source exists — the statusLine
JSON contract.** The first Context7 pass above checked `/anthropics/claude-code`
(GitHub-sourced docs/changelog/types) and missed the dedicated statusline.md
page, which lives on the separate `/websites/code_claude` doc set
(`https://code.claude.com/docs/en/statusline`) — confirmed live the same day
once the maintainer reported having a working custom status bar. Claude Code
v2.1.251+ feeds every `statusLine` command a `rate_limits` object on stdin:

```
rate_limits.five_hour.used_percentage   // 0-100
rate_limits.five_hour.resets_at         // unix epoch seconds
rate_limits.seven_day.used_percentage   // 0-100, the weekly window
rate_limits.seven_day.resets_at
rate_limits.spend_limit.{used_percentage,resets_at}  // gateway accounts only, can exceed 100
```

This is the Claude Code equivalent to Codex's `account/rateLimits/read` —
documented, versioned, no spike needed to prove the schema exists. Also
documented for anyone driving Claude outside the CLI: the Python Agent SDK's
`RateLimitEvent`/`RateLimitInfo` (`status`, `resets_at`, `rate_limit_type` ∈
`five_hour | seven_day | seven_day_opus | seven_day_sonnet | overage`,
`utilization`) is the same underlying signal delivered as an SDK event
instead of a stdin field — not this app's path (Logic Loop doesn't run
sessions through the SDK), but confirms the source is a real, stable
Anthropic contract, not a statusLine-only quirk.

**Gating conditions.** `rate_limits` is present only for Pro/Max
subscribers (or an account behind a Claude apps gateway with spend limits),
and only *after the first API response of the session* — every session
starts with the field absent, which is expected, not an error state. Below
CLI v2.1.251 the field is simply absent too, so "field missing" collapses
two different causes (old CLI vs. ineligible account); check `claude
--version` separately if the plan needs to tell them apart in the UI copy.
`spend_limit.used_percentage` can legitimately exceed 100 — clamp the bar
fill, not the displayed number.

**Single-slot conflict — the real design problem, not the data.**
`statusLine` is one `{type, command}` field in `settings.json` (project
overrides user, same precedence as everything else — see the SDK's
`SettingSource` order above), not additive like `PostToolUse`'s named-hook
merge. The maintainer already has a working custom status bar occupying
that slot, and any Logic Loop user reading this brief may too. Overwriting
it silently breaks their setup and is a worse landmine than anything in the
Codex brief. `statusLine` is also a distinct settings key from "hook entries
via the app's own toggle" — the one pre-approved exception in this file's
process rules — so touching it does not inherit that exception and needs
its own explicit ask/toggle in the promoted plan.

**Decided: managed wrapper, for parity with Codex's brief (2026-09-14).**
A copy-paste-snippet alternative was considered and rejected — it would make
Claude the one adapter where the user hand-maintains the integration instead
of Logic Loop owning it end-to-end, breaking parity with the Codex brief's
shape (the app owns the read client; `src/App.tsx` polls and passes a typed
snapshot to `SidePanel`, no user-maintained file). Same ownership model here:
detect an existing `statusLine.command`, install a thin wrapper that execs
the original command unchanged for stdout (so the visible bar stays
byte-identical) and separately POSTs the same stdin JSON to the ingest
server — same extractor-tether-style stamping this app already uses to keep
its own spawned processes out of ingestion. Still gated behind its own
explicit opt-in toggle, not the pre-approved hook-entries exception — that
consent requirement is the one real asymmetry the promoted plan must carry
versus Codex, which touches no file the user already owns. Idempotent,
reversible install/uninstall (restore the original `statusLine.command`
byte-for-byte), same standard this codebase already holds hook writes to.
No statusLine change should be silently rolled out; the promoted plan needs
the user's explicit opt-in before implementation, not just before merge.

**Update cadence needs no polling.** The script reruns on session
start/resume, each new assistant message, `/compact` finishing, a
permission-mode change, vim-mode toggle, an optional `refreshInterval`
(1s floor, for idle periods), and — usefully — automatically again the
moment a previously-seen `resets_at` is reached, so a 5-hour/weekly boundary
self-refreshes without Logic Loop tracking clock time itself. This is
push-driven structured data, in the same spirit as invariant #1 (a real
protocol, not us polling or parsing rendered output) — no account-client
module, no 60-second poll loop, no generation-guard/in-flight-request design
like the Codex brief needs.

**Model row unaffected.** The transcript-`message.model` path above stays
the recommended source regardless of the wrapper — it's already-flowing
data with no settings.json touch at all, useful on its own if the wrapper
gets deferred or declined.

**States and proof.** Loading (session started, first response not yet
seen), unavailable-ineligible (no `rate_limits`, CLI ≥ v2.1.251, non-
Pro/Max), unavailable-old-CLI (CLI < v2.1.251), available, stale (script
hasn't rerun since a stated cadence event was expected), and the
spend-limit over-100 case. A statusLine/ingest failure must never touch the
user's actual visible status bar or block session start — same fail-open
invariant as every other ingestion path. Manual test matrix for the
promoted plan: verify byte-identical status-bar output before/after wiring
the wrapper, verify install/uninstall restores the original
`statusLine.command` byte-for-byte, and compare displayed percentages
against the same account's own terminal status line.

**Boundary with Traffic.** Same as the Codex brief: no join with Plan 022's
`v_requests_v2` rows, no dollar figures, no cross-source attribution without
its own separate proof and approval.

Sources checked 2026-09-14: [Context7](https://context7.com)
`/websites/code_claude` (`docs/en/statusline`, `docs/en/agent-sdk/python`)
for the corrected pass, `/anthropics/claude-code` for the initial (partial)
pass, and local `src/lib/decisions.ts`, `src/lib/ingest.ts`.

## Antigravity model and account-limit meters — compatibility check

**Status:** compatibility investigation only (2026-09-14), prompted by the
Claude statusLine finding above — not yet a build brief, and not promoted to
a plan. `src-tauri/src/antigravity.rs` already manages a separate,
unrelated file (`~/.gemini/config/hooks.json`, its lifecycle-hook
registration under `HOOK_NAME = "logic-loop"`); nothing below touches that
file or those hooks.

**Real parity, verified against the locally installed CLI's own linked
docs, not guessed.** `~/.gemini/antigravity-cli/builtin/skills/
antigravity_guide/references/cli.md` points at
`https://antigravity.google/docs/cli/statusline` as the authoritative page;
fetched live 2026-09-14. Antigravity's `agy` CLI has the same mechanism as
Claude Code, down to the same settings key name: a `statusLine.command`
entry in `~/.gemini/antigravity-cli/settings.json` (distinct from the
`hooks.json` this app already manages) receives a JSON payload on stdin
whenever agent state changes, and renders whatever the script prints to
stdout as the TUI's status bar. The payload documents a `quota` object,
mapping model IDs to `remaining_fraction`, `reset_time`, and
`reset_in_seconds`, alongside `model.{id,display_name}`,
`context_window.{total_input_tokens,total_output_tokens,used_percentage,
remaining_percentage}`, `agent_state` (`idle|thinking|working|tool_use|
initializing`), and optional `plan_tier`/`email`. This is Antigravity's
equivalent of Claude's `rate_limits` field — the same wrapper shape decided
for Plan 023 (exec the original command unchanged for stdout, side-channel
mirror the JSON to the ingest server, explicit opt-in, byte-identical
install/uninstall) would transfer directly in outline. Confirmed live: this
user has no existing `statusLine` configured in
`~/.gemini/antigravity-cli/settings.json` today (checked directly), so a
build here would hit the same "nothing to wrap yet" first-release scope
limit Plan 023 already states for Claude, not a reason to build something
different.

**Real differences from Claude — do not copy Plan 023's code unmodified.**
(1) `reset_time` is documented as ISO 8601 (`"2026-07-06T07:50:32Z"`), not
Claude's unix-epoch seconds — display/formatting code is not shareable
as-is between the two meters. (2) Quota is reported **per model ID**, not
as one account-wide 5-hour/weekly pair — Antigravity's model-hot-swap
support (`app.md`: "Model Selection") means a meter here needs a
"which model is the bar for" decision Claude's single-account-window design
never faces; showing every returned model bucket rather than guessing the
"current" one is the same discipline the Codex brief already applies to
Codex's multiple `limitId` buckets. (3) `plan_tier`/`email` presence is
documented as optional with no enumerated value set (only one example,
`"Pro"`) — treat as an opaque display string, don't branch UI logic on
assumed values. (4) Antigravity also has G1 credits (`/credits`,
`useG1Credits` settings key: "Uses personal AI credits for model calls once
plan quotas are exhausted") — a second, separate allowance system with no
stated presence in the `statusLine` JSON at all; if a future build wants to
show credit balance too, that needs its own proof, not an assumption it
rides along in `quota`.

**Unverified — the doc excerpt fetched today does not state these, and
Claude's equivalent facts are explicitly documented while Antigravity's are
not:** whether `quota` requires a minimum CLI version (Claude's statusLine
doc is explicit: v2.1.251+; no such version gate appears in what was
fetched for Antigravity), whether the field is absent until the session's
first model response the way Claude's `rate_limits` is (undocumented here),
and whether a slow/hanging custom statusLine script can block the TUI (no
performance/timeout guidance surfaced, unlike Claude's implicit contract
via its documented debounce/cancel-in-flight behavior). Given this app's
own live-tested history with Antigravity's hook contracts undershooting
their own docs in the past (`PostToolUse` named-hook merge, `PreInvocation`
lacking a `decision` field, `run_command`'s `is_error` blindness — all in
CLAUDE.md's landmines), do not trust this doc excerpt alone before writing
code: any future plan must include a live spike against the installed `agy`
build (this Mac already has 1.1.27 or newer) proving the same three things
the Claude plan proved from documentation alone — field presence timing,
exact JSON shape on a real session, and that a slow mirror-POST script
cannot visibly stall the TUI — before repeating Plan 023's shape here.

Sources checked 2026-09-14: locally installed
`~/.gemini/antigravity-cli/builtin/skills/antigravity_guide/references/
cli.md`, `~/.gemini/antigravity-cli/settings.json` (this account's own,
confirmed no `statusLine` set), and the live pages it links —
`https://antigravity.google/docs/cli/reference` and
`https://antigravity.google/docs/cli/statusline`. Local
`src-tauri/src/antigravity.rs` (existing hooks.json ownership, kept
separate from this).

## Annotate AI diffs

Drop a comment on any diff line and ship it back to the agent as follow-up
context — review, edit, and commit without leaving the app. Pairs naturally
with the existing Commit & Push footer (`SidePanel.tsx`); not on the roadmap
today. Would need a place to land the comment (new prompt turn vs.
queued context) — worth a real design pass before a PLAN.md, not a cheap
add.

## Quick open / Cmd-K across worktrees, files, agents, commands

Validates the parked "Global obligation inbox" direction (IDEAS.md #4
above) — same shape, broader index (files/agents/commands, not just
obligations). If #4 ever gets built, this is the natural generalization to
consider next rather than a separate feature.

## Mobile companion app

Monitor/steer agents from a phone, get notified when one finishes, send
follow-ups remotely. Real differentiator if we ever want it, but native
iOS/Android is a different order of scope than anything else in this file —
long-horizon, not a cheap add. No action until something forces the
question.

---

# Session persistence across app quit (2026-09-05)

Surfaced during manual §23 (Phase 14) testing: quit Logic Loop mid-turn,
relaunch, Re-enter — the interrupted turn doesn't finish or pick back up, it's
just gone. Confirmed as expected given the current architecture, not a bug:
PTY sessions are direct child processes of the app (`pty_spawn`, `pty.rs`),
so Cmd-Q kills every live `claude` process with it. Re-entry's
`claude --resume <session_id>` (`pty.rs:152-154`) restores the transcript —
prior turns and replies — into a fresh process; it doesn't replay a turn that
never completed. That's Claude Code's own `--resume` semantic, not something
Logic Loop adds or could patch around without changing what Re-entry is.

herdr (see `[[ref-herdrdev-herdr]]`) doesn't hit this: it's a persistent
background daemon + thin client, tmux-style detach/reattach, so the agent
process's lifetime is decoupled from any UI window closing. Logic Loop has no
daemon — PTY lifetime is tied to app lifetime, full stop.

**This is a distinct question from the one already decided in
`docs/ROADMAP.md`'s "Adapters — v2."** That section dismisses herdr's
*agent-initiated orchestration* (agents autonomously spawning/driving sibling
panes) as out of scope per invariant #4. It says nothing about herdr's
*persistence* model — a daemon that keeps a human-triggered session alive
across client restarts doesn't touch invariant #4 at all. Don't let the
existing "not adopting herdr's model" line get cited as already covering
this; it doesn't.

**Open question, not a decision:** is "sessions survive an app quit"
important enough to justify a background-daemon architecture change, or does
Re-entry's "resume the transcript, re-prompt if needed" already cover the
real need? A daemon would be a genuine architecture shift (new process,
new lifecycle, new failure modes to keep invariant #2 fail-open through) —
not a cheap add like the rest of this file. Not key to the current version.
Revisit if losing in-flight turns to a quit becomes a recurring complaint
rather than a one-off during testing.

---

# GPT-6 Astra product/UX review (2026-09-06)

External review (`improve` skill, read-only — no files changed, no live
usability/correctness audit) of source + concept doc + IDEAS.md + ROADMAP.md
+ a repo screenshot. Core concern: sidebar panels (landing notes, decisions,
blockers, since-you-left, loop digest, re-entry) increasingly compete for
attention — more visible info can raise the burden Logic Loop exists to cut.
Six features prioritized below; three map onto existing parked ideas (#4
inbox, #6 board) and are folded there rather than duplicated. Three are new.

**Corrections to the review's stated inconsistencies** (checked against
current repo state, not taken at face value):
- Worktree isolation: review says ROADMAP claims "not started" while the app
  already creates worktrees. Actual ROADMAP text (`Isolated loops` section)
  already draws this distinction correctly — Phase 9 shipped a narrower
  branch-switch-in-place mechanism, real `git worktree add` isolation is
  still unbuilt. Not a doc bug; review read the sequencing-table cell
  without the section below it.
- Loop digest "likely add-on": true when Astra apparently read a stale
  copy — it shipped as Phase 15 (2026-09-06, same day). Fixed above.
- Decisions cleanup mis-numbered Phase 16 (actual Phase 16 = adapter
  follow-ups): real conflict, fixed above (renumbered Phase 17).
- Blockers lack session identity: already a known, explicitly-scoped-out gap
  — see ROADMAP's RAH section, "Not fixed, scope explicitly excluded."
  Correct finding, already tracked, not new.

## A. Cross-project attention inbox — same feature as #4 above

Astra's version adds two refinements worth carrying into #4's build sketch
when it's picked up:
- **Rank by explicit priority/actionability first, age second** — not
  age-weighted alone. #4's `weight = kind base × age` should read `weight =
  kind base × priority, tiebreak age` so a fresh answerable question doesn't
  lose to a two-month-old dead blocker. State the ranking in plain text next
  to the list, not just an implicit sort order.
- **Preview/snooze/pin without switching tabs.** #4's sketch already makes
  Enter activate a tab; add a snooze (defer N hours, re-surfaces) and a pin
  (manual priority override) as row actions, and a preview affordance
  (expand in place) before committing to a tab switch.

## B. Compact re-entry brief — extends Phase 14's delta, not a new panel

Phase 14 (`src/lib/delta.ts`) already computes files/commands/turns/last
words. Astra's ask is presentation, not new data: render it as one
structured block at the top of the side panel instead of separate stat
lines — project · agent · branch, one-line goal (from the landing note or a
pinned board card, never a fresh LLM summary), "you left / changed / needs
you / next" as four short fields with the underlying evidence (diff, tool
event, decision) one click away. No new ingestion. Reference: a resumption-
cues study found automated cues beat notes alone for task completion, with
users preferring chronological snippets over prose — supports pairing the
brief with drill-down evidence rather than another generated summary
(Microsoft Research, "Evaluating Cues for Resuming Interrupted Programming
Tasks").

**Risk called out correctly:** don't require a fresh generated summary on
every tab switch — that's more LLM cost and another place for drift between
claim and evidence. Use only facts already computed (delta, landing note,
board card) plus links to their source rows.

## C. Seen ≠ reviewed ≠ resolved — extends Phase 5's unclaimed-results model

Today, focusing a tab claims its result (`App.tsx`, `claimTab`) — good
enough for an unread dot, weak evidence the human actually acted on it.
Real gap: nothing distinguishes "I glanced at it" from "I decided what to do
about it." Proposal: keep a result's row open (separate from the
`result_landed`/`result_claimed` pair Phase 6 already has) until an explicit
action — "Answer," "Delegate," "Dismiss," "Resolve blocker" — replaces the
generic Momentum-card "Done" (`SidePanel.tsx`). Pairs directly with the
already-parked diff/file preview pop-out above: open the diff, see it,
mark it explicitly. Risk (stated correctly): don't add bookkeeping to every
tool event — gate this on Momentum-card-level items only (decisions,
blockers, landing notes), not the Accomplished panel's raw tool rows.

Also: the current "Nothing waiting on you" empty state (`SidePanel.tsx`)
should distinguish "confirmed nothing" from "extraction unavailable for
this agent" (e.g. non-Claude fan-out children with no decision tracking,
per the RAH open-finding above) — conflating the two overstates confidence
exactly where an adapter has the least visibility.

## D. Focus mode with batched notifications — extends Phase 6's per-project mute

Phase 6 already ships notification filtering + per-project mute. Extend to
"Focus on this project": batch ordinary Stop/completion nudges into one
quiet digest, still let `WAITING_ON_YOU`-class events through per user
choice, show a restrained background count, offer "review queued updates"
on focus-off. Agents keep running — this changes when output reaches the
human, not what agents do (invariant #4 untouched). Motivation: an
interruption study found people compensate for interruptions by working
faster while reporting more stress/frustration — faster notification is not
itself evidence of a better experience (Mark, Gudith, Klocke, CHI 2008).

## E. Lighter departure capture — alternative to the landing-note modal

**Manual/Auto capture DONE in Phase 28.** Automated and live matrices pass;
the maintainer approved the phase on 2026-09-10. Phase 28 adds
the global preference and an explicit, active-project **Set landing note**
action inside **Notes and reminders**. The action and active shared Notes input
use the landing rainbow; the inline prompt replaces a manual popup and performs
no LLM work. The separate automatic-departure inline strip and preserved
in-progress text proposed below remain deferred.

`LandingNoteModal.tsx` is a full modal with a 60s auto-skip, shown on
switch-away. Prototype a smaller inline strip instead — "Leave a next step
for <project>," optional draft, keyboard shortcut, preserves in-progress
text — with the current modal ritual demoted to an opt-in preference rather
than the default. Add a quick-capture affordance with an explicit
destination ("Save thought to <project>") defaulting to the *previous*
project, not silently inferred — misfiled notes are worse than no note.

## F. Idea Board: add a small "Now" set — extends #6 above

#6's board already has `status: planned`. Add one more concept on top: a
human-selected, size-bounded "Now" subset (not just sorted-by-status) with
an explicit "Return to this next" action, so switching to a different
terminal doesn't silently change what the human intended to do next. Keep
the board collapsed during execution (already a non-goal-respecting design
in #6) — this is additive to the existing spec, not a new board shape.

## Sequencing note from the review

Suggested order: decisions cleanup + observation-clarity (item C's second
half) → inbox (A/#4) → re-entry brief (B) + review queue (C) → focus mode
(D) + departure capture (E) → board Now-set (F). Split panes, detached
windows, mobile, usage dashboards named as lower-priority than all of the
above — already reflected in ROADMAP's v1.x/v2 placement, no change needed
there. Validation suggestion for whichever ships first: dogfood across
several projects, track time-to-next-action, bounce-back switches,
overlooked results, perceived overload — qualitative, not a metrics
dashboard to build.

---

# Prime Agent adapter candidate (research pass, 2026-09-08)

Source: `github.com/PrimeIntellect-ai/prime-agent` — user asked for a
fit review against Logic Loop's adapter model. Research only (GitHub API +
raw doc fetches, no local install, no code touched). Verdict: **strong
candidate, clears the ROADMAP litmus test better than any adapter shipped
so far** — but pre-1.0, flag the churn risk before committing a PLAN.md.

**Repo facts:** MIT, TypeScript, 20.3k stars, created 2026-05-08, active
(daily pushes). Built on `pi` (earendil-works). Backed by PrimeIntellect;
has an arXiv paper (2608.23552). Current release `v0.9.4` — pre-1.0.

**Why it clears ROADMAP's litmus test** ("Adapters — v2" section: *check
whether the CLI already speaks a structured protocol before hand-rolling a
hooks-equivalent"*) — Prime Agent has three, richer than what any current
adapter gets from its own CLI:
- **Persisted JSONL session transcripts** — `~/.prime/agent/sessions/
  <id>.jsonl`, header carries `cwd`, tree-structured (`id`/`parentId`),
  fully typed entries (`message`, `model_change`, `compaction`,
  `branch_summary`, etc. — see `packages/coding-agent/docs/
  session-format.md`). Same tailable shape as Codex's rollout transcript
  (Phase 21) — `decisions.ts`'s pattern would port directly.
- **RPC mode (`--mode rpc`) with an `observe` command** — a *separate*
  process can attach read-only to another already-running session's live
  event stream (`agent_start`/`turn_start`/`tool_execution_*`/
  `message_*`) via the shared daemon, with zero lease conflict and zero
  hooks.json/plugin-file editing. Lighter footprint than every adapter
  built so far (Claude/Codex edit a hooks file; OpenCode/Antigravity
  install a plugin/forwarder). This is the daemon's own documented
  multi-client feature (`packages/coding-agent/docs/rpc.md`,
  `daemon.md`), not a hack.
- **ACP mode (`--mode acp`)** — speaks `agentclientprotocol.com` directly
  (JSON-RPC 2.0 over stdin/stdout), the exact protocol ROADMAP's litmus
  test calls out as "several providers are converging on."

**Gap vs. current adapters:** the persisted JSONL file does **not**
contain turn/agent lifecycle entries (`agent_start`/`turn_end`/etc — only
`message`/`model_change`/`compaction`/... are written to disk). Getting a
Stop/idle-equivalent needs the RPC `observe` live stream (or polling
`get_state`), not file-tailing alone — unlike Codex, where the rollout
file alone is enough. `SessionStateEntry` (`active`/`archived`, in-file)
might substitute loosely; unconfirmed against a live process.

**Tether/resume fit:** header's `cwd` + session id matches the existing
cwd-fallback/project_key pattern; `prime-agent --resume <id>` matches
`pty.rs`'s `resume_command` selector (Phase 16) directly.

**Risks — read before writing a PLAN.md:**
- Pre-1.0, and the daemon's own docs say its public protocol is already
  at **v4** in ~4 months of the repo's existence — high churn precedent,
  same shape as the Codex hook-trust landmine and the Antigravity
  contract-drift landmine already hit twice in this project. Expect the
  same class of surprise.
- New architecture shape for Logic Loop: a shared background daemon +
  supervisor per machine, not a pure PTY-child process like Claude/Codex/
  OpenCode/Antigravity. Auth tokens and worker descriptors live under
  `~/.prime/agent/` with owner-only permissions — untested against this
  project's TCC/Desktop-folder landmine history; could surface a new one.
- Single-vendor, no deprecation policy documented.

**If picked up:** scope as its own adapter phase (Codex/OpenCode-sized,
not a small patch). MVP = tail `~/.prime/agent/sessions/*.jsonl` for
content (reuse `decisions.ts`) + one companion `prime-agent --mode rpc`
process per bound tab issuing `observe` for the turn/idle signal the file
doesn't carry; gate session discovery by `cwd` like Codex's path gate
(Phase 21). **Do a live spike before PLAN.md** — install the real binary,
drive one session, inspect the actual JSONL + daemon socket — docs have
already diverged from live behavior twice for other adapters (Codex hook
trust, Antigravity's `PreInvocation` firing count) and would be expected
to again here given the v4 protocol churn above.

**Slots into ROADMAP's "Adapters — v2" adapter order** (currently OpenCode
→ Antigravity → "Codex / Gemini / Copilot as their hook/log surfaces
mature") — Prime Agent isn't in that list yet; add it there when this
gets promoted, ranked ahead of Gemini/Copilot on protocol-richness grounds
alone (ACP + observe beats a still-unmatured hook surface).

**Correction (2026-09-08, during the Pi Agent review below):** the
RPC-`observe`-plus-daemon MVP sketched above is more machinery than
needed. Prime Agent's `packages/coding-agent/docs/extensions.md` (not
checked in the original pass) documents an in-process extension system —
`~/.prime/agent/extensions/*.ts`, global, auto-discovered — inherited
verbatim from upstream `pi` (see below). It fires `tool_execution_start/
update/end`, `turn_start/end`, `agent_start/end/settled`,
`before_agent_start`, `session_start`, and more, all as typed JS handlers
inside the running process. That's a direct POST-to-ingest-server target
exactly like the OpenCode plugin (Phase 8) — no daemon socket, no
companion RPC process, no `observe` command needed at all. Revise the MVP
sketch above accordingly: one extension file, not a tailer + companion
process. See the Pi Agent section below for the full event list and the
shared-extension insight that makes this cheaper for both candidates at
once.

---

# Pi Agent adapter candidate (research pass, 2026-09-08)

Source: `github.com/earendil-works/pi` — user asked for a fit review as a
second adapter candidate, same session as the Prime Agent review above.
Research only (GitHub API + raw doc fetches, no local install). **This is
the upstream project Prime Agent is built on** — Prime Agent's README
says so directly, and its docs literally reference pi's internal paths
(`packages/agent/src/types.ts`, `@earendil-works/pi-coding-agent`).
Verdict: **stronger candidate than Prime Agent for Logic Loop's specific
need**, and the two aren't really competing options — see "relationship
to the Prime Agent entry" below.

**Repo facts:** MIT, TypeScript, **103k stars, 12.9k forks**, created
2025-08-09 (13 months old vs. Prime Agent's 4), pushed daily, `v0.85.1`
(85+ releases vs. Prime Agent's `v0.9.4` — far more iteration behind it).
Maintained by Mario Zechner (`badlogic`, of libGDX) under earendil-works.
Real supply-chain hardening documented in the README: pinned direct deps,
`npm-shrinkwrap.json`, `min-release-age=2`, scheduled `npm audit`+
signature checks, isolated release smoke tests — more process rigor
visible than either of the other two adapters this project has evaluated
externally (Prime Agent, herdr).

**The adapter surface — an in-process extension/hook system, not a
protocol to reverse-engineer:**
- `~/.pi/agent/extensions/*.ts` (global, auto-discovered) or
  `.pi/extensions/*.ts` (project-local, loads only after project trust).
  A default-exported function receives a typed `ExtensionAPI`; Node
  built-ins and npm deps both work (`packages/coding-agent/docs/
  extensions.md`, 3000+ lines, by far the most detailed hook doc of any
  adapter reviewed here).
- Event coverage maps almost 1:1 onto Claude Code's own hook set, but
  richer and fully typed instead of JSON-over-stdin: `session_start`
  (≈`SessionStart`, with `reason: startup|reload|new|resume|fork`),
  `before_agent_start` (≈`UserPromptSubmit`, can inject a message or
  rewrite the system prompt), `turn_start`/`turn_end`,
  `tool_execution_start`/`update`/`end` (≈`PreToolUse`/`PostToolUse`,
  `tool_execution_start` can `{ block: true, reason }` a call — real
  policy enforcement, not just observation), `agent_end`/`agent_settled`
  (`agent_settled` is the real "Pi will not run again on its own" signal
  — closer to a clean idle/Stop boundary than Claude's own `Stop` hook,
  which Phase 15/16 found has real edge cases), `session_shutdown`,
  `ui_prompt_start`/`end` (fires around blocking extension UI — a
  "waiting on user" signal for free, no need to reverse-engineer it the
  way Antigravity's `PreInvocation` had to be).
- Each handler gets `ctx.sessionManager` (session id, session file path,
  cwd) directly — no separate file-discovery step, no header-sniffing.
  Combined with `process.env.LOGIC_LOOP_TAB_ID` (inherited automatically
  since the extension runs inside the same process the tab spawned),
  every POST this extension makes can carry the tether header and
  session id in one shot — the same shape as `ingest::hook_command()`'s
  output today, assembled in JS instead of a shelled `curl`.

**Session storage — a nicer tether-discovery primitive than Prime
Agent's:** `~/.pi/agent/sessions/--<sanitized-cwd>--/<timestamp>_<session-
id>.jsonl` — the project path is encoded directly in the directory name.
Prime Agent moved *away* from this exact scheme to a flat directory
(per its own docs: "Current releases keep sessions in a flat directory;
older per-project directories are migrated automatically") — meaning pi's
current on-disk layout is actually easier to gate by cwd than Prime
Agent's, closer to Codex's date-partitioned `rollout-*.jsonl` gate
(Phase 21) than to Prime Agent's flat-dir-plus-header-read.

**Version field is the same lineage:** header `version: 3` ("Renamed
`hookMessage` role to `custom`, extensions unification") — Prime Agent's
session-format.md carries the identical version history verbatim,
confirming the fork point.

**What pi does *not* have that Prime Agent added:** no `acp.md`, no
`daemon.md`/`architecture.md`, no `rlm.md`, no `--mode acp`, no RPC
`observe` command, no resident-daemon multi-worker supervisor. Confirmed
by diffing docs directories directly (`acp.md` 404s on pi's raw GitHub
path) rather than assumed. None of that turns out to matter for Logic
Loop's use case — the extension-hook system above already covers
everything an ingest adapter needs without any of it.

**What pi has that Prime Agent's docs haven't caught up to:** newer
top-level docs — `environment-variables.md`, `llama-cpp.md` (local model
support), `security.md` — absent from Prime Agent's docs tree. Confirms
Prime Agent trails its upstream; building against pi directly means one
fewer place for the two to silently drift apart.

**Relationship to the Prime Agent entry above — not a choice between
them.** They're different binaries (`pi` vs. `prime-agent`), different
config dirs (`~/.pi/agent/` vs. `~/.prime/agent/`), and someone running
one doesn't have the other. But because Prime Agent forked pi's coding
agent wholesale, **the extension API is identical** — same event names,
same `ExtensionAPI` shape, same `ctx.sessionManager`. A single extension
body written once could ship to both `~/.pi/agent/extensions/
logic-loop.ts` and `~/.prime/agent/extensions/logic-loop.ts` with only
the install path (and maybe an ingest-payload `agent` tag) differing —
the same "reuse verbatim" move Codex's adapter made off Claude's
`ingest::hook_command()` in Phase 10. If both ever get built, build the
shared extension body once and parameterize the install location, don't
duplicate the hook logic.

**Risks:**
- Same pre-1.0 semver posture as Prime Agent (`v0.85.1`), though the
  supply-chain rigor and 13-month/103k-star track record make silent
  breaking changes to the *extension API specifically* less likely than
  Prime Agent's newer, less-battle-tested fork. Unconfirmed without a
  live spike either way — flag, don't assume.
- Extensions run with full user permissions, no sandbox (README says so
  directly) — not a Logic Loop-specific risk, but worth remembering the
  installed extension file is trusted code the same way Claude Code's
  hook commands already are.
- Hot-reload (`/reload`) re-binds extensions per session — an extension
  holding open state (e.g. a persistent fetch keep-alive) needs to clean
  up in `session_shutdown`, or a reload could double-register handlers.
  Unconfirmed live; check during a spike.

**If picked up:** MVP is one TypeScript extension file — `pi.on(
"tool_execution_end", ...)`, `pi.on("agent_settled", ...)`,
`pi.on("session_start", ...)`, `pi.on("before_agent_start", ...)` — each
handler does a fire-and-forget `fetch()` POST to the ingest server
carrying `X-Logic-Loop-Tab` from `process.env` and the session id from
`ctx.sessionManager.getSessionId()`. No Rust-side hooks.json writer
needed the way Claude/Codex adapters have — the Rust side only needs to
place the `.ts` file at `~/.pi/agent/extensions/` (global toggle,
install/remove idempotent, same shape as OpenCode's plugin-file
adapter). Do a live spike before PLAN.md regardless — same standing
advice as the Prime Agent entry: docs and live behavior have diverged
before on every adapter built here so far.

**Slots into ROADMAP's "Adapters — v2" adapter order** — rank pi ahead of
Prime Agent given the maturity gap, and note in ROADMAP that both share
one extension-body implementation per the point above.

---

# Hermes Agent adapter candidate (research pass, 2026-09-08 — last of this batch, per user)

Source: `github.com/NousResearch/hermes-agent`. Research only (GitHub API
+ raw doc fetches, no local install). Verdict: **viable, but the most
architecturally different of the three candidates reviewed this session**
— real structured-protocol wins (a native hook system, a shipped ACP
adapter) offset by a session-identity model that doesn't think in terms
of project directories at all. Buildable, with one concrete mitigation
identified below; not a clean drop-in the way pi/Prime Agent are.

**Legitimacy check (done explicitly given the numbers below look
implausible at a glance):** GitHub API reports **243.5k stars, 50.2k
forks, 41.1k open issues** — an order of magnitude past Prime Agent and
pi both, on a repo created 2025-07-22. That combination (huge stars +
five-digit open issues) is exactly the shape of a star-farmed repo, so it
was checked rather than taken at face value: **3,365+ contributors**
(paginated contributor count), commits landing multiple times per hour
from named individual authors, weekly dated releases (`v2026.9.7`,
`v2026.8.31`, `v2026.8.27`, ...), a real docs site, a real Discord, and an
`AGENTS.md` with a genuinely rigorous contribution rubric (footprint
ladder, cache-safety invariants, an explicit "what we don't want" list).
Real project, real scale, built by Nous Research (known for the Hermes
model fine-tunes) — not inflated.

**What it is — read this before assuming it's "a coding CLI":** per its
own `AGENTS.md`, Hermes "runs the same agent core across a CLI, a
messaging gateway (Telegram, Discord, Slack, ~20 platforms), a TUI, and
an Electron desktop app," with a persistent cross-session memory model
("Honcho dialectic user modeling," periodic memory nudges, autonomous
skill creation) explicitly designed to build "a deepening model of who
you are across sessions" — a personal-assistant product with coding as
one capability, not a coding-first tool like the other two candidates.

**Structured-protocol wins (clears the ROADMAP litmus test, same bar as
pi/Prime Agent):**
- **Native hook system** (`gateway/hooks.py`) — hooks live at
  `~/.hermes/hooks/<name>/HOOK.yaml` (name, description, events) +
  `handler.py` (`def handle(event_type, context)`, sync or async).
  Events: `gateway:startup`, `session:start/end/reset`, `agent:start`,
  `agent:step` (once per tool-loop turn), `agent:end`, `command:*`
  wildcard. **A failing handler is logged, never fatal** — the exact
  fail-open contract Logic Loop's own invariant #2 requires, stated
  almost verbatim in the module's own docstring. Coarser granularity
  than pi's per-tool `tool_execution_start/end`: Hermes fires once per
  whole turn, not once per individual tool call — the Accomplished
  panel's per-tool detail would need the state DB (next point), not the
  hook payload alone.
- **A shipped ACP adapter** (`acp_adapter/` — `server.py`, `session.py`,
  `events.py`, `permissions.py`, `edit_approval.py`, `model_catalog.py`)
  — same `agentclientprotocol.com` wire protocol as Prime Agent's `--mode
  acp`, invoked as `python -m acp_adapter`. Confirms the ROADMAP note
  that "several providers are converging on ACP" a third time over.
- **SQLite-backed state, not JSONL** — `hermes_state_*.py` (schema, WAL,
  FTS5 search, sessions, repair, portability). WAL mode means safe
  concurrent reads while the agent writes — arguably a *better* tailable
  primitive than a growing JSONL file, closer to Logic Loop's own "dumb
  SQL views over append-only tables" philosophy (invariant #3) than any
  other adapter's session format. Full per-message/tool-call content
  would come from here to backfill what the coarser hook events omit.

**The real mismatch — session identity has no project-directory concept.**
Read `gateway/session.py` directly: `SessionSource` and `build_session_key`
are built entirely from *messaging* dimensions — `platform`, `chat_id`,
`chat_type`, `thread_id`, `user_id` — there is no `cwd` field anywhere in
the session key. For the CLI (`Platform.LOCAL`), a bare `hermes` invocation
does not key its session by working directory the way Claude/Codex/
OpenCode/Antigravity/pi/Prime Agent all do — every CLI session under one
profile is, by design, the same continuous conversation with the same
long-term memory, matching the "deepening model of who you are across
sessions" framing above. Two Logic Loop tabs pointed at two different
project directories would collapse onto the *same* Hermes session/memory
by default — a real regression from the per-tab isolation every other
adapter gets for free from cwd.

**Mitigation — confirmed to exist, not just hoped for.** Hermes has a
first-class `-p`/`--profile <name>` flag (`hermes_cli/config.py`,
`hermes_cli/profiles.py`): each profile gets its own `HERMES_HOME`,
`profiles/<name>/` state dir, config, secrets scope, and memory —
`AGENTS.md`'s own contribution rubric confirms this is deliberate design
("Profiles are independent islands on purpose... a PR adding live config
inheritance from the default profile was closed because coupling
profiles is exactly what the design prevents"). Logic Loop's `pty_spawn`
launching `hermes --profile <sanitized-project_key>` per project would
give each project its own isolated Hermes session/memory — the same
"tab tether, not cwd-guessing" move Logic Loop already prefers for
Claude/Codex, just supplied as an explicit spawn-time flag instead of an
env var. **Unconfirmed without a live spike:** whether `--profile` fully
isolates session-key derivation for `Platform.LOCAL` the way the docs
imply, and whether Logic Loop's existing cwd-fallback path (for sessions
started outside the app) has anything to bind to if profile isolation
turns out to be the only reliable key.

**Risks:**
- **Confirmed active internal churn, evidenced directly, not assumed.**
  `COMPAT_MANIFEST.md` documents a September 2026 module decomposition
  (PR #102117) that moved **1,148 public names** to new locations, with a
  temporary compat shim *expiring 2026-09-14* — six days after this
  research pass. This is exactly the class of breaking-change risk that
  already bit this project twice (Codex hook-trust invalidation,
  Antigravity `PreInvocation` surprises), except here it's scoped to
  **internal Python import paths only** — the manifest explicitly frames
  it as a plugin-author concern, not a change to the documented
  `HOOK.yaml`/`handler.py` hook contract or the ACP wire protocol. If
  Logic Loop's adapter is built strictly against those two documented
  surfaces (never importing internal `hermes_cli.*`/`gateway.*` modules
  directly), this specific churn shouldn't reach it — but it's honest
  evidence of how fast this codebase moves versus pi/Prime Agent, and a
  reason to re-check after any Hermes version bump rather than assume
  stability.
- Weekly release cadence, ~300-file `hermes_cli/` alone — the largest,
  fastest-moving codebase of the three candidates. More surface for
  something adjacent to the hook contract to shift under an adapter over
  time, even with the documented compat process.
- Coarser hook granularity than pi/Prime Agent means the adapter likely
  needs both the hook (for turn/session boundaries) and a direct SQLite
  read (for per-tool/message content) — two integration points instead
  of one, though both are first-party structured sources, not screen
  parsing.

**If picked up:** confirmed-viable MVP is `~/.hermes/hooks/logic-loop/`
(`HOOK.yaml` declaring `session:start/end`, `agent:start/step/end`, plus
a `handler.py` that does a fire-and-forget POST to the ingest server) for
turn/session boundaries, backed by a read-only SQLite query against the
profile's state DB for per-tool-call content (WAL mode makes concurrent
reads safe). Spawn with `--profile <project_key>` for isolation. **Spike
before PLAN.md, more than for the other two** given the confirmed live
churn evidence above — verify `--profile` session isolation and the
actual `agent:step`/`agent:end` context payload shape against a real
running `hermes`, not just the docstring.

**Slots into ROADMAP's "Adapters — v2" adapter order** — rank behind pi
and Prime Agent given the session-identity mismatch and the confirmed
active churn; the ACP-adapter path is the safer of Hermes's two
integration surfaces if this is ever built, since it's a versioned
external wire protocol rather than an in-repo Python contract.

---

**Batch note:** three adapter candidates reviewed this session (Prime
Agent, Pi Agent, Hermes Agent), capped here per user request. Ranked
build order if any get picked up: **pi first** (richest hook API, most
mature, no session-identity mismatch), **Prime Agent second** (same hook
API verbatim, smaller/younger project, share pi's extension body per the
note above), **Hermes third** (real structured surfaces but the
project-directory mismatch and confirmed active internal churn make it
the highest-effort, least drop-in of the three).

---

## Mid-September Idea Runway (2026-09)

1. **`--json-schema` for the extractor.** idea is forcing every agent reply
   through a JSON schema on the CLI instead of parsing prose. Our
   `parseExtraction` still strips ` ```json ` fences by hand. Check whether
   `run_extractor` can pass `--json-schema` and drop the fence tolerance
   entirely; likely also removes the haiku fence-wrapping class of bug
   from Phase 33.1 for good.
2. **Usage runway moved up.** Other projects ship remaining-usage and reset
   time inline in the agent picker. Validates Plan 023 (Claude statusline
   limits meter) as table-stakes, not polish.
3. **"Potential next actions" as suggestion buttons.** Up to three
   or four standalone prompts in the user's voice, shown only on a completed turn.
   Cheap UI value; could ride the extraction call we already make if the
   cost model tolerates one extra field. Must stay human-triggered
   (invariant #4): a button the user clicks is fine, auto-send is not. Toggle
    on/off if token spend is increased for lean ops.
4. **Scheduled prompts: demand signal only.** Saved prompts run
   on demand or on cron by the app's own scheduler. Real user demand, hard
   no under invariant #4. If it ever comes up, the only admissible shape
   is spawn-time process configuration (like fan-out `cmd`), never a write
   into a live PTY.
5. **Headless stream-json is a different product, not a shortcut.**
   Driving `claude --print --input-format stream-json` gives full UI
   ownership (and a paid-SaaS look) at the cost of the agent's own TUI,
   permissions flow, and hooks (Comes with setting `disableAllHooks`). Our
   observation model can't coexist with that spawn shape. Not a direction;
   noted so the tradeoff is explicit next time it's proposed.
