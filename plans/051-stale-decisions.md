# Stale decisions: age-out so "open" means "waiting on you"

Status: **APPROVED 2026-10-06 (`PHASE 51 APPROVED`, defaults confirmed) — built, awaiting live checks and acceptance.**

Source: docs/IDEAS.md "Stale decisions". Maintainer chose a 14-day threshold on
2026-10-06 and asked for the recommended combined rule.

## Problem

Real profile (2026-10-06): 748 open decisions; one project alone shows 201,
another 97. At that size the Home header, card counts, tab badges and Inbox stop
signalling "waiting on you". Bulk-dismiss exists (Phase 17) but is manual and
per-session; nothing ages decisions out.

Age spread of open decisions: 326 under 7 days, 161 at 7-30 days, 273 over 30.
At 14 days the rule below marks **303 stale (~40%)**, leaving ~462 open. That is
a real reduction but the counts will still be large; the 201-decision project
is mostly a volume problem this plan only partly fixes (see Out of scope).

## Definition (derived, never stored)

A decision is **stale** when all hold:
1. `status = 'open'`;
2. `ts` is older than 14 days; and
3. its session has been **dormant** for 14 days: no `events` row for that
   `session_id` newer than the cutoff (or `session_id` is NULL).

Condition 3 protects a decision from a session you are still working in. On the
real profile it changes nothing today (0 old-but-active rows); it is cheap
insurance. There is no reliable "session ended" signal for Claude Code (the
`SessionEnd` hook is only registered for Codex), so dormancy stands in for it.
`idx_events_session(session_id, ts)` already supports the lookup.

The threshold is one named constant (`STALE_DECISION_DAYS = 14`), not a setting.

## Behavior

- Stale decisions are **excluded** from: the Home header and card counts, tab
  badges (`openDecisionOwners`), the Attention Inbox, momentum, and the sidebar's
  open-decision list.
- They are **shown, not hidden**: the sidebar Decisions section gets a
  collapsed `Stale (N)` group (default collapsed, same pattern as Cleared
  Blockers) and Project Overview lists them the same way. Rows keep their
  existing Answer / Dismiss actions.
- One-click **Dismiss all stale** per project (the same `dismissed` status and
  semantics as the per-row ✕ and Phase 17 bulk-dismiss). Human-triggered; the app
  never dismisses anything on its own.
- A stale decision becomes ordinary again if its session produces a new event
  (it is derived each read; nothing to undo).

## Invariants

- #3 panels are dumb SQL views: staleness lives in one shared SQL fragment in
  `src/lib/repo.ts`; no rows are rewritten, no migration, no new column.
- #2 fail open: if the stale query errors, readers fall back to today's
  behavior (count everything open).
- #5 untouched: no extraction, prompt or transcript change.
- Rust untouched; UI + repo layer only.

## Steps (each with its check)

1. **Audit** every reader of `status = 'open'` decisions (repo.ts: Inbox union
   ~L444, `openDecisionOwners`, `listDecisions`, `decisionsBySession`,
   `decisionsOpenedSince`, `OPEN_PROJECT_DECISIONS_SQL`, `openDecisionsForSession`;
   momentum.ts; SidePanel) and decide per site: exclude stale / list separately /
   leave alone (reconciler and since-you-left stay as is). *Check: table of sites
   and decisions recorded in this plan before code.*
2. **Shared predicate** `STALE_DECISION_SQL` plus `STALE_DECISION_DAYS`. *Check:
   `stale-decisions:check` — fixtures for recent / old+active session / old+dormant /
   NULL session / non-open status / boundary at exactly 14 days.*
3. **Counts**: apply to Home counts/header, tab badges, Inbox, momentum. *Check:
   dashboard:check + attention-inbox:check extended; Home header total equals sum
   of cards.*
4. **Sidebar + Overview**: collapsed `Stale (N)` group and per-project
   **Dismiss all stale**. *Check: component-level assertions where the repo has
   precedent; live check below.*
5. **Docs**: TESTING.md section, PROGRESS entry, IDEAS.md entry marked built.

Gates: `tsc --noEmit`, `npm run check`, `vite build`; Rust untouched so `cargo
test`/clippy only if the tree changes. Golden not run (no extraction prompt).

## Live checks (maintainer, rebuilt app)

- Home header/cards drop by about the stale count on the real profile (expect
  ~303 fewer; verify against a counts-only SQL query, no content).
- A project with stale items shows `Stale (N)` collapsed in the sidebar and
  Overview; expand, answer one, dismiss one; **Dismiss all stale** clears only
  the stale group and leaves recent open decisions.
- A recent decision in an old project, and an old decision whose session just
  produced an event, both stay in the normal list.
- Lock-in and compact rail unaffected; no new colors (use existing roles).

## Decisions

Made (maintainer, 2026-10-06): 14 days; combined age + dormant-session rule;
stale items shown collapsed, not hidden.

Proposed defaults, **confirm or change at approval**:
- Stale excluded from the Inbox as well as counts (recommended: Inbox is for
  things waiting on you).
- Constant, not a user setting (add a setting only if 14 days proves wrong).
- Dismiss all stale is per project, not global.

## Out of scope

Auto-dismiss or delete; changing extraction or what counts as a decision; a
per-user threshold setting; fixing decision volume at the source (the 201-decision
project suggests extraction over-produces on long sessions; a separate
investigation, parked).

## Audit result (step 1) and plan revisions during build (2026-10-06)

Readers of open decisions, and what was done:

| Site | Decision |
|---|---|
| Inbox union (`listAttentionEvidence`) | exclude stale |
| `openDecisionOwners` (Home counts/header, tab badges) | exclude stale |
| `listDecisions` (sidebar, tab-scoped) | return all, add derived `stale` column; SidePanel splits |
| `openDecisionsForProject` (Overview, momentum, Copy update) | exclude stale |
| momentum (sidebar) | fed non-stale only |
| `dismissAllDecisions` (sidebar "dismiss all") | now excludes stale, so it cannot silently dismiss the collapsed group |
| `openDecisionsForSession` (reconciler), `decisionsOpenedSince` (since-you-left), catalog/activity timestamp reads, `decisionsBySession` (unused) | left alone |

Revisions (stated explicitly; maintainer may object):
1. **Overview** shows a count line plus "Dismiss all stale", not a row list;
   Overview has no per-decision list today, so a stale list would be new UI.
   The collapsed list with per-row actions lives in the sidebar.
2. **No fail-open fallback** in the queries. The predicate is plain SQL over
   existing columns and `idx_events_session`, covered by `stale-decisions:check`
   against a real SQLite (node:sqlite) and run read-only against the real
   profile (303 stale / 462 open non-stale, matching the estimate).
3. **"dismiss stale" in the sidebar is project-wide** (the approved default)
   while the stale list shown there is tab-scoped like the rest of the section;
   the button title says so.
