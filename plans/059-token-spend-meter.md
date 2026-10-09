# Token spend meter: subagent badge + TSPM (v1-v3)

Status: **APPROVED 2026-10-09 (`PHASE 59 APPROVED`, decisions 1-5 as
recommended), rev 3. Branch `feat/phase-59-token-spend-meter`. Checkpoint 1
accepted live (87, 88, 90; 89 pending). Checkpoint 2 built; gates green;
awaiting live checks 91-93.** One phase, three
checkpoints, one `PHASE 59 ACCEPTED` at the end.

*Revision 1 (build, checkpoint 1):* "hooks not installed/trusted →
unknown" (Decision 3) is not implemented as a badge state — with hooks
missing no Start ever arrives, so there is nothing to mark; the adapter
toggle's "update" state is the signal instead. Unknown = open Starts on a
dead tab or after the parent's SessionEnd.
*Revision 2 (build):* also found that `ingest.rs` starts a transcript
tailer from any hook's `transcript_path`; Subagent* hooks now skip it
(a child's path would be tailed as the parent).
*Revision 3 (live check 88):* the badge never showed. Cause: the tab's
bound `sessionId` was stale — a Claude `/clear` or in-tab `/resume` starts
a new session, and by design (LANDMINES "never let a tethered SessionStart
take over a tab…") the tab keeps the old one. The badge now reads rows by
tab tether (falling back to session for untethered rows), like
`eventsSince`, and a parent SessionStart from a different session turns
the previous session's open children unknown. **Carries into Checkpoints
2-3:** usage attribution must not rely on the tab's bound session alone —
key by tether (hook `tab_id`) where present, or the meter goes blank after
any `/clear`.
*Revision 4 (maintainer, check 90):* an unknown ("?") ages out 10 minutes
after it becomes unknown (session switch/end time; for a dead tab, its last
row), since nothing else clears it in a live tab. Checks 87, 88 and 90
passed 2026-10-09; 89 (Codex badge) pending the maintainer's Codex test;
Checkpoint 2 started at the maintainer's request.
*Revision 5 (build, checkpoint 2):* usage rows carry the hook's tether
(`tab_id`) and project key; the meter queries by tether with session
fallback (Revision 3's lesson). Coverage lives in memory from
`usage://thread` (re-emitted after restart once the session's next hook
arrives). Readers start on a Codex hook, so after an app restart a tab's
meter shows persisted rows but no new ones until Codex next acts.
"unsupported" = completed turns (`task_complete`) without usage records.
*Open issue found at check 88 (not fixed here):* hook delivery lagged
30-50 s during a burst of parallel subagent tool calls (all hooks, parent
included; transcript tailing stayed ~1 s). Likely the single-threaded
ingest HTTP loop plus each hook's sequential 2 s curl. Pre-existing; affects
every hook-driven panel. Badge correctness unaffected, only its timing.

Source: `docs/IDEAS.md` "Token spend: TSPM + cost by project", including
its spend-source findings and Checkpoint 0 results (Codex sampler + Claude
headless reconciliation, both done). Failure mode: with several agents
running you can't tell which one is burning budget, or spawning subagents
to excess, until the invoice.

## What exists

- **Hooks:** Claude `HOOK_EVENTS` (`ingest.rs` ~676) and Codex
  `CODEX_HOOK_EVENTS` (`codex.rs` ~11), 7 each; neither has
  `SubagentStart`/`SubagentStop`. `isSubagentHook` (`ingest.ts` ~479, any
  non-empty `agent_id`) keeps subagent hooks out of state transitions and
  result landing; the epoch guard tolerates late `SubagentStop`.
- **Hook upgrades:** Claude has an `outdated` check that turns the toggle
  into "update" (`AgentStatusBar.tsx` ~53, ~160). Codex has none:
  `codex_hooks_status` (`codex.rs` ~144) reports enabled on any owned hook,
  so existing installs would never get new events.
- **Tailing:** `TailerRegistry` keyed by `session_id`, one tailer per
  session, from the file's current end (`ensure_tailer`, `ingest.rs` ~422);
  lines feed `ingest://transcript` → events/extraction. Claude children
  share the parent `session_id`, so this registry can't hold them, and
  backfilling through it would replay extraction on history.
- **UI:** Home `ProjectCard` status row (`HomeDashboard.tsx` ~298);
  workspace dock with `ContextMeter` (`App.tsx` ~1811); Project Overview
  "Agent time (observed)" (`ProjectOverview.tsx` ~487).
- **DB:** latest migration is version 12 (`lib.rs`).

## Build

### Checkpoint 1 — v1: active-subagent badge (Claude + Codex)

1. **Hooks + upgrade path.** Add `SubagentStart`/`SubagentStop` to both
   event lists (7 → 9). Add `codex_hooks_outdated` (any required event
   missing) wired as Codex's `outdated` action, so existing installs show
   "update" like Claude. Update is a new add-missing path, not today's
   strip-and-append setup (`codex.rs` ~65/77), which can move our entries
   relative to foreign hooks. It adds only the missing entries: existing
   entries keep their text, event group and position (Codex trust keys
   include source/event/index — reordering re-triggers review). Fresh Codex
   sessions then show "Hooks need review" for the new entries; declining
   leaves them inactive. Never edit trust state. Flag in the phase report.
2. **Routing.** Subagent* hooks persist via `repo.addHookEvent` with their
   own event names (existing dedupe). A narrow branch in the hook handler
   returns **before** the parent mutations it would otherwise hit — session
   cwd/context overwrite, landing-note activity refresh, tab cwd/adapter
   change (`App.tsx` ~1009/1036/1122, `ingest.ts` ~323). It validates a
   non-empty `agent_id`;
   never changes the parent's cwd/context/identity, epoch, clock or
   landing-note activity; never starts the transcript tailer, feeds
   extraction, or creates result/notification/attention evidence. They
   only trigger badge refresh and (from Checkpoint 2) usage discovery.
3. **View.** `activeSubagents()` in `repo.ts`: per bound session, agent IDs
   whose latest Subagent* event (ordered by `ts, id`) is a Start. Pure
   `subagentState()` in new `src/lib/spend.ts` returns `{ active, unknown }`.
   Unknown, not zero: tab dead or session ended with Starts open; hooks not
   installed/trusted for that adapter. Track an ID set — Start re-fires on
   child resume.
4. **Scope label.** Codex lifecycle hooks cover spawned workers only
   (guardian/internal children fire none), so the badge reads "N
   subagents" as *observed workers*, not every spending thread — spend
   coverage (Checkpoint 2) catches the rest.
5. **UI.** Home card status row gains "N subagents" ("?" when unknown);
   dock chip beside the context meter.
6. **Check.** `scripts/spend-check.ts`: Start/Stop pairing; repeated Start
   for one ID; missing Stop + dead tab → unknown; two sessions in one
   project. `codex-check`-style test: update adds missing entries without
   moving existing ones, foreign entries before and after ours preserved.
   Ingest test: a Subagent event leaves parent cwd/epoch/state untouched.

### Checkpoint 2 — v2: Codex TSPM + odometer

1. **Migration 13: `usage_records`** (append-only snapshots): `agent`,
   `root_session_id`, `thread_id`, `response_id`, `source_ts`, `source_path`,
   `source_offset` (integer; path + offset is the snapshot identity), `input` (total incl.
   caches), `cache_read`, `cache_write`, `output`. UNIQUE on `(source_path,
   source_offset)`, `INSERT OR IGNORE`, so replay/backfill is idempotent. A
   view picks the latest snapshot per `(agent, thread_id, response_id)` by
   `source_ts`, then numeric `source_offset` (= last-seen, the Checkpoint 0
   method) — arrival order never matters. Rows validated (required IDs,
   non-negative finite integers). Rust emits bounded usage batches; writes
   go through `repo.ts`. Attribution: join `root_session_id` to its existing
   binding; children never get their own tab binding and their project is never
   inferred from cwd; missing binding → unknown.
2. **Usage-only reader (Rust).** Separate `UsageRegistry` keyed by
   `(adapter, canonical path)` with per-file offset. Backfill then follow
   with no gap; handle partial lines, file replacement, retry. Never emits
   on `ingest://transcript`, never writes events, never reaches detectors
   or the extractor. Off the UI and ingest-HTTP threads.
3. **Codex discovery.** Cached index of rollout `session_meta` across
   **all** date dirs (a resumed session continues its older file; children
   can land in other dates). Match `session_meta.payload.session_id` to a
   bound root; keep each record's own thread/response ids. Hook `agent_id`
   is the child's thread id (verified upstream: `hook_runtime.rs` 1054 →
   `session_meta.id`), used as a lookup hint; attach only after the
   metadata matches the root. Periodic rescan is required
   (guardian children have no hooks); read metadata only for new/changed
   files.
4. **Coverage + drift.** Inventory threads independently of usage rows:
   `pending` (no completed response yet), `recorded`, `unsupported`
   (responses but no `token_usage_record` — older CLI or format change),
   `unreadable`. Any non-recorded thread makes session coverage incomplete.
   Usage health is keyed per thread and shown on the Agent spend coverage
   line, never on `ingest://tailer-failed` / the side-panel strip (that
   strip means extraction is blind, and parent transcript traffic clears
   it).
5. **Rate (TS, pure, `spend.ts`).** Normalize first: Codex `input` =
   `usage.input_tokens` (already includes caches); Claude `input` =
   `input_tokens + cache_read + cache_creation`. Then fresh = input − cache
   read − cache write (floor 0); units = fresh × 1 + cache read × 0.1 +
   cache write × 1.25 + output × 5 (reasoning is inside output). Rate uses
   `source_ts`, never ingest time, so backfill can't fake current spend:
   units in the trailing 5 whole minutes ÷ 5; per-minute sparkline for the
   last 15 minutes; cumulative total; source sample age; coverage.
6. **UI.** Home card: `▂▃▅█ 41k u/min · 1.2M total`; dock chip adds the
   rate; Overview **Agent spend** section under "Agent time (observed)" —
   one row per thread (rate, total, subagent status), coverage line,
   "last sample Ns ago". Units only; no dollars.
7. **Check.** `spend-check.ts`: normalization per agent; weights and floor;
   5-min boundaries; snapshot selection independent of arrival order;
   replay idempotence; parent + child aggregation; coverage states; backfill
   produces no current rate. Rust tests: parent and child readers at once;
   cross-date discovery; guardian found without hooks; partial last line.
   Live: one known parent + child session matches the Checkpoint 0 sampler.

### Checkpoint 3 — v3: Claude TSPM

1. **Claude reader.** Same usage-only reader. Main transcript plus
   `<main transcript stem>/subagents/agent-<id>.jsonl`. On bind, enumerate
   existing child files (completed children, missed hooks); Subagent hooks
   only speed up discovery. Hook-provided/derived paths must resolve under
   the session's own directory; retry children whose file doesn't exist
   yet. Root = parent `sessionId`; thread ids namespaced (`main`,
   `agent-<id>`); `message.id` as response id; each line is a snapshot, so
   growing output resolves via the view.
2. **UI.** None new — Claude sessions fill the Checkpoint 2 surfaces.
3. **Check.** Fixture: 16 rows / 7 message IDs → 7 responses, latest
   snapshot wins; completed-child backfill with no hooks; path outside the
   session dir rejected.

**Escape hatch:** if Checkpoint 3 fails live, accept v1 + v2 and move v3 to
its own plan.

## Decisions (defaults marked; confirm or change at approval)

1. **Weights.** **1 / 0.1 / 1.25 / 5** (fresh / cache read / cache write /
   output) (default), model-independent.
2. **Placement.** **Home card + dock chip in v1; Overview section from v2**
   (default). No tab strip.
3. **Unknown subagents.** **Tab dead / session ended / hooks missing →
   unknown** (default). Alternative: also after N minutes of child silence.
4. **Backfill.** **Whole session on bind** (default).
5. **Redline.** **None this phase** (default).

## Out of scope

- Dollar estimates ("Cost by project" stays a separate later plan).
- Alerts, notifications, redlines; any action on a session (invariant #4).
- OpenCode, Antigravity, Pi, DeepSeek adapters; account meters unchanged.
- OpenTelemetry; statusLine `cost`.

## Invariants

Structured-source files are read-only. Usage parsers select envelope
types, ids, timestamps and numeric usage only; content may pass through the
JSON decoder but is never interpreted, retained, logged or forwarded (#1,
#5). Usage failures stay isolated from terminals and from extraction (#2).
DB access through `repo.ts`; records append-only; panels query views (#3).
New listeners use the StrictMode cancelled-flag pattern. No terminal input,
no automatic config or trust changes (#4).

## Verify

- `npm run spend:check` (new, added to `npm run check`), `npm run check`,
  `npm run opencode:check`, `npx tsc --noEmit`, `npm run build`,
  `cd src-tauri && cargo test --lib`, `cargo clippy --all-targets -- -D
  warnings`, `git diff --check`. No golden (no prompt change).

## Manual checks (docs/TESTING.md Phase 59)

Run in the built app, one block per checkpoint.

- [x] 87. Existing Claude and Codex installs show "update"; updating keeps
      other tools' hooks and order; Codex shows "Hooks need review" for
      the two new hooks only.
- [x] 88. Claude tab: spawn 2 subagents → Home card and dock show
      "2 subagents", back to none when they finish; parent tab state and
      Since You Left counts unaffected.
- [ ] 89. Same in a Codex tab.
- [ ] 90. Kill a tab mid-subagent → badge shows "?", not a stuck count.
- [ ] 91. Codex session with a child: Overview Agent spend lists parent and
      child; total matches the sampler for that session.
- [ ] 92. Restart the app mid-session → totals unchanged, no old decisions
      re-extracted, rate resumes from live samples only.
- [ ] 93. Codex tab idle 5+ min → rate decays to 0, "last sample" grows.
- [ ] 94. In a fresh, unbound Logic Loop shell tab, run the Checkpoint 0
      one-subagent `claude -p --output-format json` probe; once the session
      binds, Overview totals match its `modelUsage`.
