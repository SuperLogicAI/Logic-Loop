# Seen ≠ reviewed ≠ resolved

Status: **APPROVED 2026-10-09 (`PHASE 60 APPROVED`, defaults 1–4,
including both review passes).** Branch `feat/phase-60-seen-reviewed`.
Implemented; focused checks and all gates green. Built-app checks 96–103
passed, including restart persistence and maintainer Dock badge observation.
**PHASE 60 ACCEPTED** (2026-10-09).

Source: `docs/IDEAS.md` "C. Seen ≠ reviewed ≠ resolved" (first half; the
second half, empty-state clarity, shipped in Phase 19). It is the pair to
Phase 58's re-entry brief in that file's suggested sequence (inbox → brief +
review queue → focus mode + departure capture).

## Problem

Two places record a resolution the human never made:

1. **Results clear on sight.** `claimTab` (`App.tsx` ~740) writes
   `result_claimed` the moment a tab is active and the window focused.
   `unclaimedResults` (`repo.ts` ~333) then drops the row, so Accomplished's
   "Agent finished, unclaimed" line vanishes the instant you look. Seen is
   recorded; whether you dealt with it is not.
2. **Next's "✓ Done" on a decision writes `answered`.** `computeMomentum`'s
   decision branch resolves via `setDecisionStatus(d.id, "answered")`
   (`SidePanel.tsx` ~683). Clicking Done to clear the card files an answer
   that may never have been given, which is false data for the Decisions
   history, Copy update, and Overview.

## What exists

- `result_landed` (only when a Stop lands on a tab you aren't watching) and
  `result_claimed` (focus). Both append-only events with `tab_id`/
  `project_key`. Dock badge and tab glow read the in-memory `unseenStops`.
- `hook:UserPromptSubmit` rows carry `$.provenance` = `human` | `auto`
  (Phase 15, stamped before write in `App.tsx` ~1022). It is a heuristic
  (`computeProvenance`, `ingest.ts` ~405): `human` when there's no tether or
  no keystroke history, or any keystroke within 5 s; otherwise `auto`.
- Completion rows in Accomplished are **project-wide** (`unclaimedResults`
  by cwd), but the tool rows under them are **scoped to the tab's bound
  session** (`scopeBySession`, `SidePanel.tsx` ~427). A row from another
  session sits above evidence that isn't its own.
- `resolveAttentionRoute` (`attention.ts` ~37) already maps
  `{tab_id, session_id, project_key, adapter_id}` to a live tab or
  `unavailable`.
- Decisions panel already has the explicit set: ✎ answer, ⤳ delegate,
  ✕ dismiss.
- SQL-against-fixture precedent: `scripts/stale-decisions-check.ts` runs
  `staleDecisionSql` from `src/lib/staleDecisions.ts` on `node:sqlite`.

## Build

1. **One new event, `result_reviewed`** (append-only), payload
   `{ v: 1, landed_id, project_key, tab_id, action: "reviewed" | "dismissed" }`.
   `landed_id` is the `events.id` of the `result_landed` row the human
   clicked. A review closes **that row only**: if result B lands after the
   panel rendered A, clicking Reviewed on A leaves B open. *(Codex 1.)*
2. **Tracking start = migration 14.** The migration inserts one event,
   `result_review_tracking_started`, with a fixed `dedupe_key` (unique index
   from migration 6) and `ts` = migration time in milliseconds, matching
   `addEvent`. The marker has reserved session id
   `__logic_loop_review_tracking__`. Migrations run once, in order, before the app accepts any hook, so there is no runtime init path,
   no StrictMode race, and no cutoff that can move. The query reads
   the earliest `(ts, id)` of that type; no marker row → empty queue (fail safe: never
   shows old results, never hides new ones as resolved). Results landed
   before the cutoff never enter the queue. Today's DB (counts only): 341
   sessions with a result, 218 with no later human prompt, 16 from the last
   7 days; a backfill would open with a 218-row queue. *(Codex 4, different
   mechanism: a migration instead of a guarded first-run write.)*
3. **Three states, derived in SQL** (invariant #3), per `result_landed` row
   at or after the cutoff:
   - *Unseen:* no later `result_claimed` for its session. Unchanged: dock
     badge, tab glow, Attention Inbox all keep this meaning.
   - *To review:* no `result_reviewed` with its `landed_id`, **and** no
     later `hook:UserPromptSubmit` in the same session with
     `json_extract(payload_json, '$.provenance') = 'human'`. Missing or
     `auto` provenance never closes a result (explicit `= 'human'`, not
     `<> 'auto'`). Only the session's latest landed row is shown; older
     ones are superseded by it. Select the newest `(ts, id)` before filtering
     reviewed rows, so reviewing the newest never resurfaces an older row.
   - *Reviewed:* otherwise.
   **Accepted limitation (Codex 3):** provenance is a heuristic. A loop
   resubmit within 5 s of a keystroke reads `human` and closes the result
   without a click; a typed prompt delivered late reads `auto` and leaves it
   open (one extra click). Missing keystroke history (including after an
   app restart) or a missing tether also defaults to `human`, so automatic
   prompts can close a result without recent typing. Not strengthening the
   signal this phase; UI copy says "closed by your next prompt", not "you
   reviewed this".
   The SQL lives in `src/lib/reviewQueue.ts` (exported strings, like
   `staleDecisions.ts`); `repo.resultsToReview(cwd)` runs it and replaces
   `unclaimedResults` in SidePanel. `unclaimedSessions` (startup seeding of
   `unseenStops`) stays.
4. **Accomplished row, project-wide queue with its own identity.** *(Codex
   2.)* Each "Agent finished" row shows agent icon + tab title (from
   `resolveAttentionRoute` over its `tab_id`/session) and state: `● unseen`
   or `○ seen 4m ago`. Evidence:
   - Row's session is this tab's bound session → no link; its tool rows are
     the ones below.
   - Another live tab → **↗ Open** switches to that tab (its Accomplished
     shows its own evidence). Switching claims it, as today.
   - No live tab (closed, or `unavailable`) → label "tab closed", no link;
     still reviewable/dismissable. Evidence is gone with the session's tab;
     the row says so instead of borrowing this tab's files.
   Actions: **✓ Reviewed** (`action: reviewed`) and **✕** (`action:
   dismissed`; it currently writes `result_claimed`). "N older" collapse
   kept. Header count reads "Accomplished: N to review".
5. **Next card, decision branch only.** Replace "✓ Done" with the Decisions
   panel's explicit set: **⤳ Delegate** (`delegated`) and **✕ Dismiss**
   (`dismissed`), keeping **↳ Ask** (prefill, unchanged). No button writes
   `answered`: an answer goes through the terminal. Landing note keeps
   "✓ Done" (closing your own note is accurate), planned keeps "▶ Start".
   `MomentumItem.done` becomes a list of labelled actions; the cascade order
   is unchanged.
6. **Re-entry brief** (`buildBrief`). *(Codex 5.)* Needs you counts **all**
   results to review for this tab's session, including ones that landed
   while away (Changed reports activity, not an open-review count, so this
   isn't double counting). Needs you becomes a list of items, each its own
   link: "N new decisions" → Decisions, "N to review" → Accomplished,
   "agent waiting" (plain text). `Brief.needsYou` changes from a
   string to `{ text, target }[]`.
7. **Checks.**
   - New `scripts/review-queue-check.ts` (`npm run review-queue:check`) runs
     the real `reviewQueue.ts` SQL and actual migration SQL on `node:sqlite`
     fixtures with the actual migration-2/6/14 events shape: unseen → seen → reviewed; stale-row
     click (review A's `landed_id` leaves later B open); review B never
     resurfaces superseded A; same-ms ordering uses event id; `human` prompt
     closes, `auto` and missing provenance don't; pre-cutoff rows excluded;
     no marker → empty; duplicate marker insert rejected by `dedupe_key`
     and the cutoff unchanged; dismissed counts as resolved; rows from two
     sessions in one project both listed with their own `tab_id`. Register
     `review-queue:check` in `package.json` and include it in `npm run check`.
   - `scripts/momentum-check.ts`: decision item exposes Delegate/Dismiss,
     no `answered` action; landing/planned unchanged.
   - `scripts/delta-check.ts`: Needs you items and targets, review count
     includes arrivals while away.
   - `scripts/unclaimed-check.ts` unchanged (flag behavior only).
   Compatibility wiring: update Project Overview's two read-only momentum
   callers to the new callback names; their behavior stays unchanged. Refresh
   the panel after persisted landed/claimed/prompt events so the queue updates
   immediately. No ingestion or terminal-input behavior changes.
8. **Docs.** `docs/PROGRESS.md`, `docs/TESTING.md` Phase 60 items, IDEAS C
   marked shipped.

## Decisions (defaults marked; confirm or change at approval)

1. **Implicit review by human prompt.** **Yes, with the heuristic limit
   above accepted** (default): your next typed prompt into that session
   closes the result. Without it the queue fills with results you obviously
   handled. Alternative: explicit click only (strict, noisier).
2. **History.** **Start clean** (default) via migration 14's marker.
   Alternative: backfill the last 7 days (16 rows today).
3. **Attention Inbox.** **Unchanged** (default): the Inbox stays "unseen";
   the review queue is per-project in Accomplished + brief. Adding seen-but-
   unreviewed results there risks the `99+` problem from Phase 26/27.
   Alternative: list them in Backlog.
4. **Next card on a decision.** **Delegate + Dismiss, no Done** (default).
   Alternative: keep one button, relabelled "✕ Dismiss" (simplest, loses
   delegate).

## Out of scope

- Strengthening prompt provenance (accepted limitation, item 3).
- Blockers (never in Next; their panel already has explicit resolve).
- Per-tool-event review bookkeeping (IDEAS C's own risk note).
- Showing a closed tab's evidence (needs per-result file attribution; not
  this phase).
- Focus mode (IDEAS D), lighter departure capture (IDEAS E).
- Home dashboard counts.

## Verify

- Focused: `npm run review-queue:check`, `npm run momentum:check`,
  `npm run delta:check`, `npm run unclaimed:check`.
- Gates: `npm run check`, `npx tsc --noEmit`, `npm run build`,
  `cd src-tauri && cargo test --lib`, `cargo clippy --all-targets -- -D
  warnings`, `git diff --check`. No golden (no prompt change). Rust change
  is migration 14 only.

## Manual checks (docs/TESTING.md Phase 60)

Run in the built app.

- [ ] 96. Background a Claude tab, let it finish, switch to it: dock badge
      clears as today; Accomplished keeps the row as `○ seen` with this
      tab's title.
- [ ] 97. Click ✓ Reviewed: row gone, survives restart.
- [ ] 98. Repeat 96, then type a new prompt into that tab: row gone without
      a click.
- [ ] 99. A loop resubmit (`auto` provenance, no keystrokes for >5 s) does
      not close it.
- [ ] 100. First launch on an existing DB: no pre-Phase-60 results in the
      queue; relaunch: still none, new results still appear.
- [ ] 101. Two tabs in one project, both finish in background: each tab's
      Accomplished lists both rows; the other tab's row shows ↗ Open and
      switches to it; close that tab: row reads "tab closed", ✓ Reviewed
      still works.
- [ ] 102. Next card on a decision shows Ask / Delegate / Dismiss; Delegate
      marks the decision delegated in the Decisions history, never answered.
- [ ] 103. Leave a tab, let it finish (and open a decision) while away,
      come back: brief's Needs you shows "1 new decision · 1 to review",
      each jumps to its own section.

## Verification record (2026-10-09)

Focused review queue, momentum, delta and unclaimed checks passed.
`npm run opencode:check`, `npm run check` (including review-queue),
`npx tsc --noEmit`, `npm run build`, `cargo test --lib` (177 passed,
1 intentionally ignored), `cargo clippy --all-targets -- -D warnings`,
and `git diff --check` passed. tsx and socket-based Rust tests needed
execution outside the filesystem sandbox. Build has the existing chunk-size
warning. No extraction prompt change; golden was not run. Manual checks
96–103 not run; no app reinstall/relaunch or phase acceptance claimed.
