# Plan 046: Codex cleanup investigation

> **Phase gate:** `PHASE 46 ACCEPTED` received 2026-09-27. This is a short
> correctness pass, not a new Codex feature sprint. Revise this plan openly
> if the live evidence calls for a broader change.

## Status and scope

- **Status:** APPROVED 2026-09-27. Automated checks and installed-app matrix
  passed; see `docs/TESTING.md` §68. Implementation was authorized by the
  earlier literal `PHASE 46 ACCEPTED`.
- **Priority:** P1 for decision-card scope; P2 for the three lifecycle reports.
- **Budget:** one focused investigation and, only where the cause and contract
  are clear, a small fix. Defer bash/fish tether support.
- **Starting point:** Phase 45 accepted 2026-09-27; `docs/TESTING.md` §67.
  Work is on `phase-46-codex-cleanup`, stacked on the accepted Phase 45
  branch. The in-scope diff from `main` was reviewed before editing: it
  consists of Phase 45's launch registry/binding changes. Reconcile with
  accepted `main` before merging if Phase 45 lands separately.

## Current evidence

1. **Cards in two tabs, one folder.** `repo.listDecisions(cwd)` selects every
   decision in the project. `SidePanel.reload()` deliberately assigns that
   entire result to `decisions`, citing Phase 17's cross-session clusters;
   `scopeBySession` is applied to tool events and the since-left digest, but
   not the main Decisions section. `docs/TESTING.md` §66 called the shared
   panel intended; §67 raised it again as a possible correctness issue.
   Decision rows carry `session_id` and `tab_id`, and Answer Now resolves
   the row's session to a live tab. Shared display is therefore reproducible
   from the read path without assuming that extraction or binding leaked.
   The product contract needs to be settled explicitly: which cards should
   an active tab show, and where should project-wide obligations appear?
2. **Green dot after `/quit`.** `stateForHook(SessionEnd)` returns `idle`,
   and `TabBar` renders `idle` as green. The report could be the intended
   rendering of a finished Codex session, or a missing session-end update.
   Capture the actual hook, bound session, and displayed state before
   deciding whether to clear the indicator when the CLI exits.
3. **Tab ID on re-entry.** `restartTab` passes the existing `tab.id` to
   `ptySpawn`, and app-relaunch ghosts use the persisted `tab_tether` as
   their ID. `openTab` creates a UUID. The §67 example says the tab was
   *closed* before Re-enter and compares two different IDs; distinguish
   same-tab process death or app relaunch from closing a tab and opening
   another one to resume the same Codex session.
4. **Cards after close + Re-enter.** Carried from §66, still unconfirmed.
   Check whether the report means an explicit tab close, a dead-tab Re-enter,
   or app quit/relaunch. Compare the resumed session, project key, decision
   rows, and panel refresh after the first new turn.

### Findings so far (2026-09-27; read-only code and SQLite inspection)

- The shared Decisions section is an explicit read-path choice, not evidence
  that stored rows lost ownership. The active profile has decision rows with
  distinct session and tab IDs. Its project has 685 historical decisions
  across 168 sessions and 65 tab IDs; 363 old rows have no tab ID, so a
  tab-only filter needs an explicit legacy policy. The current project-wide
  tab badge and the global Attention inbox also need to be considered in the
  card contract. No owner/routing failure has yet been reproduced.
- The §67 re-entry session emitted `SessionStart` under tab tethers
  `88ceb50f` then `e99c8b6b`. Its active `session_bindings` row was updated
  to the second tether and later deactivated on close. `restartTab` and
  app-relaunch ghost restoration both reuse the existing tab tether;
  `openTab` mints a UUID. The observed change is consistent with closing
  the first tab and resuming in a new one, not with same-tab Re-enter.
- For `/quit`, the active profile has a `SessionEnd` for the bound Codex
  session before the stale-daemon fakes in §67. `stateForHook` maps it to
  `idle`, and `TabBar` paints idle green. `docs/TESTING.md` §16 describes
  green as idle/done after Codex exits. This is the existing state contract;
  the desired post-exit display may still be reconsidered explicitly.
- The panel refresh path is present: `refreshDecisionCounts` increments
  `panelRefresh`, and extraction/reconciliation calls it on completion.
  Codex `SessionStart` is lazy, so an Answer Now click before the resumed
  session's first hook has no live entry in the in-memory routing cache even
  though the restored tab already has the session ID. This is a concrete
  no-op path in `App.answerNow`; the §66 report still needs a live check to
  establish whether it was the observed symptom.

### Agreed card contract and plan change (2026-09-27)

The maintainer chose **owning tab only** for the Decisions section; the
Attention inbox remains the project-wide place to see obligations. This
changes Phase 17's intentional project-wide side-panel behavior, so the
following bounded read-path change is now in scope:

- Show a decision when its `tab_id` matches the active tab, or its
  `session_id` matches the active tab's bound session. The second clause
  covers legacy rows without `tab_id` and a session resumed in a new tab.
  An unbound fresh tab shows no other tab's cards.
- Apply the same ownership rule to tab decision badges and the Decisions
  section's bulk-dismiss action. Keep session clustering within the visible
  set. The global Attention inbox keeps its project-wide read.
- Do not rewrite historical decision rows or session bindings. Verify that
  Answer Now routes to the owning live tab, including after a resumed
  session emits its first hook.
- For a restored tab before its first hook, Answer Now may fall back to the
  **active live tab only** when that tab's persisted session ID exactly
  matches the decision. A stale cache entry must never route to a tab with
  a different session. Keep dead tabs and unrelated active tabs ineligible.

## Build result (2026-09-27)

`repo.listDecisions` and bulk dismiss now use the tab/session ownership
predicate. Tab badges read minimal open-decision owner rows and apply that
same predicate. `SidePanel` tags loaded decisions with the active scope so
the previous tab's rows cannot flash after a switch. `decisionReplyTab`
routes Answer Now to the exact live owner, with the active restored tab as
the bounded pre-hook fallback. No decision data or migration changed.

Focused decision and routing checks, all 39 frontend checks, TypeScript,
production build, Rust tests (151 passed, 1 ignored), Clippy, and
`git diff --check` passed. The initial `tsx` CLI and Rust loopback tests
hit sandbox socket denials; `node --import tsx` and an approved Rust rerun
passed. No extraction prompt changed, so `golden` was not run.

## Investigation sequence

1. **Establish the card contract.** Review Phase 17's project-wide grouping,
   the current Decisions section, project badges, Attention inbox, and
   Answer Now routing. Record a proposed expected result for two bound tabs
   in one folder, an unbound tab, and a resumed tab. Do not change filtering
   merely to hide a cross-tab row: decide whether project-wide visibility is
   still desired and ensure a card's owner is understandable and actionable.
2. **Reproduce with two real Codex tabs in one scratch folder.** Make one
   distinct decision in each session. Record only IDs, timestamps, project
   keys, status, and short redacted labels from `decisions`, `events`, and
   `session_bindings`; avoid raw transcripts or prompts. Compare stored
   `session_id`/`tab_id` with each tab's bound session and what both panels
   show. Test Answer Now for each card and verify it targets the owning live
   tab. A wrong stored owner or wrong terminal target is a binding/data bug;
   correct owners shown in both panels is the current view contract.
3. **Check `/quit` lifecycle.** In one tab, observe the dot before and after
   `/quit`; verify whether `SessionEnd` arrives with the owning session and
   whether the shell remains live. Check a second launch in the same tab.
   State the desired shell-after-Codex indicator before changing the mapping.
4. **Check identity and card continuity.** Separately run (a) CLI exit and
   same-tab Re-enter, (b) app quit/relaunch and ghost-tab Re-enter, and
   (c) explicit tab close followed by a fresh tab resuming the same session.
   Record tab ID, tether, session ID, active binding, and visible cards at
   each step. Case (c) is a new tab unless a separate restore path exists.
5. **Disposition.** If the cards have correct owners but the agreed contract
   is tab-local, amend this plan with the exact panel, badge, and unbound-tab
   behavior before implementing a UI/query change. If an owner, routing, or
   resume binding is wrong, amend it with the proven failure path and a
   bounded fix. For the dot, fix only a demonstrated mismatch with the
   agreed post-exit state. Record no-bug findings with evidence.

## Verification and exit

- Run the focused checks for any changed behavior, then the applicable repo
  gates in `AGENTS.md`; do not run `npm run golden` unless extraction prompts
  change.
- Record the live matrix and observed IDs in a new `docs/TESTING.md`
  section, with sensitive content redacted. Update `docs/PROGRESS.md` and
  this plan with each finding and any plan change.
- Phase 46 closes when the two-tab card behavior has an explicit contract
  and verified disposition, and the three lifecycle reports are reproduced
  and either fixed or explained by concrete evidence. Bash/fish remains
  deferred.
