# Next fix, two-tier Blockers, working-agreement trial

Status: **ACCEPTED 2026-10-07 — maintainer wrote `PHASE 52 ACCEPTED` after live
review.** Built on `feat/phase-52-next-blockers`; automated gates pass;
TESTING.md Phase 52 items 31-40 not individually reported.

Source: 2026-10-06 product review (Claude + GPT, two rounds) of the project-
management pillar. Conclusion: the PM surfaces exist but don't carry signal.
Fix what Next shows and what Blockers counts, and trial a short agent working
agreement in this repo, before building any new PM structure.

## Problem (counts only, real profile)

Baseline, last 14 days before this plan (2026-09-22 → 2026-10-06):

| Signal | Count | Reading |
|---|---|---|
| Decisions created | 686 (~49/day): 12 answered, 137 dismissed, 537 open | Volume far above what one human acts on |
| Decisions carrying `assumption` | 284 of 686 (41%) | Assumption cards already common before any trial |
| Blockers created | 102 detected, 0 manual | Blockers = regex detectors only |
| Open blockers now | 99 detected, 7 manual | Detected rows dominate tab badges, Inbox, Next |
| Landing notes | 2 saved; mode = Manual | Auto drafter is not running |

Code facts:

1. **Next order puts machine output over human intent.** `computeMomentum`
   (`src/lib/momentum.ts:24`) picks latest open landing note → oldest open
   decision → oldest open blocker → planned card. A starred Now card only
   shows when no decision and no blocker is open, which is almost never. The
   concept doc's §3.7 order never included blockers.
2. **"✓ Done" on a planned card starts it.** `onPlannedCardDone`
   (`SidePanel.tsx:675`) writes `status: building` and clears `now`. The label
   says the opposite.
3. **Detected blockers are keyword hits.** `detectors.ts` runs 10 regexes over
   any hook tool response *or raw transcript line*. An agent discussing rate
   limits creates "Rate limited"; `ls` on a missing path creates "Missing
   file/module". They're not dependencies the human manages.
4. **Instruction/status drift.** CLAUDE.md says current phase 50 (51 is
   accepted); PLAN.md said Phase 51 DRAFT; AGENTS.md says OpenCode and
   Antigravity lack decision extraction (all six have it per
   `src/lib/onboarding.ts`); README claims "blocker extraction" (the extractor
   outputs decisions only). Claude never reads AGENTS.md here: CLAUDE.md
   exists and doesn't import it (Claude Code docs, verified via Context7).

## Part A — Next shows deliberate work first

New cascade, pure function in `momentum.ts`:

1. latest open landing note (your own written next action)
2. Now-starred card (`plannedCard.now === true`)
3. oldest open, non-stale decision
4. top unstarred planned card

Blockers leave Next entirely: remove `blockers` and `onBlockerDone` from
`MomentumInput`. An unblock step can still reach Next as a landing note or a
Now card.

UI (`SidePanel.tsx` Next section):
- Planned-card button reads **▶ Start**, title "Moves this card to Building
  and frees its Now slot". Other kinds keep **✓ Done**. Behavior unchanged.
- Landing-note Next shows its age (existing `ago()` helper), so an old note
  reads as old. No auto-expiry rule; add one only if old notes keep hiding
  Now cards during the trial.

`ProjectOverview.tsx` call sites (L254, L354) follow the new signature. Copy
update keeps passing `plannedCard: null` (unchanged).

## Part B — Two-tier Blockers: project blockers on top, detected below

*Revised 2026-10-06 before approval (maintainer idea, from screenshots of
"Rate limited" cards matching grep output of this repo's own code comments).
Replaces the earlier off-by-default toggle: no setting, no Setup row,
nothing hidden.*

Sidebar Blockers section, top to bottom:

1. Header `Blockers (N)` — N counts **project blockers only**. "clear all"
   resolves project blockers only.
2. "Add blocker…" input (unchanged).
3. **Project blockers**: `source = 'manual'`, current red card format,
   unchanged. (Agent-reported blockers join this tier later; see Out of
   scope.)
4. **Detected (M)** — open detector rows rendered in the Accomplished
   tool-row shape (`SidePanel.tsx:1698`): `ago` column, label line, one
   truncated mono line of the matched text with full text on hover. Muted
   colors (no red border/fill). First `ROW_CAP` rows, `＋N` to expand, same
   as Accomplished. Per row: ✕ resolve, **↑ promote** (adds a manual blocker
   with `<label>: <text>` and resolves the detected row, human-clicked).
   Group-level "clear detected".
5. **Cleared Blockers** collapsed list: project blockers only. Resolved
   detected rows aren't listed anywhere (still in the DB).

Counts — detected rows stop counting anywhere outside their own group. One
shared SQL fragment (`source = 'manual'`) in `repo.ts` for:
- `blockerCounts` (tab badges)
- Inbox union in `listAttentionEvidence`
- Overview open blockers and Copy update blocker lines (Overview gets one
  muted "M detected" line, no list)
- Left alone: catalog/overview activity timestamps (recency, not a count).

`listBlockers` keeps returning all rows; SidePanel splits by `source`.
Detectors keep writing unchanged (dedupe per project+session+label while unresolved, so
growth is bounded). Nothing deleted or rewritten; no migration.

## Part C — Instructions, docs, and the working agreement

1. **AGENTS.md**: correct the adapter matrix (all six adapters have decision
   extraction; none have LLM blocker extraction). Append the working agreement
   below.
2. **CLAUDE.md**: add `@AGENTS.md` near the top so Claude reads the shared
   file. Replace the long "Phase status" paragraph with one pointer:
   current state = last entry in `docs/PROGRESS.md` (single status source;
   CLAUDE.md stops restating it). Some invariant text is then loaded twice;
   accepted, it's small.
3. **README**: "Decision / blocker extraction" column → "Decision
   extraction"; matching sentence below the table; Blockers row says manual
   plus optional auto-detected.
4. **PLAN.md**: points at this plan. Cleared on acceptance.
5. **TESTING.md**: new section for the live checks below. **PROGRESS.md**:
   entry on acceptance.

Working agreement text (goes into AGENTS.md verbatim):

```markdown
## Logic Loop working agreement

- Before substantial work, state the intended result, first action, and how
  you'll check it's done. If a plan already exists, follow it; don't restate it.
- Surface consequential choices the user might challenge, one line each:
  `Assumed: <choice> over <alternative> — <reason>.`
  Skip routine implementation details. An assumption never replaces required approval.
- Put questions that need a reply last, as a short numbered list.
- When work can't proceed: `Blocked: <what> — needs <action, person, or info>.`
- Report what you verified and how, what's unverified, and whether human
  review or acceptance is still pending. Never just "done".
- End any turn that leaves work unfinished with
  `Next: <one concrete action> (<who>)`. If nothing remains, say so; don't invent work.
- Plans and the board belong to the user: propose changes to
  `.logic-loop/board.md`, don't make them.
```

Nothing in the app parses these lines. They reach existing features only
through transcript-based LLM extraction (decisions) and the landing-note
drafter (Auto mode). Parsing them deterministically is IDEAS.md #5 and
stays parked.

## Invariants

- #1: no PTY parsing added; the agreement only changes transcript content.
- #2: no new failure paths; Part B is presentation and a WHERE clause.
- #3: Part B is a WHERE clause in repo.ts plus a split in the component; no
  rows rewritten.
- #4: Start/Done/promote stay human-clicked; nothing written into a terminal.
- #5: no extraction prompt change; golden not run.
- Rust untouched by design, but `cargo test --lib` and clippy still run
  (`dashboard_checks.rs` reads `repo.ts`; Phase 51 lesson).

## Steps (each with its check)

1. **Cascade.** Rewrite `computeMomentum`; replace `momentum-check.ts`
   characterization fixtures with the new order: landing beats all; Now card
   beats decisions; decision beats unstarred planned card; blockers never
   appear; stale decisions excluded by the caller as today. *Check:
   `npm run momentum:check`.*
2. **Callers + labels.** SidePanel Start/Done label and landing age;
   Overview call sites. *Check: `tsc --noEmit`, `dashboard:check`.*
3. **Two tiers.** Shared `source = 'manual'` fragment on badge/Inbox/
   Overview readers; project-only `resolveAllBlockers`; new
   `resolveDetectedBlockers(cwd)`; promote; SidePanel split with
   Accomplished-style Detected rows. *Check: extend `blockers:check` with a
   `node:sqlite` fixture (detected rows excluded from counts and Inbox;
   project clear-all leaves detected open; clear-detected leaves project
   blockers open; promote yields one open manual row and one resolved
   detected row); update its existing `resolveAllBlockers` SQL and clear-all
   wiring assertions; `attention-inbox:check` still green.*
4. **Docs + agreement.** Part C items 1-5. *Check: `git diff --check`;
   re-read AGENTS.md/CLAUDE.md render; `/context` in a fresh Claude session
   here lists AGENTS.md under memory files.*
5. **Gates.** `npx tsc --noEmit`, `npm run check`, `npm run build`,
   `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`,
   `git diff --check`.

## Live checks (maintainer, rebuilt app)

- Project with open decisions and a Now card: Next shows the Now card.
  Unstar it: Next shows the oldest decision. Write a landing note: it wins and
  shows its age.
- Planned card in Next shows ▶ Start; clicking moves it to Building and frees
  the Now slot.
- Project with both kinds: cards show only manual blockers; Detected (M)
  shows compact muted rows below, `＋N` expands. Tab badge and Inbox count
  only manual. Overview shows the "M detected" line.
- Header "clear all" leaves detected rows open; "clear detected" leaves
  manual cards open (verify with a counts-only query).
- ↑ promote on a detected row: a red card appears with the label and text;
  the detected row disappears.
- Lock-in and compact rail unaffected; existing color roles only.
- Fresh Claude session in this repo: `/context` lists AGENTS.md.

## Trial (starts at merge, review at +7 and +14 days)

Weekly, ~10 min: re-run the baseline counts above (counts only), then read by
eye 5 recent decision cards and, if Auto mode is on, 3 landing drafts.

Continue if: landing drafts are usable without rewriting; decision cards are
mostly ones you'd act on; decisions/day doesn't climb well past ~49 without
better cards; the agreement doesn't make replies noticeably padded.
Otherwise cut the responsible line (`Assumed:` is first suspect: its text
passes the `/\?|assum/i` prefilter and the extractor treats stated
assumptions as decisions). README publication waits for a "continue".

Limit: extraction calls aren't logged, so decisions created/day is the
proxy; calls that yield zero decisions are invisible. Draft acceptance isn't
stored either; judged by sample.

## Decisions (confirm or change at approval)

Made (maintainer, 2026-10-06): detected blockers stay visible but drop to a
compact tier below project blockers, Accomplished-style; project blockers
keep the card format and the priority.

Proposed defaults, **confirm or change at approval**:
1. Detected rows count **nowhere** outside their own group: no tab badge,
   Inbox, Overview count or Copy update line (recommended: that's where the
   noise costs most).
2. Detected tier shows the first `ROW_CAP` rows expanded with `＋N`, like
   Accomplished, rather than a collapsed `Detected (M)` header like Cleared
   (recommended per the screenshot; collapsed is the quieter alternative).
3. Include **↑ promote** (recommended: it's what makes keeping the noise
   tier worthwhile; ~10 lines).
4. Agreement goes into **AGENTS.md here now**; README only after the trial
   (recommended).
5. Unstarred planned card ranks **after** decisions (recommended: starring is
   the deliberate signal).
6. Landing mode during the trial: **Auto** (recommended: the `Next:` line's
   main payoff is the drafter, which doesn't run in Manual). Your call; Manual
   currently set, likely for good reason.

Approved (maintainer, 2026-10-07): all six defaults above, except #2: the
Detected tier shows **all** rows to start (`−` collapses to `ROW_CAP`, `＋N`
re-expands). #6 Auto landing mode for the trial is a setting the maintainer
flips in the app at merge; no code.

## Plan revisions during build (2026-10-07, stated explicitly)

1. **AGENTS.md cap raised 3,072 → 4,096 bytes** (maintainer decision, asked
   mid-build). Plan 003's accepted design capped AGENTS.md at 3,072 bytes,
   ASCII-only, enforced by `opencode:check`; the agreement brought it to
   ~4,000. `opencode:check` now asserts 4,096 and Plan 003 carries a note.
   The agreement in AGENTS.md uses ` - ` instead of em dashes to stay ASCII.
   Headroom is now ~84 bytes; the next AGENTS.md addition needs a trim.
2. **Detected-row ✕ resolves ("Clear"), it doesn't delete.** Red cards keep
   ✕ = delete as before. Matches "clear detected" and keeps history.
3. **Per-card detector expand removed.** Detector rows no longer render as
   cards, so `expandedBlockers`/`toggleBlocker` became dead and were removed;
   the full matched text is on hover (`title`), as in Accomplished.
4. **Promote keeps provenance**: the new manual row carries the detected
   row's session/tab/agent/actor, so its Inbox row can still jump to the tab.
5. **Overview** keeps one `openBlockers` read (all open rows) and splits in
   render, rather than adding a second read key with its own loading state.
6. Step 4's `/context` check is manual (TESTING.md item 39); not run by the
   agent.

Live-review follow-ups (maintainer, 2026-10-07, first rebuilt-app look):

7. **Detected starts collapsed to the newest `ROW_CAP` (5)**, `＋N` expands,
   like Accomplished. Reverses the approved "all rows to start" (#2).
8. **Detected tier tinted to match Blockers**: `Detected` header and
   "clear detected" use the Cleared Blockers tone (`danger-400/60`, hover
   `danger-300`); row labels (Lock held, Port in use, ...) `danger-300/80`.
   Age, mono detail and ↑/✕ stay zinc.
9. **Promoted cards keep the label-over-detail layout** (pink label, white
   ＋ expand, grey mono match clamped to 2 lines), as detector cards looked
   before this phase. Promote now writes `source = 'promoted:<label>'`
   (was `manual`); text stays `<label>: <match>` so Inbox, Overview, Copy
   update and Cleared keep showing the category unchanged. The project tier
   is `manual` OR `promoted:%` in both `PROJECT_BLOCKER_SQL` and
   `isProjectBlocker`; `promotedParts` splits it for the card. The
   per-card expand state removed in revision 3 is back for these cards.
   One card promoted during the first live look was stored as `manual` and
   keeps the flat layout; delete it and re-promote if wanted.

## Out of scope

Stable card IDs; parsing `Blocked:`/`Next:` lines deterministically (IDEAS
#5); board ↔ phase sync; spec-file plan view (ROADMAP "Spec-file
detection"); CONTEXT.md; deleting or rewriting detected blocker rows; removing
detector code; DB size/retention (needs a storage breakdown first); Mac beta
release (parallel track, not this phase).

Parked as follow-ons, each its own plan:

- **Agent-reported project blockers (Phase 53 candidate, gated on the
  trial).** Add a `blockers` field to the existing decision-extraction call
  (same turn-pair, no extra call), widen the prefilter to catch
  blocked/can't-proceed language, store as `source = 'agent'`, render in the
  project-blocker card tier below manual ones with an "agent" tag
  (provenance: reported, not confirmed). Prompt change → new golden fixtures
  (real blocked turn vs. the word "blocked" in code) and `npm run golden`.
  Build only if the trial shows `Blocked:` lines appearing and meaning
  something.
- **Detector precision.** Both "Rate limited" screenshots are matches on
  file contents (grep output of code comments, README text), not failures.
  Running detectors only on failed tool results would cut most of them, but
  error fields differ per adapter (agy strips exit status). Investigate
  separately.
