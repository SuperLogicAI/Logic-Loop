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

---

# Fable 5.1 concepts (review of 2026-09-02)

Source: Fable 5.1 build review, 2026-09-02. Five concepts were proposed;
#1 (since-you-left delta) and #2 (clock on state) were accepted on the spot
and live in `PLAN.md` as Phase 14. The three below are parked here with
enough of a build plan that whoever picks one up doesn't re-derive it.
Priority as agreed with the user: #3 likely next, #4 long-term (design for
it, don't build it), #5 off the table for now.

Review's framing, kept because it drives all three: Chrome tabs are fine as
a **viewport** and fail as **status**. Documents don't stall, don't age,
don't run twelve iterations while you sleep, don't owe you an answer.
Phase 14 adds time; #3 adds provenance; #4 moves status out of the tab
strip entirely.

## 3. Turn provenance + loop digest — likely add-on

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
#4 in spirit: the app would be shaping agent output, even if it never
types into the terminal.

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
`docs/ROADMAP.md`. Concrete detail worth carrying forward: surface each
account's rate-limit reset countdown, not just current usage — and support
hot-swapping accounts without re-authenticating. Same dependency as the
existing item (external: Safe Router v0 log).

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
