# Plan 027: Prove a DeepSeek Harness terminal adapter is viable

> **Status: CANDIDATE. Planning only.** This is a bounded companion research
> sprint to Plan 026, not authorization to add `dsh` to the adapter menu.
> Implementation beyond read-only probes waits for the literal approval of
> the assigned phase. Before starting, compare changed files with commit
> `4d91d5e`; preserve unrelated worktree changes.

## Status

- **Priority:** P1 research for a possible sixth adapter
- **Effort:** S-M, roughly 1-2 days for contract proof and a decision record
- **Risk:** HIGH for a direct build: no shipped first-party terminal UI,
  developer-preview API, and no local `dsh` executable found at planning time
- **Depends on:** phase approval for any local install/profile/config write;
  Plan 026 is conceptually related but not a code dependency
- **Planned at:** `4d91d5e`, 2026-09-17

## Decision to make

Logic Loop's menu launches interactive agents inside PTYs. The current
[DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness)
documents `dsh web` as the default user-facing run command and explicitly
calls the project a rapidly changing developer preview. The current
[CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)
lists shipped profiles `web`, `headless`, `sdk`, `sdk-minimal`, and `acp`;
its `tui` example says it assumes a TUI profile is already installed.
DeepSeek's [implemented removal note](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/simplification/2026-08-04-remove-tui-package.md)
states that the first-party TUI package was deleted. Therefore detecting
`dsh` alone cannot truthfully enable a Logic Loop terminal adapter.

The goal is to decide, with a live proof, whether one public, supportable
terminal profile can be an explicit prerequisite and whether a passive
observer plugin can report activity without changing the agent's behavior.
If either fails, keep DeepSeek Harness as a tracked candidate and do not add
a misleading menu row. Do not embed its Web UI in a terminal or scrape
terminal bytes, Web pages, or persisted logs to imply live state.

## Existing Logic Loop contract

- `src/lib/onboarding.ts` and `src/components/AgentStatusBar.tsx` enumerate
  the four current adapters; Plan 026 would make Pi fifth. The menu expects
  an executable launch command, detectable configuration, and honest
  Activity/Decisions/Re-entry capabilities.
- `src-tauri/src/pty.rs::pty_spawn` hosts an actual PTY and sets
  `LOGIC_LOOP_TAB_ID`; hooks return `X-Logic-Loop-Tab` to the localhost
  ingest server. `src-tauri/src/ingest.rs` recognizes adapter markers.
- `src/App.tsx` persists only tethered `SessionStart` for re-entry.
  `src/lib/ingest.ts::stateForHook` consumes normalized
  `UserPromptSubmit`, `PostToolUse`, and `Stop`. No new DB table is needed
  for ordinary structured activity.
- Keep the hard invariants in `AGENTS.md`: fail open, no PTY parsing, no
  autonomous input, no inline component SQL, no inference from agent text.

## Upstream evidence and open questions

DeepSeek's [extension cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md)
shows passive `ctx.on('session/event', (session, event) => ...)` listeners.
Its [session contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)
defines committed `user/message`, `turn/start`, `turn/end`, `tool/call`, and
`tool/result` events. `tool/call` has a `callId` and raw JSON arguments;
`tool/result` carries an error flag in its result block. `session/event`
is post-commit and observer failures are contained. These are promising
for an observation-only adapter. They do not by themselves prove a stable
TUI install, session-to-tab tether propagation, final idle semantics, or
resume UX. Avoid the `dsh-hooks-codex` compatibility bridge: it executes
configured command hooks that can gate prompts/tools and alter control flow,
which exceeds Logic Loop's passive observer role.

## Read-only work, then a separately approved live probe

1. Record the exact DeepSeek Harness release/commit, Node and `dsh`
   availability, supported shipped profiles, and a public TUI bundle's
   license, maintenance, install path, CLI command, and re-entry behavior.
   Review the bundle's source and pinned dependencies before proposing it.
   Compare at least two viable routes: a user-managed TUI profile versus a
   Logic Loop-specific terminal host. Prefer the user-managed profile if it
   meets the gates; a new host is a separate product feature, not a hidden
   detail of this adapter. **Verify:** cite primary source URLs and versions
   in the decision record; do not equate a `tui` example with a shipped TUI.
2. With explicit phase authorization for any required install or profile
   write, use a disposable `DSH_HOME` under `/tmp`. Create/inspect a TUI
   profile, launch it in a PTY, complete two interactive turns and a tool
   call, quit and resume by an exact session ID, then prove earlier context
   remains visible and usable. Test two sessions in the same cwd. Capture
   redacted evidence and every prerequisite command. **Verify:** the TUI
   starts without a browser, stays interactive in a Logic Loop-sized PTY,
   and resumes the correct session. If no public, reviewable terminal
   bundle meets this bar, stop before planning a menu entry.
3. Prototype a **local, disposable** observer plugin against that profile,
   using only committed `session/event` and a documented session lifecycle
   signal. Determine exact session ID and cwd access, delivery after
   reload/resume, prompt source semantics, tool argument/result matching,
   and a whole-agent idle signal that does not mislabel a queued continuation
   as `Stop`. Send only bounded, allowlisted metadata to a local test
   receiver; do not install it in the user's real profile or send it to the
   Logic Loop app. **Verify:** one session start, each human prompt, one
   unique tool completion/error, and one true idle boundary can be observed
   without blocking or modifying the harness. Record payload fixtures with
   all user text and credentials removed.
4. Produce a short decision record under this plan: chosen TUI profile,
   exact supported versions, installation ownership, observer event map,
   session-ID/resume command, capability labels, remaining limitations,
   and recommendation **BUILD** or **DEFER**. If BUILD, draft a separate
   phase plan for the native observation plugin, opt-in setup/disable,
   `dsh` detection of both CLI and TUI profile, ingest allowlist, normalizer,
   re-entry, focused checks, and a clean-profile manual matrix. Its code
   must be scoped separately from Pi's Plan 026.

## Scope, verification, and stop conditions

In scope for this plan: research, disposable live fixtures, and this
decision record. Do not edit Logic Loop source, `package.json`, global
`~/.dsh` profiles, or user credentials. Do not install a community TUI or
publish a plugin without the phase's explicit authorization. A Pi adapter
and a DeepSeek Harness adapter may share the normalized ingest contract,
but must have separate install/remove ownership and independent tests.

Read-only verification: `command -v dsh`, `dsh --help` if present,
`dsh --profile web --dump-default-config` only with a disposable
`DSH_HOME`, plus source/document inspection. After any plan-file edit,
run `git diff --check`. No `npm run golden` is relevant. A later BUILD plan
must require `npm run check`, `npx tsc --noEmit`, `npm run build`, Rust
tests/clippy, and `docs/TESTING.md` live evidence.

**Stop and recommend DEFER** if terminal use requires an unreviewable or
unmaintained third-party bundle, observer registration alters agent
behavior, exact session identity/cwd cannot be obtained, re-entry cannot
be proved, or a true idle boundary cannot be distinguished from an
intermediate turn. Report those facts; do not fall back to scraping PTY or
Web output. Reassess when DeepSeek ships a supported terminal profile or
the chosen external profile has a stable documented contract.

## 2026-09-17 read-only pass (Step 1 only, no install)

Local check: `command -v dsh` — not found, no trace via `npm ls -g` or
`brew list`. Corrected same day: `npx @deepseek-ai/dsh web` runs fine
(pulls `@deepseek-ai/dsh@0.1.5-rc.2`, no global install), confirming `dsh`
itself is real and reachable — just not on PATH without `npx`. This is the
**Web** profile (opens a browser tab on `127.0.0.1:3080`), which this plan
already rules out as a terminal-adapter target: it's a browser UI, not a
PTY, and the plan's own scope note forbids embedding Web UI in a terminal
or treating it as adapter evidence. Still zero evidence of a `tui` profile
— that remains the actual gate, unmoved by this.

Upstream check against `deepseek-ai/deepseek-harness`, latest commit
`ddefc45` (today, `release(dsh): 0.1.6-alpha.2`), MIT, not archived:

- `apps/cli/README.md` confirms shipped profiles remain exactly `web`,
  `headless`, `sdk`, `sdk-minimal`, `acp`. Its `tui` line is still
  explicitly an example ("assuming the tui profile is installed"), not a
  shipped one.
- The TUI removal note only moved directories
  (`.agents/notes/implemented/simplification/2026-08-04-remove-tui-package.md`
  → `.agents/notes/archived/simplification/...`, same filename/content) —
  the deletion itself is unreversed. A search of `.agents/notes/**/*tui*`
  turns up only pre-removal (2026-07-20 through 2026-08-04) feature notes,
  all now archived. No reintroduction note exists.
- `packages/terminal/` exists but is the agent's own model-facing PTY tool
  family (`ctx.terminals`, letting the agent itself run interactive
  bash/pwsh) — not a human-facing terminal UI. Doesn't change the TUI
  finding.
- `docs/subsystems/session.md`'s event vocabulary
  (`turn/start`/`turn/end`/`tool/call`/`tool/result`/`user/message`) and
  `docs/cookbook/extension-cookbook.md`'s passive `session/event` listener
  pattern still match this plan's citations exactly — the observer-plugin
  premise in step 3 is still sound whenever a terminal profile exists to
  attach it to.

**Net: no change from planning-time.** Step 2's live probe has nothing to
target — still no shipped or community TUI bundle identified, still no
local `dsh`. Recommendation stands at candidate-only; do not schedule Step
2/3 until either DeepSeek ships a terminal profile, or a specific
third-party TUI bundle is named and passes the license/maintenance review
step 1 already calls for.

Live-confirmed same day: `npx --yes @deepseek-ai/dsh --profile tui`, run
with a disposable `DSH_HOME` under `/tmp` (never touched the real
`~/.dsh`), fails exactly as the CLI README implies:

```
Error: dsh: profile "tui" does not exist; create it with 'dsh plugin --profile tui add <package>'
```

Matches the doc-only finding above exactly — no shipped `tui` profile,
and booting one requires the operator to already know and name a specific
`<package>`, which is the third-party-bundle review this plan's Step 1
still hasn't been given a candidate for. `dsh web` (same npx path, no
global install, pulled `@deepseek-ai/dsh@0.1.5-rc.2`) does boot fine and
opens a browser tab — real evidence `dsh` itself works locally now, but
Web is explicitly out of scope for a terminal adapter per this plan's own
scope note (browser UI, not a PTY). Gate for Step 2 remains unmet.

## 2026-09-17 third-party bundle review (Step 1 candidate review)

Four community `<package>` candidates were named for the `dsh plugin
--profile tui add <package>` gate above. Reviewed via the GitHub API
(metadata, contributor/commit shape, file listing, package manifests,
install scripts) — no code execution, no local install:

- **`gxinxing/deepseek-harness-tui`** (11★/1 fork, 1 contributor matching
  16 commits, MIT, `private: true` so not npm-published). Clean, narrow
  scope: Ink+React TUI, standard lint/test/husky tooling, no install
  script or postinstall hook, peer deps scoped correctly to `@deepseek-ai/*`.
  Established 10-year GitHub account. Lowest-risk of the four, but still a
  single unaudited maintainer with no independent review.
- **`rayafriandion/dsh-oc-tui`** (7★/1 fork, 2 contributors, 30 commits,
  actively maintained). `install.sh` runs a visible `curl | bash` that
  shells out to `dsh plugin --profile tui add -w <source>` — transparent,
  no hidden fetch. Real defect: repo license shows NOASSERTION while
  `package.json` claims LGPL-3.0 — a documentation inconsistency, not a
  code red flag.
- **`papachong/deepseek-harness-tui`** (3★/0 forks, **29 contributors**
  against only 30 commits shown). `package.json` name is literally
  `@deepseek-ai/dsh-root` — this is the entire upstream DeepSeek Harness
  monorepo copied wholesale (native/, python/, vendor/, website,
  BRAND_GUIDELINES, etc.), not an independent TUI; the contributor count
  is inherited from that copy, not this repo's own work. Its actual TUI
  commits, from one author, publish to npm as **`@ruhooai/dsh-tui`** — an
  unrelated scope — while the README claims to be "updated in sync with
  the official product." Provenance claim doesn't match what's shipped.
  **Recommend against use**: unauditable footprint, misleading sync claim.
- **`cocode-agency/cocode`** (162★/36 forks, 6 contributors, org 2 months
  old). Most professionally documented of the four (real `SECURITY.md`
  scoping sandbox/approval-gate bypass, credential exposure, Electron
  hardening). But it's a full product, not a thin profile: a hosted
  "Cocode Pro / Nut credits" account system (`~/.cocode/account.yaml`), a
  GUI shipped as an **Electron binary installer from GitHub Releases**
  (not reviewed the same way as source), and a separate
  `host-supervisor` daemon auto-installed alongside the TUI package.
  Larger trust relationship and surface than this plan's scope calls for.

None of the four cleanly clears this plan's own bar ("a public,
supportable terminal profile," reviewed source and pinned dependencies,
scoped narrowly to a terminal adapter). Two are viable-but-unaudited
single/dual-maintainer hobby projects; one misrepresents its own
provenance; one bundles a hosted service and binary installer well beyond
"a terminal profile."

## Decision record

- **Chosen profile:** none of the four external candidates. Recommend a
  **first-party** profile instead — a small Ink (or plain readline) chat
  loop bundled as a `dsh` plugin app, targeting the shipped `headless` or
  `sdk-minimal` profile rather than a community `tui` package. This
  mirrors how every other Logic Loop adapter (Codex, Antigravity,
  OpenCode, Pi) is a thin first-party wrapper against a documented
  protocol, never an adopted third-party UI.
- **Exact supported versions:** not yet pinned — Step 0 of the follow-up
  build plan must confirm which of `headless`/`sdk-minimal` exposes a
  stdin/stdout-drivable session loop suitable for a custom frontend, on
  the current `@deepseek-ai/dsh@0.1.6-alpha.2` line.
- **Installation ownership:** entirely ours — no external package
  dependency, no npm scope but our own, source fully reviewable in this
  repo.
- **Observer event map:** unchanged from the upstream evidence above —
  `session/event` with `turn/start`/`turn/end`/`tool/call`/`tool/result`/
  `user/message`, still to be verified live against whichever profile is
  chosen.
- **Session-ID/resume command:** not yet proven — first-party build must
  still pass this plan's original Step 2 live-continuity gate.
- **Capability labels:** deferred to the build phase plan.
- **Remaining limitations:** no shipped first-party TUI exists upstream;
  building our own means Logic Loop, not DeepSeek, owns the UI
  maintenance burden going forward. Acceptable trade for the supply-chain
  posture above.
- **Recommendation: BUILD** (first-party, not adoption of any of the four
  reviewed bundles). See `plans/028-deepseek-inhouse-tui-adapter.md` for
  the scoped build plan. That plan's own Step 0 (live `dsh` profile/plugin
  API verification with a disposable `DSH_HOME`) still requires explicit
  phase authorization before any install or profile write, per this
  plan's own stop conditions.
