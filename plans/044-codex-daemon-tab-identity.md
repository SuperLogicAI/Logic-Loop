# Plan 044: Keep Codex session identity attached to its terminal tab

## Gate and status

Accepted by the maintainer with the literal `PHASE 44 ACCEPTED` on 2026-09-26. Planned against `main` at `7473836` and copied to `PLAN.md` before implementation. This phase does not authorize a second default-profile Logic Loop instance, changes to global Codex configuration, or stopping the shared Codex daemon.

## Live finding

Logic Loop's Codex hook registration is present and the app's advertised ingest port belongs to the running app. Codex 0.157.0 hooks are arriving in the app database. Yet a Codex session opened in a fresh Logic Loop tab shows a grey bulb, no agent icon, no session in the sidebar, and no usage meter.

The running CLI process has the fresh tab's `LOGIC_LOOP_TAB_ID`. The long-lived Codex app-server daemon, started in an earlier Logic Loop tab, has that older tab's ID. The new session's hook events carry the **daemon's** ID, not the CLI's. Its `SessionStart` was persisted with a null tab title because `App.tsx` found no live tab for that tether; `session_bindings` nevertheless marked it active. The older binding for the same tether belongs to a different project and is inactive. This is a cross-session environment inheritance failure, not an absent hook or dead ingest server.

The global Attention Inbox's Active list is empty while Backlog is populated because the current events cannot route to a live tab. The sidebar decisions remain visible through project-scoped SQL. The Codex usage meter is gated on `activeTab.agent === "codex"` and `activeTab.sessionId`, both missing when binding fails. Those displays should recover from a correct binding; do not create separate inbox or meter fixes without new evidence.

Official OpenAI [Hooks documentation](https://learn.chatgpt.com/docs/hooks) lists `session_id`, `transcript_path`, and `cwd` as common input fields. It documents the session cwd for command hooks, but no client tab identifier. The live payload confirms that list. Do not assume the hook process inherits the interactive CLI's environment or infer identity from agent text or PTY bytes.

## Goal

Bind Codex events to the exact Logic Loop tab that owns the interactive Codex client, even when the shared daemon executes hooks with an older tab environment. Never bind an outside Codex session or one of two same-project tabs by a guess. Keep Claude, Antigravity, OpenCode, Pi, and DeepSeek behavior intact.

## Required sequence after acceptance

1. **Prove an exact client-to-session signal.** Check the supported Codex app-server protocol and locally observed hook/client behavior for an exact mapping from hook `session_id` to the interactive CLI process or tab. A candidate must distinguish two simultaneous Codex tabs in the same cwd and an outside Codex client. Do not parse PTY output, correlate by cwd alone, scrape transcript prose, or stop the user's shared daemon. **Finding 2026-09-26:** no such signal is exposed for a TUI attached to the shared daemon. Codex's daemon README explicitly says clients inherit the daemon's startup environment and have no per-client environment isolation. The interactive CLI's documented `--no-daemon` flag forces an embedded server even when a shared daemon is running. Plan change: use that flag for Logic Loop's Codex Setup launch and re-entry, preserving a per-process tab tether. Bare `codex` typed in a shell is outside this fix and remains unsupported for exact identity with the shared daemon; show the supported command in Setup. No app-server protocol client mapping, global config edit, or daemon stop is attempted.
2. **Reject false persistence now exposed by stale tethers.** In `src/App.tsx`, only create or refresh a tethered `session_bindings` row when the resolved tab exists, is live, and owns the session. A stale Codex hook still lands in the append-only events table, but must not create a resumable ghost for a tab that is absent or belongs to another session. Preserve Antigravity's live-tab location fallback and other adapters' normal binding paths.
3. **Use per-client Codex execution for app-authored launches.** Setup launches `codex --no-daemon` and re-entry launches `codex --no-daemon resume <id>`. Reject untethered Codex events rather than guessing by cwd. Reject tethered events for dead tabs or tabs owned by another session. The raw Codex hook remains available for diagnostics. Do not relax the shared rule that a tether pointing to a closed tab cannot fall through to cwd matching.
4. **Cover ownership and lifecycle.** Add focused tests for the no-daemon Setup and re-entry commands, two live Codex tabs in one cwd, an untethered outside Codex process, a closed tab, and foreign session activity sharing a tether. Record a live macOS pass in `docs/TESTING.md`: fresh Codex turn goes blue then green with its icon and usage meter; Attention items route to that tab; an outside session remains unbound. Verify Agy after enabling its hook in a newly started Agy process as a separate adapter regression check. Existing shared-daemon sessions cannot be repaired without a Codex client identity signal; record that limit explicitly.

## Scope and checks

Expected files for the narrowed design: `src-tauri/src/pty.rs`, `src/App.tsx`, `src/lib/ingest.ts`, `src/lib/onboarding.ts`, focused `scripts/*-check.ts`, `docs/TESTING.md`, `docs/LANDMINES.md`, and phase status documents. No migration is expected.

Follow-up plan change, 2026-09-26: correct the Codex help text in
`src/components/OnboardingModal.tsx`, which still instructed users to launch
bare `codex` even after Setup switched to `codex --no-daemon`. This is a copy
fix for the approved Setup launch path. A separate Codex new-tab control is
outside this phase's implementation scope.

## Proposed plan change: zsh-only ordinary Codex launch

**Status: approved 2026-09-26; built the same day; live matrix pending in
`docs/TESTING.md` §66.** **Plan change after review (2026-09-26): item 3
(same-tab session takeover) is removed from this phase.** Built and then
reverted before any release: a tethered Codex `SessionStart` taking over a
bound tab could not tell the user's re-run from a stale shared daemon, a
nested `codex exec`, or Codex run by Claude's Codex plugin inside a Claude
tab (which would flip that Claude tab). Every adapter keeps
first-session-wins, exactly as before Codex 0.157, so exit + re-run in the
same tab stays unbound (open a new tab). Replacement needs per-launch
ownership evidence (a launch registry, covering Setup and re-entry) plus a
structured signal separating in-TUI session changes from child sessions;
that is a follow-up plan, not Phase 44. Residual risk still accepted: a
daemon started from a Logic Loop tab by a bypassed launch carries that tab's
ID and can claim it while it is live and unbound. Tab IDs *are* restored
(ghost tabs reuse the persisted `tab_tether`; Re-enter revives it), so an app
relaunch does not by itself expire that risk. The
maintainer confirmed that rebuilt-app Setup → Codex → Start session works and
is tethered. This revision replaces the approved plan's exclusion of bare
`codex` in new Logic Loop shells. It narrows the earlier launcher/registration
proposal to local zsh startup integration and sequential-session rebinding.
The earlier Setup and re-entry `--no-daemon` changes remain in scope.

### Scope in

1. **Integrate only newly spawned zsh shells.** `pty_spawn` writes app-owned
   startup files under `~/.context-terminal/zsh/` and sets `ZDOTDIR` to that
   directory only for its zsh child. The wrapper sources the user's original
   `.zshenv`, `.zprofile`, `.zshrc`, and `.zlogin` in zsh's normal order,
   honoring a `ZDOTDIR` that existed before the PTY spawn. Restore that
   original `ZDOTDIR` (or unset it if originally absent) before the prompt so
   child shells use the user's normal startup files. Preserve aliases, prompt,
   options, PATH, quoting, job control, input, signals, resize, and exit
   status; document any unavoidable collision with an existing `codex` alias
   or function. Do not edit user dotfiles, global PATH, or Codex settings.
   Unsupported shells and already-running shells remain unchanged.
2. **Define ordinary `codex` in the app-owned startup.** The zsh function
   delegates through `command codex` to avoid recursion. It adds
   `--no-daemon` once, checking *each argv element* for an exact existing
   `--no-daemon` rather than comparing the joined `$*` string. The proposed
   `[[ " $* " == " --no-daemon " ]]` expression only matches a single flag
   argument and would duplicate the flag in `codex --no-daemon resume …`.
   Preserve every other argument boundary and return status. Codex CLI
   0.157.0 rejects a duplicate flag; the maintainer verified that a single
   `--no-daemon` parses before `exec`, `login`, `resume`, and `mcp`. Check
   explicit `--remote` behavior and document any incompatible invocation
   instead of silently claiming it is tracked. Setup and re-entry retain
   their already working `--no-daemon` commands.
3. **[Removed — see plan change above]** **Rebind a sequential session in the same live tab.** A tethered
   `SessionStart` for a live tab may replace its displayed `session_id` after
   the previous Codex process exits and the user types `codex` again. Update
   `bindSession`, the App hook handler's cached session-to-tab map,
   `sessionBindingLocation`, and `mergeTabIdentity` (there is no current
   `applyEventToTab` symbol) as needed. Retire the old active binding and
   prevent late events from the prior session from changing the new tab state
   or re-entry owner. Do not make arbitrary non-SessionStart foreign events
   a rebind trigger. Add a focused `bind:check` sequence for start → exit →
   new start → late old event. These helpers currently serve every adapter:
   an unconditional rebind would also change Claude, Antigravity, OpenCode,
   Pi, and DeepSeek. Scope the new rebind rule to Codex events; keep those
   adapters' existing ownership behavior and add regression checks for it.

### Scope out and residual risk

Defer the launch-ID registry, headless launcher, New Codex tab action,
bookmark Open with Codex action, and bash/fish support. No existing shell is
restarted. Absolute-path Codex invocations, non-zsh shells, and pre-upgrade
shells can still reach the shared daemon, so their exact tab identity is
unsupported. **Without a launch-ID registry, a stale shared-daemon hook whose
raw tether happens to match a live unbound tab cannot be distinguished from
that tab's genuine first hook. This revision cannot guarantee that every such
session stays unbound.** Preserve the existing guard against dead or foreign
tab ownership and record this limit plainly; do not claim broader exactness.

### Acceptance and gates

Use one identified Logic Loop app instance and leave the shared daemon
running. In two + tabs in the same directory, type bare `codex` and verify
independent exact bindings, icon, blue working → green idle, and usage meter.
Exit Codex in tab A and type `codex` again; its new session must bind while a
late event from the prior session cannot reclaim it. Open a bookmark tab and
type bare `codex`; verify its binding. An outside-terminal Codex session must
claim no Logic Loop tab. Recheck Setup and Re-enter with no duplicate-flag
error. Confirm the shared daemon PID/start time is unchanged and the user's
zsh aliases and prompt remain intact. Record app/build identity, endpoint
owner, results, and the residual gap in `docs/TESTING.md` §66 without tokens,
prompts, or transcripts. Continue the remaining manual matrix only after the
first + tab passes.

Add focused zsh bootstrap, flag/idempotence, binding, lifecycle, and adapter
regression checks. Run the focused checks first, then the repository's
`opencode:check`, `check`, TypeScript, build, Rust library tests, Clippy, and
`git diff --check` gates. Do not run `npm run golden` unless an extraction
prompt changes. Implementation waits for explicit approval of this plan
change.

Run the focused check first, then `npm run opencode:check`, `npm run check`, `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo test --lib`, `cd src-tauri && cargo clippy --all-targets -- -D warnings`, and `git diff --check`. Do not run `npm run golden` unless an extraction prompt changes, which is outside this plan.
