# Human time in projects

Status: **APPROVED 2026-10-08 (`PHASE 57 APPROVED`, decisions 1-4 as
recommended). Branch `feat/phase-57-time-in-projects`. Built; gates green;
live checks 74-79 passed. ACCEPTED 2026-10-08 (`PHASE 57 ACCEPTED`).**

Source: ROADMAP "Project dashboard follow-ons" → "Spend + human time"
("Optional manual time tracker … Unknown ≠ zero; estimated ≠ invoiced").
The maintainer wants per-project human time, primarily for client billing.
Idle cap set at approval-discussion: **15 min**.

## What exists

- `tab_left` (Phase 14a, `src/App.tsx` `markTabLeft`) is written when a tab
  stops being looked at: tab switch, split change, entering Home/Overview,
  window blur, tab close. 6,797 rows since 2026-09-05, payload carries
  `project_key`, `tab_id`, `adapter_id`. Only tabs with a bound session.
- There is **no "started looking" event.** `result_claimed` fires on
  focus/switch only when a tab had an unseen result, so it can't mark starts.
- Project Overview already shows "Agent time (observed)" from a pure
  function (`observedAgentTime`, `src/lib/dashboard.ts`) over a repo read.
  Human time follows the same shape and sits next to it.

So a `tab_left` alone can't tell "switched here 2 min ago" from "Cmd-Tabbed
away, came back an hour later". Two new event types fix that; no Rust, no
migration (`events` is already generic and append-only).

## Build

1. **`tab_entered` event.** Mirror of `markTabLeft`, same payload, same
   "only tabs with a bound session" rule. Written when a tab joins the
   effective visible set (the existing visible-set effect already computes
   departures; add arrivals) and, for every visible tab, on window `focus`
   (the existing focus listener). Visible + `document.hasFocus()` only.
2. **`tab_active` heartbeat.** On human input in the window — `keydown`,
   `pointerdown`, `wheel` (capture phase) — write `tab_active` for each
   visible tab, throttled to at most one per tab per 60 s. Records that input
   happened, never what it was: no key, no text, no PTY bytes. Not written
   while the window is unfocused.
3. **`projectHumanTimeEvents(projectKey, since)`** in `repo.ts`: the three
   event types for a project since a timestamp, ordered by tab then ts.
4. **`humanTime(events, capMs = 15 min)`** in `dashboard.ts`, pure:
   - Per tab, walk events in order. Each gap from an `tab_entered` or
     `tab_active` to the next event of that tab counts as
     `min(gap, capMs)`. A gap that starts at `tab_left` counts nothing.
   - The trailing open interval (no later event yet) counts up to "now",
     capped — the tab you're looking at right now shows live time. Known
     ceiling: a crash/kill that skips `tab_left` leaves at most one capped
     15 min on that tab; no extra bookkeeping to chase it.
   - Merge intervals across a project's tabs (sort + union), so a split
     with two tabs of the same project counts once. Two *different*
     projects split side by side each get the time (you're looking at both).
   - Returns `{ totalMs, byDay: Map<YYYY-MM-DD, ms>, sinceDate }`, local days.
5. **Project Overview: "Your time" block** beside "Agent time (observed)",
   honouring the existing Today / 7d / 30d range: total, plus "since
   <date>" when tracking began inside the range. Footnote: "Counted while
   a tab in this project is visible and you're active; gaps over 15 min
   count as 15." Hidden until the first `tab_entered` exists.
   *Revision (2026-10-08, live check):* the time row (Your time + Agent
   time) moved to the top of Project Overview with the range tabs, which
   are page-wide; the work log header shows the range. Bug fixed:
   "tracking since" counted pre-057 `tab_left` rows (showed 10/2 on day 1).
   *Revision 2 (2026-10-08):* the card also shows an all-time total ("·
   Xh Ym all time") from one all-time read, instead of an "All" range tab
   (that would drag the work log and the 30-day-capped git read along).
6. **Copy update gets hours.** Add one line per day in range
   (`2026-10-08  1h 25m`) plus the total to the existing Copy update draft
   — still an editable draft, nothing sent.
7. **Check.** `scripts/dashboard-check.ts` cases for `humanTime`: plain
   enter→left; idle gap capped at 15 min; left→entered gap ignored;
   same-project split counted once; cross-project split counted for both;
   open trailing interval capped; day boundary split across two days.
8. **Docs.** `docs/PROGRESS.md` entry; `docs/TESTING.md` Phase 57 items;
   ROADMAP follow-on marked partly done (human time yes, spend no).

## Decisions (defaults marked; confirm or change at approval)

1. **History.** **Start clean** (default): time counts from upgrade; the
   UI says "since <date>". Alternative: estimated backfill from old
   `tab_left` rows (start = previous `tab_left`, capped), shown separately
   as "estimated". Default because old rows have no start or input signal,
   and estimated hours are exactly what a billing number shouldn't contain.
2. **Plain shell tabs.** **Excluded** (default): matches `tab_left`'s
   bound-session rule; `events.session_id` is NOT NULL and a synthetic id
   would leak into session-keyed panels. Time in a zsh tab with no agent is
   not counted. Alternative: include them with the tab tether as
   `session_id` (needs auditing every session-keyed query).
3. **Where it shows.** **Project Overview + Copy update** (default).
   Alternative: also a per-project hours line on Home cards.
4. **Heartbeat granularity.** **60 s throttle** (default): ~1 row/min per
   visible tab while active (~500/day). Coarser loses accuracy at
   interval edges; finer adds rows for nothing.

## Out of scope

- Token spend per project (still no per-project source).
- Manual start/stop timer, CSV/invoice export, rounding rules.
- Time in apps outside Logic Loop (editor, browser).
- Idle detection beyond window focus + input (no OS idle APIs).

## Verify

- `npx tsx scripts/dashboard-check.ts` (new `humanTime` cases).
- `npm run check`, `npx tsc --noEmit`, `npm run build`,
  `cd src-tauri && cargo test --lib`, `cargo clippy --all-targets -- -D
  warnings`, `git diff --check`. No golden (no prompt change).

## Manual checks (docs/TESTING.md Phase 57)

Run in the built app, not `tauri dev` (see LANDMINES: dev reload kills tabs).

- [ ] 74. Work in one project tab ~5 min with a stopwatch: "Your time"
      today is within 1 min of the stopwatch.
- [ ] 75. Cmd-Tab away 10 min, come back: those 10 min don't count.
- [ ] 76. Stay focused but idle 20 min: adds 15, not 20.
- [ ] 77. Split two tabs of the same project 5 min: adds 5, not 10.
- [ ] 78. Copy update shows today's hours line.
- [ ] 79. Event rows: `SELECT type, count(*) FROM events WHERE type IN
      ('tab_entered','tab_active') GROUP BY type` — counts only, sane rate.
