# Plan 001: Cross-project attention inbox

Status: TODO — design ready for review, not assigned a phase number.
Planned at commit `c0c0cdd`, 2026-09-07. Priority P1; effort L; risk medium.
Combines `docs/IDEAS.md` concept #4 and Astra refinement A. This is a
self-contained implementation handoff, not authorization to start a phase.

## Outcome and recommendation

Give the human one cross-project place to choose what needs attention:
open decisions, waiting sessions, possibly stalled sessions, unclaimed
results, and unresolved blockers. Keep tabs as the place work runs. Start
with an Attention button and Cmd-K palette, sharing one read model. Add a
persistent rail view only after dogfooding demonstrates the need.

Rank by human override and actionability, then age. Support preview, pin,
snooze, and explicit navigation without sending input to an agent. New
providers contribute structured observations through the existing ingest
boundary; they do not need their own inbox UI or obligation tables.

The original 1.5-day estimate fits a disposable UI spike over current data.
A durable implementation needs identity, lifecycle, claim-race, query, and
restart work first. Budget roughly 6–10 engineering days plus live dogfood
and review; provider capability expansion is separate. These are planning
estimates, not measured delivery times.

### Scope decision required before scheduling

Recommendation for a solo founder working 20 hours/week: validate the UI
with the bounded spike first. Treat an engineering day as eight hours:
the spike is about 12 hours; the durable build is about 48–80 hours, or
2.4–4 weeks at that capacity before additional dogfood/review time.
The maintainer must explicitly choose spike, durable build, or defer before
assigning a phase number. This document does not approve either spend.

The spike uses existing repo data and live tab state for a ranked palette,
plain-text preview, and navigation to verified existing destinations.
Keep pin/snooze session-local and visibly temporary if included within the
12-hour cap. No migrations, new dependencies, adapter changes, claim
refactor, or dock-badge replacement. Preserve existing navigation/claim
semantics and expose missing identity as unavailable routing. Stop at the
time cap rather than absorbing durable-build work into the experiment.

Dogfood over three normal work sessions with six or more tabs. Record
whether the palette is used to choose work, whether it reduces tab scanning,
and which rows are misleading or missing. Then explicitly choose whether
to fund the durable build. Spike completion does not authorize slices 1–5;
those slices below describe the durable option only.

## Current build: verified facts and corrections

| Area | Evidence in this checkout | Consequence |
|---|---|---|
| Stack | `package.json`, `src-tauri/src/lib.rs` | React 19/strict TS, Tauri 2/Rust, SQLite through typed repo; reuse them. |
| State | `src/lib/ingest.ts:250` `stateForHook`; `src/App.tsx:638` | Shared state mapping and stopped-epoch guard already exist. Subagent `agent_id` does not drive parent state. |
| Clock | `src/lib/ingest.ts:215`, `src/types.ts:20`, `src/App.tsx:784` | Working becomes possibly stalled after >180 seconds; 15-second shared tick. `lastEventTs` is an ephemeral cache, not a persisted column. |
| Re-entry | `src/lib/repo.ts:544`, migration 7/10 | Session binding persists tether/project/cwd/adapter, but depends on SessionStart and is not complete for every provider. |
| Results | `src/lib/repo.ts:172`, `src/App.tsx:357,674` | Land/claim events persist. Land payload currently has cwd only; claim payload is `{}`. Current queries compare timestamps strictly. |
| Decisions | `src/lib/repo.ts:239`, `src/lib/decisions.ts:73` | Have session/cwd/time; no tether column. Claude and Codex transcript shapes are parsed now. |
| Blockers | migration 3; `src/lib/repo.ts:215` | Have cwd/time, **no session_id**. Current dedupe is project-wide by detector label or manual text. |
| Append-only | `src/lib/repo.ts:229,234,271` | Events are append-only; blocker/decision statuses already mutate and blockers can be deleted. Do not claim the whole existing schema is append-only. |
| Departure | `src/App.tsx:373` | `tab_left` contains cwd/tab_id and marks departure, not proof that a particular obligation was read. |
| Badge | `src/App.tsx:774` | Counts live tabs waiting OR with unseen results, not all obligations. |
| Provider identity | `src-tauri/src/ingest.rs:303` | Header allowlist currently recognizes only Codex; unmarked data cannot reliably identify Claude versus OpenCode/Antigravity. |
| OpenCode | `src-tauri/src/opencode.rs:78` | Permission events map to generic Notification; request identity/detail is discarded. No transcript extraction path yet. |
| Antigravity | `src-tauri/src/antigravity.rs:240,313` | Normalized turn/tool observations exist; forwarded through unmarked hook command. Waiting and resume follow-ups remain unscheduled. |

Phase 14 is recorded accepted. Phase 21 Codex extraction is accepted; HEAD
contains the Phase 22 Codex Sidebar LM implementation while `PLAN.md` still
holds its plan. Roadmap prose and older provider plans lag some code. Use
live code and recorded acceptance separately; do not invent acceptance or
overwrite `PLAN.md` to schedule this feature.

Small drift anchors:

```ts
// src/lib/repo.ts:88 — all event writes go through this function
export async function addEvent(sessionId: string, type: string, payloadJson: string): Promise<void>

// src/lib/ingest.ts:220 — shared stall rule
return { quietMs, stalled: tab.agentState === "working" && quietMs > STALL_MS };

// src/App.tsx:675 — current result shape, to enrich
.addEvent(p.session_id, "result_landed", JSON.stringify({ cwd }))
```

## Constraints and scope

Preserve structured-only semantics, fail-open terminals, centralized
`bindSession`, existing project-key derivation, extractor self-ingestion
exclusion, and StrictMode listener cleanup. All SQL remains in the repo
layer (a repo-owned SQL constants module is acceptable for test reuse).
Do not run extractors to rank, summarize previews, or infer urgency.

In scope: `src/types.ts`; `src/lib/repo.ts`, `ingest.ts`, `decisions.ts`;
new `src/lib/attention.ts`, `attentionSql.ts`, `attentionRefresh.ts`;
`src/App.tsx`; new `src/components/AttentionInbox.tsx`;
`src/components/Terminal.tsx`, `SidePanel.tsx`; necessary styles in
`src/index.css`; migration additions in `src-tauri/src/lib.rs`;
identity-only changes in `src-tauri/src/ingest.rs`, `opencode.rs`,
`antigravity.rs`; new check scripts, `package.json`, relevant existing
check scripts; `docs/TESTING.md`, `README.md`, and this plan/index.

Out of scope: provider transcript expansion, hook approval semantics,
automatic answers/retries/resume, PTY semantic parsing, model routing,
cloud synchronization, cross-device inbox, board-task ingestion, general
command palette, worktree regrouping, historical event rewriting, and
wholesale conversion of existing domain tables to event sourcing.
“Global” means all projects recorded in this app's local database, not all
agents running anywhere on the machine. Missing observations stay missing.

## Data contract and identity

Define a common read shape in `src/types.ts`, with concrete discriminated
unions rather than optional fields whose combinations are unclear:

```ts
type AttentionKind = "decision" | "waiting" | "stalled" | "result" | "blocker";
interface AttentionItem {
  id: string;                    // stable obligation occurrence identity
  kind: AttentionKind;
  projectKey: string;            // existing canonical project key
  sessionId: string | null;      // null only for project-level/legacy rows
  tabId: string | null;
  adapterId: string | null;      // unknown is not silently Claude
  actorId: string | null;        // native subagent id, never adapter id
  createdAt: number;
  lastActivityAt: number | null;
  text: string;
  evidenceId: number | null;
  actionability: "act" | "review" | "investigate" | "unknown";
  confidence: "explicit" | "inferred" | "unknown";
  route: "exact" | "session" | "project" | "unavailable";
}
```

Keep source IDs globally stable inside this database: `decision:<pk>` and
`blocker:<pk>`; result `result:<land-event-id>`; waiting
`waiting:<episode-start-event-id>`; stalled
`stalled:<last-accepted-working-observation-id>`. Recurrence gets a new ID,
so an old snooze/pin never hides or promotes a different occurrence.

Existing session maps and tables key on raw session IDs. Do not casually
rewrite those keys in this feature. Preserve provider identity separately
and detect contradictory providers for a session when preparing evidence;
mark affected routing ambiguous. A demonstrated ID collision requiring a
composite-key migration is a separate identity prerequisite, not license to
join unrelated sessions. Expose adapter, session, and actor separately so
future composite identity remains possible.

Add a new numbered migration (11 if still next at execution time): nullable
`session_id`, `tab_id`, `agent`, `actor_id` columns to blockers, and nullable
`tab_id`, `agent`, `actor_id` columns to decisions. New detector writes get
session/tether context at ingestion; capture decision context before async
extraction so a tab switch cannot retarget the result. Manual blockers may
remain project-level; never manufacture a session for historical rows.
Scope detector dedupe to project + session + detector for new session-owned
rows; preserve project-level manual dedupe. Update every caller and test
two agents with the same detector in the same project.

New result/claim/lifecycle payloads carry project_key, compatible cwd,
tab_id when known, adapter_id, actor_id when meaningful, and a schema
version. Reuse existing canonical keys; no third filesystem derivation.
Legacy routing may consult bindings, but new tethers must be persisted at
the source. Do not backfill guesses into old event payloads.

## Durable lifecycle without changing state semantics

An unfiltered `MAX(events.ts)` is wrong for the stall clock: snoozing,
claiming, departure, transcript delivery, and ignored subagent hooks must
not reset agent activity. Separate obligation age, accepted agent activity,
and human interaction time.

Introduce additive `attention_state_observed` events at ingestion, only
when the existing `stateForHook` accepts a state-bearing hook. Include
accepted state, observation/occurrence ID, run ID for this app launch,
source hook type, project/session/tether/adapter, and observation time.
Record every accepted activity, including working→working, because those
reset the quiet clock. Duplicate delivery must not create a new observation
or episode: persist hook acceptance and its derivative in an ordered
repo-owned per-session operation through `addEvent`, extending its result
to report insertion/ID when needed. Never add a separate raw events writer.
Keep mutation of the stopped-epoch guard outside React state updaters.

Within each session/run, SQL derives latest accepted state/activity and
the start of the current contiguous waiting episode. Repeated waiting
reminders do not reset its age or ID. Stop/Interrupt/SessionEnd close the
episode according to existing state semantics. Preserve `agent_id` parent
filtering. A subagent Stop must not create a parent-level result simply
because its tether is the parent's; audit the App result branch as part of
this integration and add a regression fixture.

Waiting/stalled candidates require a matching currently observed live tab
and current app run. On restart, do not revive historical working state as
a currently stalled process. Durable decisions/blockers/results survive;
historical state is preview context only until fresh activity arrives.
Tab close/process death removes live-state candidates; an unbound outside
session can still contribute durable decisions but no invented live tab.
The stall label is “No observed activity for 3m,” never “Agent failed.”

Retain the existing 15-second timer and ephemeral tab cache. Persisted
observations make the query reproducible; the cache is not a second
authority. Persistence failure shows stale/unavailable attention data and
leaves terminal state functioning. Do not replay raw history through the
module-global epoch guard to query the inbox.

## Query, ranking, and duplicate policy

`repo.inbox()` produces a single cross-project UNION ALL over open
decisions, unresolved blockers, latest outstanding result per session, and
state-observation-derived waiting/stalled candidates. Use CTEs for source
selection, occurrence identity, and latest interactions. There is no new
obligation table per kind. Live presence validation and sorting are pure
reducers over this query plus the current tab snapshot.

Never call existing project lists in a loop: their LIMIT 100 would silently
drop work, and querying each project makes global refresh N+1. Parameterize
queries; guard JSON extraction on malformed historical payloads. Introduce
indexes for filtered source status and observation/action lookups only
after checking EXPLAIN QUERY PLAN on representative fixtures.

Use a lexicographic comparator, not a growing age product:

1. Eligible unsnoozed pinned rows first.
2. Explicit user priority: high, normal (default), low.
3. Actionability: act → review → investigate → unknown.
4. Kind base within that tier: waiting 50, decision 40, result 30,
   blocker 20, stalled 10 (constants with named tests).
5. Oldest occurrence first; stable ID final tie-breaker.

Initially expose pin as the manual priority control; reserve the ordinary
priority field/action for a later UI without changing the comparator.
Defaults: decisions and observed waiting = act, unclaimed results = review,
blockers and stalls = investigate. A generic Notification yields a generic
waiting message and inferred confidence, never a fabricated permission
question. Route-unavailable rows default to unknown actionability.
Do not infer deadlines or priority from model prose. A two-month-old
blocker cannot outrank a fresh answerable decision unless the user pins it.

Visible explanation: “Pinned first, then priority and what you can act on;
oldest first within each group.” Show a reason chip on each row. Display
the actual comparator's tier names, not a misleading numerical score.

Keep distinct obligations distinct: two open decisions are two rows even
in one session. Group by session optionally for scanning but count leaf
rows. A waiting state and a decision remain separate unless both carry the
same explicit source request ID; do not fuzzy-match text or suppress all
waiting rows just because the session has a decision. Results coalesce to
the latest outstanding land per session, matching the existing UX. Fan-out
groups are context labels/filter options, not additional obligations that
double-count their children.

## Interaction events and claims

Append `attention_pinned`, `attention_unpinned`, `attention_snoozed`,
`attention_unsnoozed` events with target occurrence ID and complete routing
context; future `attention_priority_set` can use the same envelope.
Each human operation has a UUID so quick pin/unpin/pin operations survive
the existing 500ms dedupe bucket. Retry the same operation with the same
UUID. Latest event **per property**, ordered by persisted event ID, wins;
a snooze event must not erase a pin setting.

Snooze presets: 1 hour, 4 hours, tomorrow at 09:00 local time. Persist the
chosen absolute UTC millisecond deadline, computed at click time; derive
eligibility as now >= deadline. Test daylight-saving boundaries if the
tomorrow preset ships. Start with 1h/4h if date handling is not ready.
Snooze hides from Active and badge, but stays in a Snoozed view. Pin does
not cancel snooze. Resolve while snoozed means it never resurfaces; a new
occurrence is eligible regardless of its predecessor's snooze. Expiry
needs no database write or background daemon. Refresh immediately on
window focus/wake and at the next shared tick.

Preview is bounded plain text loaded lazily by exact source identity;
include project/session/provider, timestamps, evidence, and destination.
Do not inject HTML, execute links/commands, or send preview to an LLM.
Opening, expanding, pinning, and snoozing do not call `claimTab`, answer a
decision, or resolve a blocker. No preview-read event is necessary in v1.

Enter/“Go to tab” selects an existing matching live tab through App's
normal navigation and claim path. Validate tether **and session** at click
time: a tab can now host a different session. Fall back to an exact session
match; project-only rows present a project-tab chooser. If a tab is gone,
keep the row previewable and say why navigation is unavailable. Never jump
to an arbitrary same-project sibling or resume an unknown provider.
Existing human-triggered re-entry may be offered as a separate explicit
action only where it is already supported; not required for inbox v1.

Harden result claims before sharing the count: capture the latest visible
land-event ID as a claim watermark and persist it in `result_claimed`.
New queries match claims to that session and covered land IDs; a newer
result arriving during claim remains unclaimed. Adapt legacy `{}` claims
using timestamp order with ID as a same-millisecond tie-breaker. Order
land/claim writes per session, refresh after commit, and keep failed claims
retryable instead of clearing the only in-memory flag permanently. Keep
`unclaimedResults`, `unclaimedSessions`, startup seeding, and `claimTab`
consistent with the inbox. Existing tab-close-as-claim behavior remains;
document it in tests rather than silently changing it here.

## UI and refresh integration

Add an Attention button with count near the tab navigation and Cmd-K on
macOS; use Ctrl-Shift-K on Windows/Linux to preserve terminal Ctrl-K.
Update xterm's custom key handler so the app shortcut cannot also send
terminal input. Reuse the app's dark zinc/Tailwind styling and modal
patterns; don't introduce a component framework.

Palette supports search by text/project/provider, Active/Snoozed tabs,
arrow selection, Enter navigation, Escape close, in-place preview, and
labeled pin/snooze controls. Trap focus and restore the previous focus
target on dismissal; keep selection keyed by row ID during live refresh.
If the selected row disappears, move predictably to its nearest neighbor.
Controls are keyboard accessible with visible focus and screen-reader
labels. No dynamic rank change may activate a different row accidentally.

One App-owned snapshot feeds palette and dock badge. Invalidate after
successful domain/event writes, extraction completion, claims, tab
lifecycle, and interactions. Use a coalescing refresh controller with a
generation token and dirty-during-flight rerun; older responses cannot
overwrite newer data. No per-row intervals/listeners or full history scan
every render. Time-only eligibility updates reuse the snapshot unless new
data is dirty. On DB error retain last good data with a stale indicator;
unknown is not an empty inbox.

After dogfood, dock badge = unsnoozed eligible leaf rows in Active across
all projects, independent of the palette's search/filter. No parent-group
double counting. Project mute continues controlling OS notifications,
not visibility/count; snooze controls this inbox's eligibility. Do not add
new notification types in this phase. Existing tab badges may remain;
label the Attention count as items rather than tabs.

## Ordered implementation slices and verification

At execution, run `git status --short` and
`git diff --stat c0c0cdd..HEAD -- src src-tauri scripts package.json`.
Reconcile changed anchors before writing code. Existing user edits were
present in `.logic-loop/board.md` and `docs/IDEAS.md`; preserve them.
Choose the next phase number with the maintainer; promote only that slice
into `PLAN.md` using the repository's phase process.

| Slice | Work | Gate / expected result |
|---|---|---|
| 1: contract + evidence (1–2d) | Types, migration, source context, observation insertion, identity markers, pure state parity fixtures. | `npx tsc --noEmit`, `npm run epoch:check`, `npm run bind:check`, `npm run dedupe:check`, new `npm run attention-state:check`: exit 0. Rust gates below pass for migration/adapter edits. |
| 2: query + claim integrity (1.5–2.5d) | Repo UNION, legacy compatibility, watermark claims, query indexes and DB fixtures. | New `npm run inbox-sql:check` plus `npm run unclaimed:check`, `npm run scope:check`: exit 0 on fresh and migration-10 databases. |
| 3: ranking + interactions (1d) | Pure reducer, per-property event projection, snooze/pin APIs, route resolver. | New `npm run inbox:check`: all named ranking, recurrence, route, and deadline cases pass; TS clean. |
| 4: palette + refresh (1.5–2.5d) | Component, App controller, terminal shortcut guard, preview and action integration. | New `npm run attention-refresh:check`, `npm run check`, `npx tsc --noEmit`, `npm run build`: exit 0; manual keyboard/claim checks below. |
| 5: dogfood + badge (1–2d) | Mixed-provider scenarios, data-volume measurement, docs, enable unified badge after validation. | Full merge gates and recorded manual evidence; no stale routing or duplicate counts. |

Add every new script to `package.json`'s `check` chain when introduced.
Use `node:assert/strict`/tsx fixtures as in `scripts/clock-check.ts` and
`scripts/unclaimed-check.ts`; inject clocks instead of sleeping. For the
SQL check, execute the **actual shared query strings** against isolated
SQLite fixtures, not a TS reimplementation. A new dev-only SQLite driver
is a proposal, not an approved dependency. First inspect existing tooling;
if a package is needed, present the exact package/version, purpose,
alternatives, and lockfile impact for explicit maintainer approval before
adding or installing it. This approval requirement is explicit review
feedback for this plan. Confirm support for Node 20 CI and macOS/Windows.
Do not rely on Node
26-only built-in SQLite. SQL fixture setup must apply the real numbered
migrations (factor their SQL into reusable resources if necessary, then
explicitly expand scope for those resources before coding).

Full merge gates from CONTRIBUTING/CI:

```sh
npx tsc --noEmit
npm run check
npm run build
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
```

All must exit 0. No separate lint command is configured. `npm run golden`
is needed only if extraction prompts change; none are planned here.
This planning review ran TypeScript and all 17 existing check scripts
successfully. The initial tsx sandbox IPC restriction was resolved by an
approved rerun. Rust gates, GUI behavior, and live provider contracts were
not revalidated during planning.

## Required regression cases

Automated coverage must include:

- Every kind across two projects; three sessions sharing one cwd; no
  project LIMIT 100 truncation; legacy null session/tether and malformed JSON.
- Two independent questions remain distinct; parent/child rollup adds no
  duplicate; contradictory provider/session association cannot misroute.
- Fresh answerable question above ancient blocker; pin override; equal
  timestamps stable; priority independent of age; unknown route demotion.
- Repeated waiting observation keeps episode ID; Stop closes it; next turn
  gets a new ID; late/subagent hook doesn't reopen stopped parent state.
- Exactly STALL_MS is not stalled; STALL_MS+1 is; new accepted activity
  resets it; snooze/tab_left/transcript never reset it; dead and previous-run
  observations never count as current stalls.
- Pin/unpin/pin inside 500ms; replayed operation; independent pin/snooze
  properties; expiry boundary; expiry during app suspension; resolved and
  replaced occurrences don't inherit stale interaction state.
- Land/claim same millisecond, claim racing newer land, rejected DB write,
  restart seed before activation, close-as-claim, and claims of one session
  leaving siblings untouched.
- Slow refresh followed by new write; query failure then recovery; listener
  double-mount; no per-row polling; selected row removed during interaction.
- Bound, closed, retargeted, multiple-project-tab, and untethered routing;
  unknown adapters never silently receive Claude resume commands.

Manual checklist to add to the next `docs/TESTING.md` section:

1. Run at least two projects and six tabs, including same-project fan-out.
   Use installed Claude, Codex, OpenCode and Antigravity where available;
   record exact CLI versions and explicitly mark unsupported cases.
2. Produce a decision, permission/wait, background completion, quiet working
   session and real/manual blocker. Confirm text and confidence match the
   available evidence, not an assumed capability.
3. Open from terminal focus, search, expand preview, pin and snooze. Confirm
   no PTY input and no claim until actual tab navigation. Check Escape/focus
   restoration and keyboard actions on macOS and Windows when available.
4. Close/retarget a destination while its preview is open. Confirm safe
   unavailable/chooser behavior. Restart with unclaimed and snoozed rows;
   confirm restored claims work and prior-run stalls don't appear.
5. Advance an injected test clock through expiry, then check real sleep/wake.
   Confirm badge/list equality independent of search and no extra nudge.
6. Simulate query/write failures; terminals remain usable and attention
   explicitly stale. Capture a sanitized before/after count and route log.

Query performance target: on a documented local machine with 100k events
and 1k active obligations, warm-query p95 <=100ms over 30 runs, opening the
palette <=200ms with a cached snapshot. Record measured values, hardware,
and query plan; investigate rather than hiding rows with a pre-ranking
LIMIT. Render at most 100 rows initially with “load more”; count/rank all
eligible rows first. Index tuning is preferred before a materialized cache.

## Provider extensibility

The inbox consumes capabilities, not model brands. GPT via Codex uses the
Codex adapter; a Google model via another harness uses that harness's
adapter. No inference from model names, executable strings, or transcript
prose. Record trusted adapter markers at the existing server boundary,
keeping header identity independent from transcript-tail eligibility.
Allowlisting OpenCode/Antigravity must not suddenly permit their arbitrary
transcript paths to be tailed.

Define an additive capability descriptor beside ingestion: lifecycle,
waiting evidence, decision extraction, result observation, resume. Values
should distinguish supported, partial, unavailable, unknown; identity
alone is not evidence of a working installed hook. Observed evidence and
adapter warning/tailer failure state qualify the UI. Core inbox logic
must work with partial capabilities and unknown adapters.

| Adapter in this checkout | Inbox can reuse | Separate follow-up |
|---|---|---|
| Claude Code | Normalized state, transcript decisions, results, existing resume | Explicit identity for new traffic can be staged; old unmarked rows stay unknown in inbox. |
| Codex | Marked state, transcript decisions, results including Interrupt, resume | Preserve hook command trust; no hook-command rewrite needed here. |
| OpenCode | Normalized lifecycle and permission-as-Notification, results | Reuse existing OpenCode Plan 002 identity work; richer requests/transcripts remain separate. |
| Antigravity | Normalized turn/tool activity and results | Mark forwarding identity; waiting/SessionStart/resume depend on existing Agy 003/004 plans and live contract verification. |
| Future harness/ACP | Same normalized observations when available | Prove structured contract with sanitized fixtures before enabling a capability. |

Do not make all pending adapter plans a prerequisite for a usable inbox.
Do not register Antigravity PreToolUse as part of identity work or change
its verified `invocationNum == 0` turn rule. Preserve known upstream error
visibility limits. Provider behavior here describes repository code, not
claims about current upstream releases; implementation spikes must verify
installed versions before widening capabilities.

One person implements slices 1→5 sequentially, verifying each slice before
starting the next under the repository's phase process. Reconcile existing
provider plans so identity work lands once. Supporting multiple observed
agents is a product requirement, not a requirement for parallel builders,
separate worktrees, or coordination documents.

## Completion, stop conditions, and maintenance

Done when all named automated gates pass, the manual matrix is recorded,
the five sources are represented without guessed identity, all interaction
state survives restart, badge equals eligible leaf count, and no preview
or shortcut sends terminal input. Review `git diff --name-only` for scope;
update this index status only after the corresponding slice's evidence is
attached. Use normal small commits, e.g. `feat(attention): add ranked inbox
query`; do not push/merge as an implied part of this plan.

Stop the affected slice and report a concrete revised design if live
code contradicts the contract, provider identity would require a broad
session-key migration, a needed signal requires PTY parsing or unsafe hook
registration, SQL fixtures cannot exercise real migrations/queries, or
verification repeatedly fails after a reasonable fix. Do not treat missing provider capability as a reason
to fabricate data or halt the entire inbox.

Keep comparator constants and explanation synchronized. New source kinds
need occurrence identity, resolution, routing, and tests before joining the
UNION. Event retention must preserve the latest action per live occurrence
and claim watermarks; pruning that evidence changes user-visible state.
Revisit rail layout, priority controls, explicit result acknowledgement and
cross-session dependency ranking only after dogfood. Measure whether users
choose work from Attention more often than scanning six-plus tabs, and
record misleading/duplicate items before expanding feature scope.

Considered and rejected: age multiplication (stale work dominates), generic
mutable seen flags (lose interaction history), new table per kind (needless
schema sprawl), automatic claim on preview (hides unread results), generic
Notification labeled permission (unsupported certainty), arbitrary cwd
navigation (wrong sibling), and a complete provider rewrite as a launch
prerequisite (unnecessary coupling).
