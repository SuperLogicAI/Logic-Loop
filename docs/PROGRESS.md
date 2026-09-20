# Progress — Logic Loop

Phase-by-phase history: what shipped, what was found live, what's still
open. Append-only. Referenced from CLAUDE.md.

- Phase 0 (terminal shell): ACCEPTED
- Phase 1 (event spine): ACCEPTED
- Phase 2 (deterministic panels): ACCEPTED 2026-07-11
- Phase 3 (decision tracker + extraction): ACCEPTED 2026-07-11 — golden set
  (docs/golden/) passing 12/12; rerun `npm run golden` after ANY prompt change
- Phase 4 (landing note / residue / momentum): ACCEPTED 2026-07-18 — needed a
  cwd-canonical fix mid-test (see docs/LANDMINES.md + ROADMAP "Project identity")
- Phase 5 (hardening: project identity / tab tether / hook contract): ACCEPTED
  2026-08-11 — re-entry/unclaimed/nudges moved to Phase 6; public artifact
  split to a later phase
- Phase 6 (re-entry / unclaimed results / nudges): ACCEPTED 2026-08-15 —
  migration 7 (`session_bindings`), `SessionStart` hook, `resume_session`,
  per-tab unclaimed-result flag/claim, notify mute. Audit fixed restart-seeded
  claim (see docs/LANDMINES.md) + cwd-less `result_landed` write. Two dev-workflow
  TCC issues surfaced, documented as landmines, not regressions.
- Phase 7 (fan-out spawn groups + side panel resize/collapse): ACCEPTED
  2026-08-17 — extractor-tether exemption holds for fan-out children (verified
  not to reproduce the 2026-07-19 self-ingest bug). Post-acceptance smoke
  testing found/fixed a non-Claude fan-out display gap (`isUnboundFanOutChild`).
- Phase 8 (OpenCode adapter): ACCEPTED 2026-08-18 — first non-Claude ingestion
  pipeline. `src-tauri/src/opencode.rs` writes a plugin entry in
  `~/.config/opencode/opencode.json`, translates native events into Claude's
  `hook_event_name` wire shape. Decision/blocker extraction stays Claude-only
  (deliberate non-goal). Also fixed a fan-out spurious-landing-note bug and
  split adapter toggles into `AgentStatusBar.tsx`.
- Phase 10 (Codex adapter): ACCEPTED 2026-08-27 — second non-Claude ingestion
  pipeline; Codex's hook contract near-clones Claude's, so `codex.rs` reuses
  `ingest::hook_command()` verbatim into a standalone `~/.codex/hooks.json`.
  Found/fixed a scope leak: `ensure_tailer` was persisting Codex's raw rollout
  transcript into `events`; gated with `is_claude_transcript_path()`. Built as
  a sidequest ahead of Phase 9's own formal acceptance.
- Phase 9 (isolate loop / Commit & Push footer): ACCEPTED 2026-08-27 — found +
  fixed the wip-branch-checkout bug (see docs/LANDMINES.md) plus a recurrence of
  the untracked-file-checkbox trap, this time on real Phase 11 content (PR #4).
- Phase 11 (Antigravity `agy` adapter): ACCEPTED 2026-08-27 — third non-Claude
  ingestion pipeline; grouped vs. flat event shapes, no `PreToolUse`
  registration. Two upstream contract limits pinned by unit test as tripwires:
  `run_command` `is_error` blindness, and named hooks not merging on
  `PostToolUse` (later confirmed fixed upstream, see Phase 16 follow-up).
- Phase 12 (CI + Windows leg): ACCEPTED — GitHub Actions with a Windows
  compile leg (PR #5). Backfilled per Phase 14 PLAN.md's numbering note.
- Phase 14 (since-you-left delta + clock on state): ACCEPTED 2026-09-05 —
  7/8 manual steps passed; found a real gap, deliberately unfixed: a turn
  interrupted by quitting doesn't survive relaunch (logged in IDEAS.md).
- Phase 15 (turn provenance + loop digest): ACCEPTED 2026-09-06 — human-vs-auto
  provenance tagging + loop-digest collapsing. Found/fixed unserialized
  concurrent `claude -p` extractor spawns causing tab-switch lag; fixed with
  one shared queue (`src/lib/extractorQueue.ts`).
- Phase 16 (Codex + Antigravity follow-up fixes): BUILT 2026-09-06 — Codex
  gained an `X-Logic-Loop-Agent` marker + `Interrupt`/`SessionEnd` handling;
  Antigravity's turn-epoch-stuck bug fixed via `PreInvocation` +
  `invocationNum == 0` (see docs/LANDMINES.md); Antigravity tool payloads
  normalized. Follow-up 2026-09-07: `PostToolUse` named-hook merge bug confirmed
  fixed upstream in agy 1.1.27; shipped defensive `detect_foreign_post_tool_use()`
  regardless for older installs. `run_command` `is_error` blindness remains
  permanent (no exit-code field exists to map).
- Windows `$HOME`/`USERPROFILE` fix (PR #18, merged 2026-09-06): collapsed
  four adapters' private `home()` fns into `src-tauri/src/home.rs`, trying
  `HOME` then `USERPROFILE`, fixing silent hook-registration failure on
  native Windows.
- Phase 17 (decisions cleanup — grouped by session, bulk-dismiss): ACCEPTED
  2026-09-06 — found/fixed a real bug: `SidePanel.tsx`'s `reload()` was
  scoping `decisions` state by session before grouping, killing cross-session
  clustering.
- Phase 18 (Idea Board): ACCEPTED 2026-09-06 — `.logic-loop/board.md` per
  project (git-committed markdown), pure parse/splice/append module
  (`src/lib/board.ts`), two Rust commands, `IdeaBoard.tsx` bottom dock.
  Reload-before-write on every card move to avoid stomping hand-edits.
- Phase 19 (decisions empty-state clarity): ACCEPTED 2026-09-06 — found/fixed
  the Codex hook-trust-hash invalidation bug live (see docs/LANDMINES.md).
  Decisions empty state now distinguishes unbound/blind/non-Claude/actually-empty.
- Phase 20 (Idea Board "Now" set): ACCEPTED 2026-09-06 — `now: boolean` on
  cards, hard cap of 3, ★ toggle, momentum fallback prefers first Now card.
- Phase 21 (Codex decision/blocker tracking): ACCEPTED 2026-09-07 — Codex
  rollout transcripts now use the shared tailer/decision pipeline; extractor
  tether still holds so the app's own `claude -p` child can't self-ingest.
- Phase 24 (blockers bulk clear): ACCEPTED 2026-09-08 — `clear all` (2+ open
  blockers) moves active project's open blockers to resolved history.
- Phase 25 (folded side rail): ACCEPTED 2026-09-09 — compact icon rail adds
  no new Inbox/Lock-In/fan-out/commit/ingestion/claim/PTY semantics.
- Phase 26 (cross-project Attention Inbox): ACCEPTED 2026-09-09 — live dogfood
  across two projects/six tabs; inbox stuck at `99+` because route-unavailable
  durable rows still counted, motivating Phase 27.
- Phase 27 (Attention triage and backlog control): ACCEPTED 2026-09-10 —
  Active/Backlog/Archived partitioning, occurrence-scoped archive/restore.
  Archive state never mutates source decision/blocker status or claims.

- Phase 28 (landing-note manual/auto capture): ACCEPTED 2026-09-10 — the
  maintainer reported the live macOS matrix passing and wrote
  `PHASE 28 APPROVED` after the earlier implementation gate
  `PHASE 28 ACCEPTED`. All 23 frontend checks, strict
  TypeScript, production build, Rust tests (57/57), clippy, and diff checks are
  clean. A global setting defaults existing installs to Auto, while Manual
  consumes departure activity without opening a modal or running the
  landing-draft extractor. **Notes and reminders** owns the mode control and a
  rainbow-bordered active-project manual capture action. It toggles the shared
  Notes input to a rainbow landing state with the return-action prompt inline;
  Enter saves and no manual popup/draft/countdown exists. Both Save paths reuse
  the existing landing-note/Momentum contract. Inline borders reuse the popup
  Save button's subtle 0.6-opacity gradient; the automatic popup uses a quieter
  0.3-opacity card border and a solid `Landing note` heading with no cwd suffix.
  No migration, Rust, ingestion, PTY, adapter, notification, or
  extraction-prompt change.

- Phase 29 (preserve bookmark tab presentation through re-entry): ACCEPTED
  2026-09-10 — manual test (docs/TESTING.md §41) all 7 checks passed;
  maintainer wrote `PHASE 29 APPROVED` after the live relaunch matrix.
  Bookmark-opened ghost tabs now restore their custom display name and
  accent color across quit/relaunch instead of falling back to project
  basename/gray, migration 12 adds `tab_title`/`tab_color` to
  `session_bindings`, latest-per-tether selection keeps two same-cwd
  bookmarks from merging presentation, and pre-Phase-29 rows with no stored
  title/color still fall back cleanly. Unclaimed-result seed-before-
  activation ordering (Phase 6) verified undisturbed. Quality gates clean:
  `npm run reentry:check` (extended), `tsc --noEmit`, `cargo test` 57/57,
  `npm run check` 23/23, production build, clippy, `git diff --check`.

- Phase 30 (repeatable window dragging from app chrome): ACCEPTED 2026-09-10 —
  implementation authorized via `PHASE 30 ACCEPTED`, then approved by the
  maintainer via `PHASE 30 APPROVED`. Root cause: Tauri's
  injected drag script calls `plugin:window|start_dragging`, which
  `core:window:default` excludes — fixed by adding only
  `core:window:allow-start-dragging` plus Tauri 2.11.5's deep drag-region
  attribute (`data-tauri-drag-region="deep"`) on the three intended chrome
  owners (titlebar in `App.tsx`, `BookmarksBar.tsx`, `TabBar.tsx`); no
  broader window permission added. Quality gates clean (`tsc --noEmit`,
  `cargo test` 57/57, `npm run check` 23/23, production build, clippy,
  `git diff --check`, drag-region rg audit). Live macOS matrix
  (docs/TESTING.md §42) is partial: maintainer confirmed PASS on the
  20-consecutive-drag count, inactive-app first drag, nested empty
  tab-strip/bookmark-bar chrome, titlebar double-click zoom, and the
  bundled dogfood app — remaining unchecked: ordinary tab/bookmark
  click-close-reorder-context-menu non-drag regression, Landing Note/modal
  overlay drag-through, and file-drop/text-select/panel-resize/native-edge
  resize regression. The first tab-reorder pass found a regression: project
  tabs are interactive `div`s, so Tauri's deep drag-region script did not
  classify them as clickable and moved the native window before React's
  pointer reorder could run. The Phase 30 follow-up adds the supported
  `data-tauri-drag-region="false"` boundary to each tab; its live reorder
  retest passed. The maintainer accepted the two expanded regression groups
  that were not separately rerun after this narrow follow-up; §42 records
  those explicitly rather than presenting them as tested.

- Phase 31 (first-run agent activation): BUILT 2026-09-10 — implementation
  authorized by `PHASE 31 ACCEPTED`; clean-profile live acceptance remains.
  A versioned, reopenable Setup checklist detects all four supported agents,
  states their truthful activity/decision/re-entry depth, and reuses the
  header's single adapter state/toggle path. Hook installation remains an
  explicit click. Connected requires a real tethered structured event in the
  current app run; PTY output and elapsed time are never evidence. Startup now
  only reads notification permission, while the explained checklist action is
  the sole request path. Setup/version persistence uses the existing typed
  settings repository with no migration. Invalid config errors render as
  capped plain text and fail open. Automated gates pass: all 24 frontend
  checks (including `onboarding:check`), strict TypeScript, production build,
  Rust tests 58/58, clippy, and diff validation; no golden run because prompts
  are unchanged. Live matrix: `docs/TESTING.md` §43.

  Phase 31 acceptance exception (2026-09-10): the maintainer intentionally
  deferred the clean-profile live matrix to ship Phase 32 tonight. Section 43
  remains unchecked and is not represented as passing. The maintainer then
  authorized the next implementation with `PHASE 32 ACCEPTED`.

- Phase 32 (two-terminal split view): ACCEPTED 2026-09-11 — live macOS matrix
  (docs/TESTING.md §44) all 5 tests passed. A labeled Split pill
  beside Lock-in uses the maintainer-supplied `split_screen.svg` geometry and
  opens an ordinary second tab through the existing PTY spawn path. Two tabs
  remain independently tethered in a fixed vertical split; focus drives the
  side panel, visible tabs suppress unseen-result/nudge behavior, and selecting
  a third tab replaces only the focused pane. Closing a pane expands its
  survivor; turning Split off retains both processes and shows the focused one.
  Layout is deliberately in-memory with no schema or re-entry changes. All 25
  frontend checks, strict TypeScript, production build, Rust tests 58/58,
  clippy, and diff validation pass. Golden was not run because prompts are
  unchanged. Live matrix: `docs/TESTING.md` §44.

- Phase 33 (decision reconciliation): manual test all 11 steps passed
  2026-09-11. Live cost finding, not a functional bug: running the sidebar
  LM on Claude CLI through the 11 steps burned ~60% of a five-hour session
  limit, consistent with the ~7-14x token estimate in docs/LANDMINES.md — flag
  before adding any more extraction triggers.
  Known duplicate-card artifact recurred (an agent's own "pick one"
  follow-up gets extracted as a second open card) — already-flagged gap,
  not a regression. Tab-restore-loses-a-tab bug found during this pass is
  unrelated, tracked as its own landmine, not part of Phase 33 scope.

- Phase 33.1 (extractor spend emergency sprint + haiku reconciliation
  default): BUILT 2026-09-12 — implementation authorized by
  `PHASE 33.1 ACCEPTED` following
  `plans/013-extractor-spend-emergency-sprint.md`, haiku-default follow-up
  directed live by the maintainer on `feat/phase33.1-haiku-default`. Root
  cause measured and fixed (see the rewritten Phase 33 landmine in
  docs/LANDMINES.md): stripped `claude -p` child spawn cuts fixed per-call
  overhead ~41-51x; Answer-now deterministic close, reconciliation skip gates,
  insert-time dedup, and tighter prompt caps all shipped. Haiku on
  reconciliation regressed first (fence-wrapped JSON failed strict parsing),
  then the real bug was fixed (`parseReconciliation` fence intolerance) and
  re-verified 3x full golden for flakiness: reconciliation clean 3/3 on haiku,
  extraction showed a reproducible ~1-in-7 miss on `09-question-in-code`.
  Reconciliation now defaults to haiku (~40x cheaper, user-dialable back to
  sonnet via a new `⚙ Sidebar LM` control, `ExtractorSettings.reconcileModel`);
  extraction stays sonnet, not switchable, because a false-positive decision
  card is a worse failure than the extra spend. `scripts/golden.ts` gained an
  `EXTRACTOR_MODEL` env var for any future model-default experiment.
  Automated gates clean: `npm run check` 26/26, `npm run golden` 21/21, `tsc
  --noEmit`, production build, `cargo test` 60/60, clippy, `git diff
  --check`. Unverified: live manual matrix (`docs/TESTING.md` §46, including
  a re-run of Phase 33's own 11-step matrix to compare session-limit
  consumption against that pass's ~60% figure), and no live UI test of the
  new Sidebar LM control. Plan: `plans/014-reconciliation-haiku-default.md`.

- Phase 33.1 live-test outcome (2026-09-12): the deferred live manual matrix
  above finally ran (first real Claude-CLI-backed UI pass since the
  rebuild). Cost/haiku-default fix confirmed working from live token counts.
  Found a real, unresolved app-wide freeze bug on extractor-triggered
  actions — see docs/LANDMINES.md and `plans/015-decision-panel-freeze-
  investigation.md` for the full trail. That investigation concluded the
  freeze predates Phase 33 (lives in Phase 3's extraction call) and that
  Phase 33's automatic reconciliation isn't load-bearing (manual dismiss +
  Answer-Now + notifications already cover it, and it's the source of the
  duplicate-card landmine plus a card-not-closing bug found this pass) —
  decided to descope it. `feat/phase33.1-haiku-default` ends here; work
  continues on a new branch per `plans/016-descope-auto-reconciliation.md`.

- Plan 016 (descope automatic reconciliation): BUILT and live-tested
  2026-09-12 on `fix/descope-auto-reconciliation`. Not a numbered phase —
  removed the guessed-match reconciliation call (`run_extractor` +
  `buildReconciliationPrompt`/`parseReconciliation`/`shouldSkipReconciliation`
  /`isBareAffirmation`/`hasContentWordOverlap`, the `reconcileModel` setting,
  and the ⚙ Sidebar LM "Reconciliation model" control) entirely.
  `reconcile()` now only checks the deterministic Answer-Now match; manual
  dismiss, insert-time dedup, and notifications are untouched and remain the
  mechanism for staying aware of open decisions. 7 reconciliation golden
  fixtures deleted; golden is extraction-only (14/14). New contract-lock
  assertion in `decision-integrity:check` pins that `reconcile()` never
  contains `run_extractor`. All 5 live manual steps passed
  (docs/TESTING.md §48); the ~20-30s tab-switch freeze observed during that
  pass is the pre-existing, already-tracked landmine, not a
  regression. Automated gates clean: `npm run check` 26/26, `tsc --noEmit`,
  production build, `cargo test` 60/60 (no Rust changes), clippy, `git diff
  --check`.

- Plan 017 (fix the decision-extractor app freeze): DONE, live-confirmed
  2026-09-12 on `fix/descope-auto-reconciliation`. Root-caused via a live
  `sample` capture (see the rewritten "Extractor calls can freeze the whole
  app" landmine in docs/LANDMINES.md for the full mechanism) to `SidePanel.tsx`'s
  `reload()` awaiting five synchronous, main-thread-blocking Tauri commands
  — never `run_extractor`, which Plan 015's two fixes had already correctly
  handled. All 15 git-shelling commands (`pty.rs`) plus `read_board`/
  `write_board` (`board.rs`) converted to `async fn` + `spawn_blocking`.
  Also hardened every one of those 15 commands with `has_own_repo(cwd)`
  against an unrelated, unintended `~/.git` found during live testing
  (empty, no commits, not created by this codebase) that had been letting
  `git -C <cwd> ...` silently operate on the whole home directory for any
  project without its own `.git` — almost certainly why the original freeze
  measured ~31s specifically. Maintainer confirmed live: "exceptionally
  snappy... no lag." Automated gates clean: `cargo test` 61/61 (new
  regression test for the `.git`-boundary fix), `cargo clippy -D warnings`,
  `cargo check`. No TS/frontend changes, so no `npm run check`/golden/build
  rerun needed. Two unrelated findings surfaced live, neither fixed here
  (see `plans/017-fix-extractor-freeze.md`'s addendum): Claude Code CLI not
  writing transcript files for new sessions in the test project since
  ~9:31am 2026-09-12, and an occasional extractor token-usage spike.

  Live testing after this fix also surfaced a separate finding, initially
  overstated in an earlier version of this note and corrected the same day
  once a full extraction round-trip was actually observed working:
  Claude Code CLI v2.1.270 adds several new preamble/metadata line types to
  its local transcript (`last-prompt`/`mode`/`permission-mode`/
  `atis-latch`/`bridge-session` — confirmed via a control test run entirely
  outside this repo, plain Terminal.app, no Logic Loop involved, ruling out
  anything in this codebase, GPT-authored or otherwise, as the cause). The
  first read only sampled the first 5 lines of a 41-line file and wrongly
  concluded the whole format had changed. A live decision card extracted
  correctly from a later Terminal.app test proved otherwise: `type:
  "assistant"`/`"user"` lines are still present and still exactly the shape
  `textFromTranscriptLine` already handles — the new types are additional
  noise mixed in, not a replacement. **Extraction is not currently broken by
  this.** Anthropic's own docs still say the format "is internal to Claude
  Code and changes between versions, so scripts that parse these files
  directly can break on any release" — real standing risk, just not
  triggered today — so Plan 018's tripwire (below) is kept as preemptive,
  not as a fix for an active break. See CLAUDE.md invariant #1's caveat.
  Separately, still unexplained and still real: a session spawned through
  Logic Loop's own PTY writes no local transcript file at all (old or new
  format) in a directory where an identical Terminal.app-launched session
  does — not root-caused, not this plan's scope. **Likely explained
  2026-09-14** (see the `CLAUDE_CODE_CHILD_SESSION` landmine in
  docs/LANDMINES.md): if the dev server or app was itself launched from
  inside a Claude Code CLI shell that carried that env var, every spawned
  PTY tab would inherit it and silently disable its own transcript saving —
  matching this symptom exactly. Not confirmed as the same root cause for
  this specific 2026-09-12 instance (no env captured at the time), but the
  mechanism fits precisely and is now a known, reproducible cause of the
  same symptom.

- Phase 34 (Plan 020 Codex extractor spend and transcript audit): BUILT
  2026-09-12. Two bounded Codex CLI 0.154.0 calls on the real extractor prompt
  measured 16,756 input / 5,888 cached-input tokens in 5.36s for the current
  app arguments, versus 15,139 / 9,984 in 4.36s with
  `--ignore-user-config` while explicitly preserving the configured
  `gpt-5.6-terra` / high-reasoning choice. That 9.6% reduction is real but
  not Claude's former 40x failure. The app's persisted Codex model override
  is blank, so isolation would otherwise silently change a user's configured
  model/effort; it was deliberately not shipped. `codex_final_message` now
  logs completed-turn aggregate usage and rejects failed/incomplete turns;
  golden follows the same completion contract. Automated gates are clean
  (63 Rust tests, clippy, all frontend checks, tsc, build). The fresh
  `npm run tauri dev` Codex rollout/card test then passed: a card landed in
  about four seconds, ordinary replies stayed open, Answer-Now closed the
  intended card, manual dismissal worked, and the terminal/UI stayed snappy.
  Three observed usage lines were `16744/5888/108/70`, `19262/5888/14/0`, and
  `16741/5888/35/0` (input/cached-input/output/reasoning-output); no recursive
  extractor behavior was seen. The warning strip was not separately inspected.

- Sidebar LM Claude model override (2026-09-12): not a numbered phase.
  Codex's Sidebar LM control let users override its model; Claude's did not
  — an unexplained asymmetry, fixed for parity. Added `claudeModel` to
  `ExtractorSettings` (persisted as `claude_model`), wired through all three
  `run_extractor` call sites (`decisions.ts`, `landing.ts`,
  `commitMessage.ts`) in place of a hardcoded `"sonnet"` literal — Rust's
  `run_extractor` already accepted a `model` param and defaulted to sonnet on
  empty, so no Rust or migration change was needed. The UI shows a warning
  only when overridden away from sonnet, since extraction quality is
  model-sensitive: haiku missed ~1-in-7 decisions in Phase 33.1 golden
  testing, so the dial ships but the tradeoff is stated up front, not hidden.
  Also fixed a `claude CLI` → `Claude CLI` capitalization typo in the same
  control. Gates clean: `tsc --noEmit`, `npm run check` 26/26, production
  build; no Rust changes, so no cargo/clippy rerun. Shipped together with
  Phase 34 in PR #26 (`fix/descope-auto-reconciliation` → `main`) — merged.

- Plan 018 (transcript schema-drift tripwire): DONE 2026-09-12, directed
  live by the maintainer ("build the local detection tripwire") after
  discussing and rejecting a heavier alternative (an AI agent reading CLI
  changelogs) in favor of detecting a real break locally, if one ever
  happens. Not a numbered phase, and — per the corrected Plan 017 note
  above — not a fix for anything currently broken: live testing confirmed
  extraction still works fine on v2.1.270, so this shipped as standing,
  preemptive insurance against a future break, not a patch for today's.
  `decisions.ts` gained `transcriptEnvelopeType()` (pure, tested against the
  new v2.1.270 preamble line types alongside real `assistant`/`user` lines)
  and a per-session consecutive-miss counter; past a threshold of 20, it
  fires once through the existing `adapterWarnings` strip (`onAdapterWarning`'s
  same UI, no new Rust command, no new Tauri event). Live-verified 2026-09-12
  it does **not** false-fire on a real, healthy v2.1.270 session (3 turns,
  correct decision card extracted, warning stayed silent) — confirms the
  threshold is calibrated correctly, though it means the tripwire's actual
  firing behavior on a genuine break is still unobserved live, only unit-
  tested. Gates clean: `npm run check` 26/26, `tsc --noEmit`, production
  build; no Rust or extraction-prompt changes, so no cargo/golden rerun.

- Antigravity re-entry sprint (2026-09-16, Plan 025): the maintainer
  explicitly authorized an isolated build on `feat/antigravity-session-reentry`
  despite the normal phase and pre-code live-test gates, then approved the
  current sprint after all §51 manual checks passed. No numbered phase was
  assigned. The branch emits synthetic `SessionStart` before
  `UserPromptSubmit` on each `PreInvocation` with `invocationNum == 0`,
  persists exact tethered bindings (with a scoped missing-cwd fallback), and
  selects `agy --conversation <id>` for PTY re-entry. Agy 1.2.4 restored a
  disposable prior conversation in a second CLI process. The Logic Loop dev
  app preserved title/color across quit/relaunch and re-entered the same
  conversation with correct prior-context recall. The maintainer reports
  the remaining projectless/outside-terminal, fail-open usability, and
  Claude/Codex/OpenCode regression checks passed. Setup now labels
  Antigravity re-entry supported. Final automated gates are in §51; merge is
  a separate action.

- Pi Agent adapter, Build steps 1-3 (2026-09-17, Plan 026): the maintainer
  explicitly authorized bypassing the literal `PHASE 26 ACCEPTED` token
  in-session, same precedent as Plan 025. Plan 026's other two dependency
  gates resolved differently: the branch-reconciliation gate (Plan 024) was
  moot — local `main` and `origin/main` were already reconciled at
  `d95a7c7` by the time this started — while Step 0's live Pi-contract
  verification was explicitly kept, not bypassed, and run first
  (`docs/TESTING.md` §53): installed Pi 0.85.1
  (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`,
  maintainer's explicit choice over the `curl | sh` alternative), confirmed
  session/tool-call/error event shapes, `--session <uuid>` context-recall
  continuity, and that a file dropped in `~/.pi/agent/extensions/` loads
  automatically with no settings.json entry and no trust prompt — one real
  deviation from upstream docs found and logged (`session_start.reason`
  never reports `"resume"`, non-blocking, Build step 2 doesn't branch on
  it). `src-tauri/src/pi.rs` (new) follows `opencode.rs`'s pure-function
  installer pattern (`plan_setup`/`plan_remove` decide from current file
  content, `pi_hooks_setup`/`remove`/`status` are thin fs wrappers) rather
  than opencode's JSON-array splice, since Pi's global extension directory
  auto-discovers a dropped file with no config file to edit. The generated
  extension maps `session_start`/`before_agent_start`/`tool_execution_end`/
  `agent_settled` to `SessionStart`/`UserPromptSubmit`/`PostToolUse`/`Stop`,
  captures only an allowlisted `command`/`file_path`/`description` from
  `tool_execution_start` in a `toolCallId`-keyed map cleared on
  `session_start`/`session_shutdown`, and never awaits its POST from inside
  a lifecycle handler. Verified two ways: `cargo test --lib` (14 new pi.rs
  tests plus an ingest.rs `RECOGNIZED_AGENTS`/tailer-gate update, 81/81
  overall) asserting the generated source's contract, and a live smoke test
  — the real generated string, extracted verbatim (not hand-transcribed),
  run in an actual Pi session against a throwaway mock ingest server on an
  isolated `$HOME` (the real dev app was live on its real ingest port at
  the time, confirmed via `lsof`, so this had to not touch it) — produced
  exactly the four expected POSTs in order with correct headers and a
  correctly bounded `PostToolUse` body. `AdapterId`, `ADAPTERS`,
  `adapterIdForHook`, the shared `ADAPTER_ACTIONS` map in
  `AgentStatusBar.tsx`, `scripts/onboarding-check.ts`'s pinned contract, and
  a new `scripts/pi-check.ts` (wired into `npm run check`) all extended;
  `ONBOARDING_VERSION` deliberately not bumped, per the plan. Pi's
  `capabilities.reentry` stays `false` until Build step 4 lands and its own
  live re-entry gate passes. Gates clean: `npm run check` 28/28, `tsc
  --noEmit`, production build, `cargo test --lib` 81/81, clippy. Build step
  4 (resume command) and step 5 (live macOS matrix) remain; see
  `plans/026-pi-agent-adapter.md` and `plans/README.md`'s status row.

- Pi Agent adapter, Build step 4 (2026-09-17, Plan 026): added the fixed
  `Some("pi") => format!("pi --session {sid}; exec {shell} -l")` arm to
  `resume_command` (`pty.rs`), matching Step 0's confirmed `--session
  <uuid>` contract. `valid_resume_id` needed no change — Pi's UUID ids
  already fit its alphanumeric/`.`/`_`/`-` set. New unit test
  `resume_command_selects_pi_syntax`; existing
  `resume_command_defaults_to_claude_syntax` already covers an
  unrecognized/rejected agent falling through to Claude's syntax rather
  than being guessed. Extended `scripts/reentry-check.ts` with a Pi case
  mirroring Antigravity's — no tailed transcript, latest tethered binding
  still restores `agent`/`tab_title`/`tab_color` correctly. The
  `agent=pi` + empty transcript-path sentinel + tailer-gate exclusion
  this step also asks to confirm were already covered by steps 1-3's
  `RECOGNIZED_AGENTS`/`is_transcript_path` work — no code change needed,
  just re-verified via `ingest.rs`'s existing tests. Gates clean:
  `cargo test --lib` 82/82, clippy, `npm run check` 28/28 (incl.
  `reentry:check`), `tsc --noEmit`, production build, `git diff --check`.
  Step 5 (live macOS matrix) remains; `capabilities.reentry` still gates
  on that live pass before flipping to `true`.

- Pi Agent adapter, Step 5 unattended groundwork (2026-09-17, Plan 026):
  while the maintainer was away, pushed the non-GUI, non-auth-dependent
  slice of Step 5 (`docs/TESTING.md` §54). Tauri's WKWebView has no CDP
  bridge, so none of this drove the actual app UI — that half of Step 5
  (toggle, tab spawn, tool detail/error rendering, disable-while-running,
  two-tabs-one-cwd, foreign-file UI error) is unchanged, still pending
  the maintainer. What's newly confirmed live: `SessionStart` fires
  correctly on real boot via a real `pi` process against a real mock
  ingest server; `/new` mid-process fires a second `SessionStart` with a
  distinct `session_id`; absent-ingest-server fail-open holds (extension
  swallows the failed POST, no hang, clean exit). Correctly stopped
  rather than worked around: this session's own permission guard
  declined a credential-access attempt when isolating `$HOME` blocked
  provider auth (Step 0's live smoke test had used a symlink into the
  real `~/.pi` for this, which needs a human's own action, not an
  unattended one) — so tool calls, multi-turn, and quit/relaunch
  `--session` continuity are still unverified, and Pi turns out not to
  persist a session file at all until a turn completes, so there was
  nothing to resume in the isolated environment regardless. One new open
  question surfaced, not yet explained: a fresh boot with no
  `--session`/`--continue` flag returned the *same* `session_id` as a
  prior run in the same `--session-dir` — worth the live matrix
  specifically checking whether a brand-new tab in a cwd with existing
  Pi history starts clean or silently resumes. All cleanup verified: no
  stray processes, real `~/.context-terminal` and `~/.pi` untouched
  (`cargo test --lib` 82/82, `git diff --check` clean throughout).

Update this file as phases are accepted.
