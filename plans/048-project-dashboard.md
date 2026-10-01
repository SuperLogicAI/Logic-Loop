# Plan 048: Home dashboard and Project Overview

## Status and execution contract

- **Release review, 2026-09-30:** Phase 48 is **NOT ACCEPTED**. The earlier
  “ACCEPTED” status below describes approval of this implementation plan,
  not acceptance of the completed phase. Overview remained loading, rendered
  false empty labels, and kept Copy update disabled in the partial release
  pass (`docs/TESTING.md` §70). See the proposed same-phase revision in
  [the fix-it sprint draft](048-dashboard-fixit-sprint.md). Remaining Phase 47
  fresh-profile/digest evidence and Phase 48 scenarios are still unverified.
- **Status:** ACCEPTED 2026-09-29 — implementation authorized. Maintainer wrote
  the literal `PHASE 47 ACCEPTED` (closing Phase 47) and `PHASE 48 APPROVED`
  (authorizing this plan's build) in the same message.
- **Priority:** P1 product direction.
- **Planned at:** `9f7c7f8`, 2026-09-29.
- **Input:** one external user-feedback session, 2026-09-25 (private recording held by the maintainer; timestamps below refer to it). One qualitative interview, not proof that every user wants every suggestion.
- **Effort:** M — one phase, ~4–6 focused engineering days plus a live pass.
- **Risk:** Medium; concentrated in terminal visibility/claims and session routing.
- **Dependencies:** Phase 47 accepted (`PHASE 47 ACCEPTED`, received 2026-09-29) — satisfied. Phase number assigned: **48**.

Executor: read this file, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/LANDMINES.md`. Promote into `PLAN.md` only after approval.

Drift check before implementation:

```sh
git status --short
git diff --stat 9f7c7f8..HEAD -- src src-tauri scripts package.json
```

Compare the anchors in §6 with live code; reconcile material differences here before coding.

## 1. Product decision

Add **Home**: one screen listing every project, what changed, what needs a choice, and where to continue. Clicking a project opens its **Project Overview**. The terminal workspace stays where work happens. The **Inbox** stays, as an optional detailed triage view — not removed, no longer the primary way in.

Promise: *open Logic Loop, see where every project stands in ~30 seconds, pick up the right thread.* Secondary: assemble a client/teammate status update from the same evidence in under two minutes.

No streaks, scores, health colors, completion percentages, or anything the user must maintain for the view to stay useful. An idle project sits quietly.

## 2. Feedback → response

| Feedback (session time) | Response in this phase | Deferred to ROADMAP |
|---|---|---|
| Organizing chats ≠ organizing projects (4:56–6:05) | Project cards spanning sessions; one project → its tabs | — |
| Per-project analytics "most helpful" (9:11) | Observed agent time, sessions, project age on Overview | Tokens/spend (needs attribution spike) |
| Needs to be intuitive without a demo; highlight decisions (9:55–10:43) | Home as first-run surface; "Needs a choice" on cards; tour starts at Home | — |
| Inbox feels like notifications/email, high friction (10:43–11:49) | Inbox kept, demoted to optional; non-mail icon; badge can be hidden | — |
| "Flight is late, update all clients": progress, decisions needed, assumptions (11:49–12:40) | **Copy update**: deterministic Markdown draft, editable preview | Risks/milestones context (RAID) |
| Build log TL;DR per session + what was committed (12:40–13:15) | Work log on Overview: per-session agent excerpt, file counts, local commits | — |
| One high-level stand-up view, click into a project (14:00–14:36) | Home → Overview → Continue | — |
| Templates, board modes (6:43–9:05) | — | Templates, grid/Kanban/burndown/Gantt |
| GitHub PRs from the app (0:31–1:13) | Existing Git controls surfaced in Project actions | PR/CI state |
| Features feel like Easter eggs (24:09) | Project actions menu names fan-out, isolate, split, board, Git | — |

## 3. Screens

### Home

A text-labeled **Home** entry in the tab bar, left of the terminal tabs. Home is an app surface, not a PTY tab: terminals stay mounted and running underneath.

- **First-time profiles** start on Home. Existing profiles keep current startup until they change **Start in: Home / Last workspace** (setting `home_start_surface`).
- Header line: "5 projects · 2 with agents working · 1 with open decisions" — overlapping counts, plain text, no score tiles. Never "Everything is on track."
- **Continue**: most recently used live or resumable workspace, with project, agent, and saved next step. User click only.
- **Project cards**, grid. Search box; filter All / Working / Needs a choice / Archived. Order: pinned, then most recently active, then project key. Live updates never move the card under pointer/focus.
- Projects with no activity in 30 days and not pinned/bookmarked sit behind **Show older projects** so long-lived profiles don't flood on upgrade.

Card contents: name (basename; parent dir appended on collision), optional one-line purpose, last meaningful change + age ("Agent reported: added booking form · 12m"), open decision count, "2 working · 1 waiting", next step with source label, buttons **Open** and **Continue**. Ambiguous Continue (several tabs) opens a small chooser. No evidence → "No activity recorded yet" + **Start session**.

### Project Overview

```text
Home / Harbor website                    Continue ▾   Copy update   Actions ▾
Simple booking site for the repair shop   Last activity 12m ago · first seen 9d ago

NEEDS A CHOICE                        PICK UP HERE
Which booking provider?               Verify the booking confirmation flow
Open decision · Codex · booking tab   From your landing note · yesterday
  Agent assumption: Stripe for now    [Continue in booking tab]
[Go to workspace]

WORK LOG (7 days ▾)                   PLAN
Today · Claude · main                 Now: Booking confirmation
  Agent reported: booking form added  Idea 3 · Planned 3 · Building 2 · Done 4
  4 files edited · 2 turns            [Open Idea Board]
  Committed locally: a1b2c3d Add form
Yesterday · Codex · booking …         AGENT TIME (observed)
                                      14h 20m across 6 sessions since Sep 20
WORKSPACES                            Parallel sessions can exceed wall clock
Main · Claude · working  |  Booking · Codex · waiting  |  2 closed
```

Example names are design illustrations only; never seed them.

- **Needs a choice:** open decisions (assumption attached), then recorded blockers. Each row routes to its exact owning workspace via `resolveAttentionRoute`; unroutable rows stay readable, labeled unavailable.
- **Pick up here:** existing `computeMomentum` output with its source label. Read-only — never calls the momentum `done` path.
- **Work log:** one entry per session per day: agent excerpt (`lastAssistantText`), counts from `summarizeDelta`, and local commits in the window from existing `git_log`. Range Today / 7 days / 30 days.
- **Plan:** board Now card + per-status counts from the read-only board command. Counts are cards, not a completion %.
- **Agent time:** see §4. Hidden when no lifecycle observations exist.
- **Workspaces:** live, waiting, and closed-but-resumable sessions with agent, branch/worktree if known.
- **Actions ▾:** Start session, Open Idea Board, Split, Fan out, Isolate worktree, Git commit/push, Pin, Archive, Edit purpose. Each reuses the existing dialog/handler — no duplicated mutation logic. Pin/archive change organization only; never kill or hide a running process.

### Copy update

Button on Overview. Opens a modal with an editable `<textarea>` prefilled with deterministic Markdown for the chosen range (default 7 days):

```md
## Harbor website — update (Sep 22–29)
**Progress**
- Booking form added (agent-reported)
- 3 local commits: Add form; Fix date picker; Copy tweaks
**Decisions needed**
- Which booking provider? (current assumption: Stripe)
**Blockers**
- none recorded
**Next**
- Verify the booking confirmation flow
```

No model call. Excerpts truncated to one line. Excludes file paths, command text, and raw transcript bodies. The user reads and edits the exact text before **Copy**; nothing is sent, posted, or written to disk. Empty sections say "none recorded," never imply health.

### Inbox

Keep `AttentionInbox`, archive/backlog controls, and `Cmd/Ctrl+K` unchanged. Changes: add a Home header button for it; replace the `global-mail-*` icon with a non-mail icon; add setting `inbox_badge` (default on) to hide the unread count. Archiving in Inbox hides an occurrence from triage only — Overview still shows the source-open decision.

**One open question for approval:** also relabel "Inbox" → "Activity" in the UI (component name unchanged). Recommended; skip if the name is established with current users.

## 4. Data — no migration

Everything reads existing tables. No new tables; migration 12 stays latest.

| Need | Source |
|---|---|
| Project catalog | Distinct keys from `bookmarks`, live tabs, `session_bindings.project_key`, `decisions.cwd`, `blockers.cwd`, `notes.cwd`, `attention_state_observed.project_key` — one repo query, canonicalized with existing `project_key` |
| Pin / archive / purpose | `settings` with per-project key prefixes (`project_pinned:`, `project_archived:`, `project_purpose:`), matching the `mute_notifications:` / `board_collapsed:` pattern |
| Start surface, badge | `settings`: `home_start_surface`, `inbox_badge`, typed accessors |
| Decisions / blockers | Existing tables; open vs answered vs dismissed stay distinct |
| Working / waiting | `listAttentionEvidence` for the current run + live tab state |
| Next step | `latestLandingNote` + `computeMomentum` |
| Work log | Sessions via `session_bindings.project_key` → events by `session_id` in range → `summarizeDelta` / `lastAssistantText` (pure, same as the since-you-left digest) |
| Commits | Existing `git_log` command; label "Committed locally" (not pushed/merged/attributed) |
| Plan counts | New read-only board command (below) + `parseBoard` |
| Agent time | `attention_state_observed` events |

**Agent time:** per session, each `working` observation opens an interval closed by the next observation for that session in the same `run_id`. An interval still open at run end is dropped, not extended (a crash must not bill hours). Sum per project; show "since <first observation date>" and session count. Pure function `observedAgentTime` in `src/lib/dashboard.ts`. Sessions from adapters without lifecycle hooks contribute nothing and the label says "observed," not total.

**Read-only board command:** `read_board` (`src-tauri/src/board.rs:45`) seeds an example board when missing — unusable for passive reads. Add `peek_board(project_key) -> { state: "ready", content } | { state: "missing" } | { state: "error", message }` that never writes. Existing editor path unchanged. If content equals the built-in example exactly, show "Example board" with no counts.

**Performance:** query only visible projects' details; cache board/git results in memory per project, refreshed on Home focus or explicit refresh (≥30s apart). Add an index (migration 13) only if a real profile measures slow — not pre-emptively.

Rendered content (excerpts, decision text, commit subjects, purpose) is untrusted plain text: no HTML/Markdown rendering, never treated as instructions.

## 5. Implementation steps

Files: new `src/lib/dashboard.ts` (pure shaping/grouping/agent-time/update-markdown), new `src/components/HomeDashboard.tsx`, `ProjectCard.tsx`, `ProjectOverview.tsx`, `CopyUpdateModal.tsx`; edits to `src/App.tsx`, `src/components/TabBar.tsx`, `SidePanel.tsx` (icon/badge only), `AttentionInbox.tsx` (label only, if approved), `FeatureTour.tsx`, `src/lib/repo.ts`, `src/types.ts`, `src-tauri/src/board.rs`, `src-tauri/src/lib.rs` (command registration); new `scripts/dashboard-check.ts`; `package.json`; docs.

1. **Surface + visibility.** Add `type AppSurface = { kind: "workspace" } | { kind: "home" } | { kind: "project"; projectKey: string }`. Effective terminal visibility is empty outside `workspace`; `activeId`/`splitPaneIds` stay intact for restore. Audit every use of `activeId`, `viewedId`, `visibleTabIdsRef`, focus claims, and `shouldNotify` — a hidden `activeId` fallback must not mark a background result viewed. Entering Home records `tab_left` once per visible bound pane; returning claims only actually visible panes while focused, including returning to the same `activeId` (no tab-change effect fires today). No PTY remount/respawn.
   **Verify:** `dashboard:check` visibility fixtures; existing `split-view:check`, `unclaimed:check`, `notify:check`, `reentry:check` pass.
2. **Board peek.** Add `peek_board`.
   **Verify:** `cargo test --lib board` — missing board leaves the filesystem unchanged; error ≠ missing ≠ empty.
3. **Repo reads.** `listProjectCatalog`, `getProjectOverview(projectKey, range)`, project settings accessors. No inline SQL in components.
   **Verify:** `dashboard:check` covers same-name folders, subdir→root key, archived project with live session (still shown as Working, labeled Archived), older-projects cutoff.
4. **Pure shaping.** Work-log grouping, `observedAgentTime`, card/overview view models, `buildUpdateMarkdown`.
   **Verify:** `dashboard:check` — open interval at run end dropped; parallel sessions summed; empty sections render "none recorded"; update excludes paths/commands.
5. **UI.** Home, cards, Overview, Copy update modal, chooser. Dashboard-local error boundary with working **Return to workspace**. Keyboard reachable, visible focus, no nested interactive controls in cards, Escape closes topmost overlay only, dashboard shortcuts intercepted before xterm.
   **Verify:** `npx tsc --noEmit`, `npm run build`; manual §7.
6. **Inbox + tour.** Header button, icon swap, `inbox_badge`, optional relabel. Tour step 1 becomes Home → a project → its workspace; don't re-show tour/onboarding to users who completed it.
   **Verify:** `onboarding:check`, `attention-inbox:check` pass; manual §7.
7. **Docs.** `docs/TESTING.md` new section; `docs/PROGRESS.md`; README screenshot/feature line.

Register `dashboard:check` in `npm run check`. No new dependencies.

## 6. Current-state anchors (at `9f7c7f8`)

| Location | Fact |
|---|---|
| `src/App.tsx:108` | `visibleTabIds` derives only from `activeId`/`splitPaneIds` — Home must participate or it silently claims results |
| `src/App.tsx:145`, `:1337`, `:1684` | `attentionOpen` state, `Cmd/Ctrl+K` toggle, Inbox render |
| `src/components/SidePanel.tsx` (`onOpenAttention`) | Inbox button uses `global-mail-read/unread` icon |
| `src/lib/attention.ts:37` | `resolveAttentionRoute` — reuse; never route to first same-cwd tab |
| `src/lib/repo.ts:391` | `listAttentionEvidence` — open decisions/blockers/results + run observations |
| `src/lib/repo.ts:931` | Per-project settings-prefix pattern (`mute_notifications:`) |
| `src/lib/repo.ts:1047`, `:1085` | `latestLandingNote`; `eventsSince` is tether-scoped, not project-wide |
| `src/lib/delta.ts` | `summarizeDelta`, `lastAssistantText` — pure, deterministic |
| `src/lib/momentum.ts:28` | `computeMomentum` — the only next-step recommender |
| `src/lib/board.ts:141`, `src-tauri/src/board.rs:45` | `readBoard` swallows errors to `""`; `read_board` seeds example on missing |
| `src-tauri/src/pty.rs:168`, `:601` | `project_key` canonicalization; `git_log` (abbrev hashes, failure → empty) |
| `src-tauri/src/lib.rs:117`, `:189` | `session_bindings.project_key`; migration 12 latest |

## 7. Manual checks (add to `docs/TESTING.md`)

1. Fresh profile starts on Home, can add a folder and start a session; existing profile keeps its startup surface.
2. Agent running → open Home → let it finish → blur/focus app: result stays unclaimed until its workspace is shown; process and output intact; no PTY input.
3. Return to a split workspace and a single one (including same active tab): focus and xterm sizing recover, no respawn.
4. Five projects / several tabs incl. fan-out and a worktree: card counts match source rows; close last tab, project and history remain.
5. Decision on Overview → close its tab → click: unavailable/chooser, never the wrong session. Archive it in Inbox: still shown on Overview.
6. Missing board: Home creates nothing. Unreadable board: error state, not zero. Untouched example board: "Example board," no counts.
7. Copy update on a real project: every line traceable to a decision, excerpt, commit, or note; no paths/commands; clipboard only.
8. Keyboard-only pass, VoiceOver, 200% zoom, reduced motion; `Cmd/Ctrl+K` and badge toggle work; no duplicate tour/onboarding.

Dogfood afterwards with the maintainer, the current active user, and the feedback-session participant once installed; record observed confusion in `docs/TESTING.md`. Not a phase gate.

## 8. Done

- [ ] No browse action spawns, kills, writes to, claims, or remounts a terminal; no board file created by viewing.
- [ ] No fabricated health, completion %, spend, or empty-on-error display.
- [ ] Inbox, board editor, split view, session routing, and startup preference pass existing checks and §7.
- [x] Gates exit 0: `npm run check`, `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings`, `git diff --check`. No `npm run golden` (no extraction-prompt changes). Verified after every commit, 2026-09-30.
- [ ] §7 results recorded with versions; unrun items disclosed.
- [ ] Maintainer writes the phase acceptance token.

## 10. Implementation notes after build (2026-09-30)

Built across 8 commits on `phase-47-feature-tour`, all 7 §5 steps landed.
Deviations and simplifications versus this document, for the live pass to
weigh in on:

- **§3 card actions.** Each card has one action ("Open" → Project Overview),
  not separate Open/Continue buttons — Overview's single Continue/Start
  session button covers routing to the workspace, so the ambiguous-tabs
  chooser this doc calls for was never needed yet. If dogfooding wants a
  faster path than Home → Overview → Continue, add the second button and
  chooser then, not speculatively now.
- **§3 Inbox relabel.** Left as "Inbox" — this doc marks the "Activity"
  rename as needing explicit approval, not decided here.
- **Home start surface (original build gap, repaired in the fix-it sprint).**
  The original build had accessors without UI wiring. The authorized follow-up
  reads/persists a fresh-vs-existing default and exposes Start in on Home.
- **§1's "Pick up here" / "Needs a choice" real-data note:** confirmed live
  against this repo's own open decisions and blockers while building, not
  yet against the feedback-session participant's project.
- A genuine bug found and fixed while wiring Step 5a, not called out in §5's
  text: the tab-switch effect's trailing `claimTab(activeId)` fires on any
  `activeId` change, including one caused by closing the active tab while
  Home is open — would have wrongly claimed a tab nobody was looking at.
  Gated on the workspace surface.

See `docs/TESTING.md` §70 for the manual checklist (not yet run) and
`docs/PROGRESS.md`'s Phase 48 entry for the full per-step commit summary.

## 9. Out of scope

Tokens/spend, human time tracking, RAID context, templates, alternate board views, GitHub PR/CI, team/sync features, LLM-written summaries — see `docs/ROADMAP.md` → "Project dashboard follow-ons". No dependency additions, PTY protocol changes, or autonomous terminal input.


## 11. Approved Phase 48 fix-it revision (2026-09-30)

The maintainer authorized `plans/048-dashboard-fixit-sprint.md`, then selected
its recommended scope dispositions. Per-card Continue and the full Actions
menu are explicitly deferred; Overview now provides a chooser for multiple
live/closed workspaces. The existing Inbox name stays unchanged. Startup is
implemented: fresh profiles default to Home, existing profiles default to
workspace, and the Home selector persists an explicit choice. Setup renders
via a portal so its dialog remains visible while Home hides the workspace.

The Overview fix replaces 277 per-session JSON/tether scans on the real
profile with one session-owned query; reads settle independently with a 10s
wait limit, Retry, coalescing and 30s board/Git caches. Work log groups by
session/local day; Today uses local midnight. Decisions are no longer capped
at 50. A dashboard-only native Git API returns errors and the complete date
window, preserving `git_log` for existing callers. Copy update does not wait
on board/catalog/agent-time; its Next comes from the successfully read landing
note, decisions or blockers (board-derived Next remains on Overview). Unsafe
first-line paths/command syntax in drafts is omitted and labeled explicitly.

Automated and release evidence is recorded in `docs/TESTING.md` §71.
Phase 48 remains NOT ACCEPTED; no Phase 49 implementation, commit, push or PR
is authorized by this revision. Historical §10 simplifications are superseded
where described above, rather than counted as implicit deferral approval.
