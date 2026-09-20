# Logic Loop: review and next five sprints

Date: 2026-09-19. Baseline: `a87bafdf541cb696f29a9db216b2f4ab29cbb82a`.
Status: advisory, planning only; no implementation or new phase approval implied.

## Recommendation

Spend the next three sprints making the existing product reliable, easy to activate, and downloadable. Use sprints four and five to improve daily interaction and prove faster project re-entry. Pause adapter expansion and new model-powered features during this cycle.

The strongest positioning is: **Keep your own coding agents. Switch projects without losing the thread.** The audience to start with is Apple Silicon developers already running two or more agent sessions. The product already has enough functionality to test this proposition. Distribution friction and uncertain first-use success are more urgent than feature breadth.

These are proposed build sprints, not guaranteed single-evening tasks. A sprint is roughly 1–3 focused build days plus its live acceptance checks; the PTY work or signing prerequisites can take longer. If only three sessions are available, take the minimum slices in 032–034 and defer 035–036 explicitly. Never compress by silently skipping acceptance.

## Verified GitHub and local state

- Local HEAD equals GitHub main at `a87bafd`; working tree was clean before this review.
- Latest [main CI](https://github.com/SuperLogicAI/Logic-Loop/actions/runs/35455525687) passed. The five latest returned CI runs were successful.
- GitHub API returned **zero releases**, 23 stars, 3 forks, and one open issue on the review date. Stars are awareness, not active-user or retention evidence. [Repository](https://github.com/SuperLogicAI/Logic-Loop), [releases](https://github.com/SuperLogicAI/Logic-Loop/releases).
- Recent merged work includes [agent tab identity #42](https://github.com/SuperLogicAI/Logic-Loop/pull/42), [Safe Router #41](https://github.com/SuperLogicAI/Logic-Loop/pull/41), [Pi #39](https://github.com/SuperLogicAI/Logic-Loop/pull/39), and usage meters. Do not schedule them again from stale roadmap labels.
- [PR #40](https://github.com/SuperLogicAI/Logic-Loop/pull/40), titled “restore deepseek adapter deleted by a parallel session,” is a concrete integration warning. It supports tighter branch scope/reconciliation, not an inference that main is currently missing DeepSeek.
- [Issue #9](https://github.com/SuperLogicAI/Logic-Loop/issues/9) requests foreign Antigravity hook warnings. Detection and a warning event already exist at `src-tauri/src/antigravity.rs:171–189`, with tests at 478 onward. Reconcile remaining live acceptance before closing; do not blindly implement the issue again.

## The good

**A coherent product with a real differentiator.** Attention Inbox, landing notes, re-entry, Since-you-left, and the Idea Board's Now cards all serve interruption recovery. Those are stronger reasons to adopt than “six agents in tabs.” Existing implementation includes `src/components/AttentionInbox.tsx`, `src/components/SidePanel.tsx:401–427`, and ghost-session restoration in `src/App.tsx:794–823`.

**The architectural boundaries are worth preserving.** Raw PTY bytes remain raw (`src-tauri/src/pty.rs:285–299`); loopback ingestion has token authentication (`src-tauri/src/ingest.rs:34–96`); extractor subprocesses carry a self-ingestion exclusion tether. Claude extraction strips unnecessary tools/config/context (`src-tauri/src/extractor.rs:62–88`). This avoids several expensive classes of agent-shell failure.

**More verification than a typical early desktop project.** Strict TypeScript, extensive deterministic check scripts, and macOS/Windows Rust tests and clippy are already in CI. Setup honestly distinguishes detection, enabled hooks, and observed events. Adapter capability differences are explicit in `src/lib/onboarding.ts:43–99`.

**Useful work has already shipped.** Split views, compact rail, account meters, session identity, bookmarks, and scoped decisions mean the next cycle can improve a working workflow rather than construct one from scratch.

## The bad and the ugly: vetted findings

Effort: S = hours, M = roughly a day, L = multiple days including verification. Confidence describes the evidence, not measured prevalence. Risk is the risk of changing the code.

| Priority / ID | Finding and evidence | User impact | Effort / fix risk / confidence | Proposed action |
|---|---|---|---|---|
| P1 R1 | No published release; README:182–207 requires Mac source build or Windows Actions artifacts; `.github/workflows/windows-build.yml` only builds unsigned Windows artifacts | Interested users face toolchains or maintainer-oriented downloads before seeing value | L / medium / high fact, medium adoption hypothesis | Versioned Apple Silicon beta artifact and tested install path, sprint 3 |
| P1 R2 | `src-tauri/src/ingest.rs:293–305` advances offset for a non-newline fragment; pathname metadata at 271 is mixed with the old open descriptor at 284 | A split JSONL write loses a record; replacement can strand the reader on an old file | M / medium / high; occurrence unmeasured | Incremental record reader, replacement/truncation tests, sprint 1 |
| P1 R3 | `src-tauri/src/pty.rs:316–319` synchronously locks and writes terminal input | A backpressured terminal can block the app event thread; large pastes are a plausible trigger | M–L / high / high code-path confidence; reproduce live | Ordered off-thread input with close semantics, bounded investigation in sprint 1 |
| P1 R4 | `src-tauri/src/extractor.rs:215–220` has no HTTP deadline; `src/lib/extractorQueue.ts:10–16` waits for prior completion | A stalled local model blocks later queued decisions and landing summaries | S / low / high | Total request/body deadline and queue-recovery test, sprint 1 |
| P1 R5 | `FanOutModal.tsx:61–66` lacks keyboard containment; `App.tsx:1243–1293` routes global close/create/switch commands | Typing shortcuts inside a modal can act on underlying terminals | M / medium / high static evidence | Narrow modal interaction tests and command containment, sprint 4; pull forward before wider beta if reproduced |
| P2 R6 | `BookmarksBar.tsx:26–35` closes immediately; `App.tsx:1438–1445` discards mutation promises | Failed saves lose the visible draft and appear successful | S–M / low / high | Await persistence, retain errors/drafts, sprint 2 |
| P2 R7 | `TabBar.tsx:129–149` uses pointer-only divs without tab semantics; bookmark colors lack names | Keyboard/screen-reader navigation is weaker than the pointer workflow | M / medium / high | Roving tabs, selected state, labeled controls, sprint 4 |
| P2 R8 | CI frontend runs tsc and checks but no production build (`.github/workflows/ci.yml:25–29`); Rust uses placeholder dist at 49–56 | Green merge gates do not prove the packaged frontend exists and loads | S / low / high | Add production build gate; test actual release artifact, sprint 3 |
| P2 R9 | `scripts/onboarding-check.ts:62–82` checks source strings for UI wiring/attributes | Checks cannot demonstrate focus trapping or async save feedback | M / low–medium / high | Small rendered interaction harness in sprint 2, extend in sprint 4 |
| P2 R10 | `docs/ROADMAP.md:14–46` and `plans/README.md` retain historical branch statuses; README:184 / CONTRIBUTING require Node 18+, installed Vite requires `^20.19.0 || >=22.12.0` | Builders and future agents act on contradictory instructions | S / low / high | Reconcile current status and accurate prerequisites, sprint 3 |

The ugly part is the mismatch between sophisticated features and fragile boundaries: missing transcript records are silent, a hung local model can stop useful panels, and a green CI badge does not prove a fresh user can open the packaged application. These are bounded engineering problems; there is no evidence here that the product needs a rewrite.

## Direction options, separately from defects

1. **Complete first value, not another setup screen.** Extend existing Setup into choose project → enable one installed adapter → explicit launch → first structured event → switch away and find its result. Plan 021 already describes contextual folder access; sprint 2 refreshes and extends it instead of resurrecting its obsolete Phase 33 instructions. `OnboardingModal.tsx:127–141` currently leaves the launch workflow to manual instructions. Cost: M–L; benefit is a hypothesis to measure.
2. **Make re-entry the memorable feature.** IDEAS.md:751–768 already proposes a compact brief using existing delta, landing note and Now card data. Prototype that presentation in sprint 5, with evidence links and no model call on tab switch. Cost: M; risk is duplicating information or mis-scoping sessions, so replace an existing summary surface rather than adding another panel.
3. **Ship and learn with a small Mac cohort.** Recruit 3–5 developers who actually alternate between projects/agents. A notarized Apple Silicon beta with an honest capability table is the practical initial target. Signing/notarization prerequisites must be resolved explicitly; Tauri documents them in its [macOS signing guide](https://v2.tauri.app/distribute/sign/macos/). Prepare builds without changing global credentials or publishing automatically. Cost: L initially, then small repeatable releases.
4. **Make power features discoverable after activation.** Add contextual routes into existing Attention, split view and re-entry; do not replace Attention with a new universal command palette. Defer broad command search until observed navigation failures justify it. Cost: S–M, coupled to sprint 4/5 usability evidence.

## Five-sprint sequence

| Sprint | Draft | Outcome and exit evidence | Dependencies / cut line |
|---|---|---|---|
| 1 | [032 Trust and responsiveness](032-trust-and-responsiveness.md) | Split records retained; stalled HTTP recovers; blocked PTY behavior reproduced and safely corrected or reported as a release blocker | Start here. Minimum: reader + timeout; PTY result must still be explicit |
| 2 | [033 First useful session](033-first-useful-session.md) | A new user chooses a folder, explicitly launches one agent, sees a real event; bookmark failure retains draft | After sprint 1 acceptance; refresh Plan 021 scope |
| 3 | [034 Downloadable beta](034-downloadable-beta.md) | Reproducible artifact, truthful support matrix, production build gate, clean-machine release checklist and demo | After sprint 2; signing credentials can block public release but not pipeline preparation |
| 4 | [035 Keyboard and interaction safety](035-keyboard-and-interaction-safety.md) | Dialog shortcuts cannot close hidden terminals; tabs work by keyboard; real-webview focus/paste checks pass | After sprint 3 acceptance; pull ahead of broader distribution if pilot hits R5 |
| 5 | [036 Re-entry proof](036-reentry-proof.md) | Existing context becomes a compact evidence-backed brief; observed users recover next action faster | After sprint 4; if pilot evidence favors unresolved activation defects, revise scope before building |

For a three-sprint budget, stop after 034 with a small beta, not a claim of broad release readiness. Sprint 1 is three logical fixes: separate commits/PR concerns, one approved sprint scope. If PTY ordering/cancellation exceeds the budget, explicitly revise the phase plan rather than turning it into an unbounded terminal rewrite.

## Adoption plan and measurements

Use a short demo of one real job: two agent sessions, leave one, receive a result, open Attention, recover what changed, explicitly resume. README should offer a download first and source build second. Explain which features call the Sidebar LM and that activity-only adapters do not extract decisions. Keep Windows labeled experimental until its reported add-tab/bookmark failure is reproduced and checked on the actual installer; do not advertise Linux parity from Rust portability.

Before promotion, observe 3–5 target users on fresh profiles. Record locally in a consented study sheet: install completion, time from first launch to first structured event, prompts for assistance, successful away/return, whether they return next day, and what made them leave. Proposed pilot targets (not baseline statistics): 4/5 complete activation without intervention, median first event within five minutes excluding external CLI installation/login, 4/5 identify the next action within 30 seconds on return, and 3/5 use it again the next day. Small samples guide interviews, not statistical uplift claims.

Separate funnel stages: download → app opens → selected project → verified event → useful away/return → return use. Stars and adapter count do not measure this. Do not add hosted telemetry merely to get initial evidence. Prepare release notes/demo/community copy in sprint 3; actual outreach requires the maintainer's instruction, and this review sends nothing.

## Ideas disposition and rejected findings

- **Already present:** split tabs, Attention Inbox, Now cards, compact rail, landing capture, Pi, meters, Safe Router. Improve/reconcile them; do not rebuild from old idea entries.
- **Next:** contextual project access from Plan 021, then compact re-entry brief (IDEAS B).
- **Later, narrow maintenance:** Plan 030's schema-constrained Claude extraction can reduce formatting failures, but does not solve semantic false positives or spending by itself. Reverify upstream CLI support before executing; this review did not validate its external version claims.
- **Park:** more adapters, detached windows, mobile companion, preview browser, richer diff annotation, account hot-swap. They expand the support matrix before first-value evidence exists.
- **Do not schedule yet:** generated `.logic-loop/CONTEXT.md`. The trust loop and per-agent import behavior need a separate spike. Quoting untrusted text reduces formatting escape but does not prove semantic prompt-injection safety; do not market it as enforcement. Never assume Claude `@` imports work identically in AGENTS.md consumers.
- **Do not build:** scheduled autonomous input into live PTYs, ANSI-derived semantic state, new headless orchestration product, wholesale App/SidePanel rewrite.
- **By design, not a defect:** activity-only adapters, opt-in untracked-file staging, and existing append-only history. Large App/SidePanel files are maintenance risks (1,579/1,754 lines), not independently sufficient reasons for a rewrite.
- **Needs a product decision, not a surprise fix:** `SidePanel.tsx:469–505` automatically stages tracked changes and generates commit text. This is existing footer behavior, not a newly discovered injection exploit. Observe whether users understand its repo mutation and model use; don't silently broaden this sprint into a Git workflow redesign.
- **Security follow-up, not a proven exploit:** CSP is null in `src-tauri/tauri.conf.json`. No exploit path was established in this pass. Review desktop capabilities/CSP separately before a broad public launch rather than reporting hypothetical remote code execution.

## Verification and limits

Ran `npx tsc --noEmit` successfully. Ran `npm run check` successfully after the sandbox initially prevented tsx creating its local IPC socket; all 32 aggregate check scripts completed. GitHub main CI success was independently read, including its Rust jobs. No live-model/golden calls, builds, installations, app launches, global configuration writes, or user-data changes were performed.

`npm audit --json` returned 3 high and 1 moderate dependency entries, no critical entries, in build-tool dependencies. These are advisory counts, not three proven runtime vulnerabilities. Reachability/preconditions were not established; review compatible updates in the release sprint. Do not use a blind force upgrade or claim exploitable production paths from severity alone. Rust dependency advisories were not checked.

This was a hotspot-weighted source/product review, not exhaustive security certification or measured performance profiling. No live macOS accessibility pass, clean-install usability study, Windows reproduction, Linux validation, crash/recovery soak, full migration review, adapter upstream-contract audit, or private traffic/retention analytics. Read evidence supports the failure mechanisms above; prevalence and adoption benefit remain to be measured. Existing manual-test entries are historical records, not newly performed checks.

All drafts are in plans/ because this repository already uses it for implementation planning. Existing phase numbers/status history are preserved. New sprint numbers are sequencing labels, not Phase 36–40 assignments. At kickoff confirm accepted prior phase and approve a current PLAN.md; implementation of the next phase still waits for literal `PHASE N ACCEPTED`.
