# Plan 045: Codex launch registry and in-tab session replacement

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> on any condition listed below; do not improvise. When finished, update this
> plan, `plans/README.md`, `docs/TESTING.md`, `docs/LANDMINES.md`, and
> `docs/PROGRESS.md` with the actual evidence.
>
> **Phase gate**: This plan proposes a new phase. Implementation must not
> begin until the maintainer writes the literal token `PHASE 45 ACCEPTED`
> against a clean `main`. PR #63 (Phase 44) is merged as `dcd31cb`.
>
> **Drift check (run first)**:
> `git diff --stat dcd31cb..HEAD -- src-tauri/src/pty.rs src-tauri/src/ingest.rs src-tauri/src/codex.rs src/lib/ingest.ts src/App.tsx src/types.ts scripts/bind-check.ts scripts/tab-identity-check.ts`
> If an in-scope file changed, compare it with Current state below. Stop on an
> incompatible contract and revise this plan before implementation.

## Status

- **Status**: BUILT, awaiting the Step 5 live matrix (`docs/TESTING.md` §67).
  `PHASE 45 ACCEPTED` 2026-09-26. Step 0 done (stop condition 1 hit; scope B
  chosen). Steps 1–4 landed in `0e906d5` and `6e133b9`, with all gates green.
  Decision A: Yes (see Step 3). Implementation note: the registry lives
  beside the PTY map (`PtyManager.launches`, `src-tauri/src/launch.rs`), not
  in ingest state, so PTY death retires launches without a cross-module
  hook. Ingest reaches it through `app.state`.
- **Priority**: P2. The user-visible gap has a workaround (open a new tab).
- **Effort**: M–L. Step 0 spike is ~half a day; the build is 2–3 focused
  days plus the live matrix.
- **Depends on**: PR #63 (merged, `dcd31cb`). Codex CLI ≥ 0.157 with
  `--no-daemon`.

## Problem

Phase 44 restored exact tab identity for Codex launched through Setup,
re-entry, or bare `codex` in a zsh tab. Two gaps remain, both recorded in
Plan 044 and `docs/TESTING.md` §66:

1. **No in-tab session replacement.** A tab keeps its first session forever
   (`bindSession`/`mergeTabIdentity`, first-session-wins for every adapter).
   Exiting Codex and typing `codex` again in the same tab, or `/new` inside
   the TUI, leaves the tab on the old session: stale dot, meter, and
   re-entry target.
2. **Stale daemon can claim an unbound tab.** A shared daemon started from a
   Logic Loop tab by a bypassed launch (absolute path, bash/fish,
   pre-upgrade shell) inherits that tab's `LOGIC_LOOP_TAB_ID`. Any later
   client of that daemon emits hooks carrying it and can bind that tab while
   the tab is live and unbound. Ghost tabs reuse their persisted
   `tab_tether` and Re-enter revives it, so an app relaunch does not clear it.

Phase 44 built and then reverted a hook-only takeover rule: a tethered Codex
`SessionStart` replacing the tab's session. It cannot tell the user's re-run
apart from a stale daemon, a nested `codex exec`, or Codex run by Claude's
Codex plugin inside a Claude tab. The last one flips a Claude tab to Codex,
and it happens on the maintainer's own machine (`codex@openai-codex` is
enabled). Hook fields alone cannot separate two clients that emit the same
fields. This plan adds the missing evidence.

## Goal

A Codex session may bind or replace a tab's session only with proof that
it came from a launch Logic Loop registered for that tab's current PTY.
Within one launch, an in-TUI session change (`/clear`, `/resume`, `/fork`)
may replace the session, but a child session (nested `codex exec`) may
not. `/new` is unsupported: it emits the same `startup` source as a child
(Step 0). All other
adapters keep first-session-wins unchanged.

## Non-negotiables

- Invariants 1–5 hold. No PTY output parsing, no cwd guessing for Codex, no
  input written into a running PTY. Transcript text is never an identity
  signal.
- Hooks stay fail-open. The hook command string does **not** change, so the
  Codex hook trust hashes do not change and users are not re-prompted.
- Launch registration failure never blocks Codex from starting. It only
  makes that launch untracked.
- Do not stop the shared daemon or edit global Codex config. Do not edit
  user dotfiles.

## Current state (at `dcd31cb`)

- `src-tauri/src/pty.rs`: `ZSH_FILES` defines `codex` in app-owned
  `.zshrc` (adds `--no-daemon` once). `resume_command` builds
  `codex --no-daemon resume {sid}; exec {shell} -l`. `pty_spawn` sets
  `LOGIC_LOOP_TAB_ID`, `ZDOTDIR`, and `LOGIC_LOOP_USER_ZDOTDIR`. The
  fan-out/Setup `launch_cmd` is written once at spawn (`pty.rs:428`).
- `src-tauri/src/ingest.rs`: `/event` reads `X-Logic-Loop-Tab` (`:155`),
  drops `EXTRACTOR_TETHER` (`:158`), and inserts `tab_id` into the payload
  (`:217`). The hook command (`:562`) sends `$LOGIC_LOOP_TAB_ID` verbatim.
- `src/lib/ingest.ts`: `bindSession`, `sessionBindingLocation`, and
  `mergeTabIdentity` enforce first-session-wins. `isSubagentHook` detects
  `agent_id`.
- `src/App.tsx`: the hook handler holds a session→tab `bindings` cache and
  persists `session_bindings` on tethered `SessionStart`.
- Observed Codex `SessionStart.source` values in the live DB: `startup`,
  `resume`, `clear`, `compact`. Nothing yet maps these to TUI actions versus
  child processes.

## Step 0 — Spike: establish the facts (no product code)

Run in a scratch Logic Loop profile (`.phase45-test` bundle id, the same
pattern as the earlier `phase31-test` profile) or with a local capture
listener. Never use the default profile's ingest. Record only structural
fields (event name, `source`, session id prefix, `agent_id` presence, tether
prefix, and the process tree) — no prompts or transcripts.

| # | Question | How | Blocks |
|---|---|---|---|
| 0.1 | What `source` does `SessionStart` carry for: first prompt, `/new`, in-TUI `/resume`, compaction, `codex resume <id>` (CLI), `codex exec` run by the agent's shell tool, and Codex run by Claude's Codex plugin? | Drive each case once and read the resulting hook rows | Step 3 rule |
| 0.2 | Does a `codex exec` child inherit the parent's `LOGIC_LOOP_TAB_ID`, and does it use an embedded or shared server? | `ps -E`/`ps -o ppid,command` during the run; hook tether | Step 3 rule |
| 0.3 | Is `SessionStart` emitted lazily (on first prompt) or at TUI start? | Start `codex`, wait, then prompt; compare timestamps | Step 3 "first startup of a launch" |
| 0.4 | With `--no-daemon`, is the hook process a descendant of the Codex client PID? | `ps` ancestry from a scratch hook that logs only `$PPID` chain | Optional PID evidence (see Alternatives) |
| 0.5 | Can a zsh function capture the client's exit reliably (`Ctrl-C`, `kill`, normal exit), so it can retire the launch? | Wrapper test with trap on EXIT/INT | Step 2 retirement |

**Stop conditions:**
- If 0.1 shows `/new` and a nested `codex exec` produce the **same**
  `source`, in-launch replacement is out of scope. Ship Steps 1–2 and 4
  only (launch-scoped binding plus relaunch replacement), and document
  `/new` as unsupported.
- If a child can emit a `SessionStart` *before* the TUI's first
  `SessionStart` in the same launch, the "first startup of a launch wins"
  rule is unsound. Stop and revise.

Record the Step 0 table in this plan before building.

### Step 0 results (2026-09-26, Codex CLI 0.157.0)

**Harness:** a local capture listener on a scratch port. Codex ran with
`HOME` pointed at a scratch dir holding its own `ingest.env`, and
`CODEX_HOME=~/.codex` (real auth and trusted hooks, hook command
unchanged). Tether: `spiketab:<case>`. The capture logged event name,
`source`, session-id tail, `agent_id` presence, and tether only. The
default-profile ingest received nothing. TUI cases used
`codex --no-daemon -s read-only -a never`, driven in a private PTY. The
first `codex exec` also ran under `sandbox-exec` with both daemon sockets
denied.

| # | Finding |
|---|---|
| 0.1 | `source` values: first prompt → `startup`; **`/new` → `startup`** (new id); `/clear` → `clear` (new id); in-TUI `/resume` → `resume` (the picked id); `/fork` → `fork` (new id); `/compact` → `compact` (same id). **A `codex exec` child → `startup`** (new id). The schema enum is `startup \| resume \| clear \| compact \| fork`. Old threads stay open after `/new`/`/clear`: their `SessionEnd` fires at TUI exit, or when a `/resume` picks away from them. The Claude-plugin case was not run: the launch ID is never exported into the shell, so the plugin's Codex always carries a plain tether (`launch: "none"`), whatever `source` it sends. |
| 0.2 | Shell-tool children **inherit `LOGIC_LOOP_TAB_ID` verbatim**. The agent's `printenv` showed the launch-suffixed value, so a nested `codex exec` carries the parent's launch ID. `codex exec` has no `--no-daemon` flag and never touched the daemon socket (no sandbox denials): it runs embedded, and its hooks run in its own env. Stripping the variable from children via `-c shell_environment_policy.exclude=[…]` or `-c shell.environment_policy.exclude=[…]` had **no effect** in 0.157. Hooks kept the tether either way. |
| 0.3 | `SessionStart` is **lazy**. Nothing fires at TUI start (no event in 8–10 s idle). It fires about 20 ms before the first `UserPromptSubmit`. `/new` likewise emits nothing until the next prompt. |
| 0.4 | Not run. It needs a hook-command change (trust re-prompt); see the decision below. |
| 0.5 | Pass. A zsh `{ command … } always { … }` block runs cleanup on normal exit (status 0), SIGTERM (143), and SIGINT (130), with the status preserved. The Codex TUI's raw mode means `^C` is normally a byte, not a signal. |

**Stop conditions:**
- **Condition 1 triggered.** `/new` and a nested `codex exec` both send
  `startup`, and 0.2 shows the child carries the same launch ID. No hook
  field separates them.
- **Condition 2 did not trigger.** A child needs an agent turn, and a turn
  needs a prompt, which fires the TUI's own lazy `SessionStart` first. So
  "first `SessionStart` of a launch wins" is sound.

**Side effects:** two `/new` runs picked "New worktree" in the 0.157
dialog ("Where should the new conversation run?"). That created two clean,
detached managed worktrees at `~/.codex/worktrees/{9e37,a1ea}`.
Separately, about 15 spike sessions were written to `~/.codex/sessions`.
Pending: the maintainer decides whether to clean up either one.
The `/new` dialog defaults to "Current checkout". Step 5's test 2 and any
scripted driving must press Enter on it.

**Scope decision — B (maintainer, 2026-09-26; relayed via a sibling
session):** in-launch replacement per condition 1. Step 3's table and
Step 5 test 2 below are revised for B. The options were:
- **A — plan fallback (relaunch-only):** any later `current`
  `SessionStart` in a launch is rejected. `/new`, `/clear`, `/resume`, and
  `/fork` all leave the tab on the launch's first session.
- **B — source allowlist:** a later `current` `SessionStart` replaces the
  session only when `source` is `clear`, `resume`, or `fork`. `startup` is
  rejected, which covers `/new` and every plain child `codex exec`. Residual
  risk: an agent that runs `codex exec resume`/`fork` as a child would flip
  the tab. That is rare, the tab stays Codex, and the next relaunch heals
  it. The live DB shows `clear` used 19 times.
- **C — hook PID ancestry (0.4):** supports `/new` too, but the hook
  command must change, so every Codex user gets the hook-trust prompt
  again.

## Step 1 — Launch registry (Rust)

- In the ingest server state, add an in-memory registry
  `launch_id → { tab_id, pty_gen, registered_at, retired }`. It does not
  need persistence: PTYs, and so live launches, die with the app.
- `pty_gen` is the PTY id. Today `pty_spawn` allocates it (`next_id`,
  `pty.rs:432`) only *after* `spawn_command` (`:414`) and after writing
  `launch_cmd` (`:428`). Nothing can be exported or registered against it
  before then. Move the `fetch_add` to the top of `pty_spawn`, before the
  resume `-c` argument is built. A failed spawn then burns one id, which is
  harmless. Export it to the shell as `LOGIC_LOOP_PTY_GEN` alongside
  `LOGIC_LOOP_TAB_ID`. Re-entry spawns a new PTY, so launches from an old
  PTY become invalid.
- Two registration paths, one registry. The ingest server and `pty.rs`
  share a handle through Tauri managed state.
  - **In-process** (Setup and re-entry, Step 2): `pty_spawn` inserts the
    launch directly with the id it just reserved. This happens before it
    builds the resume command or writes `launch_cmd`, so no hook can arrive
    first. It is not an HTTP call, so there is no live-PTY check to fail. If
    the spawn fails, retire the launch on that error path.
  - **HTTP** (zsh wrapper only). Endpoints use the same bearer token as
    `/event` and a 1-second budget:
    - `POST /launch {tab_id, pty_gen, launch_id}` → 204. Reject an unknown
      or dead tab/PTY. The PTY is always in the map by then, because a
      human typed `codex` into a live shell.
    - `POST /launch/end {launch_id}` → 204, marks it retired.
- PTY exit and tab close retire every launch for that PTY (existing PTY
  death event path).
- Launch IDs are 128-bit random (`uuidgen` in the shell; the existing
  `getrandom` dependency in Rust, as the ingest token already uses — no new
  crate).
  They are opaque and not secrets: the bearer token still gates
  registration.

## Step 2 — Launch sources

The launch ID reaches hooks through the **existing** `LOGIC_LOOP_TAB_ID`
channel as `"<tab_id>:<launch_id>"`. It is scoped to the Codex child
process only (a prefix assignment, never exported into the shell), so a
later Claude process in the same tab — and its Codex plugin — never
inherits it.

- **zsh wrapper** (`ZSH_FILES` `.zshrc`): generate an ID, register it with
  `curl -sf -m 1` using `~/.context-terminal/ingest.env` (the same source
  the hook command reads), then run
  `LOGIC_LOOP_TAB_ID="$LOGIC_LOOP_TAB_ID:$id" command codex …` with the
  flag check unchanged. After Codex returns (status preserved), post
  `/launch/end`. If registration fails, still launch, with the plain tab ID.
- **Wrapper passthrough:** if `$LOGIC_LOOP_TAB_ID` already contains `:`, a
  launch is already registered. Skip registration and `/launch/end`, and run
  `command codex …` with the env untouched (flag check unchanged). Without
  this, Setup's typed `launch_cmd`, which runs through the wrapper in an
  interactive zsh tab, would become `<tab>:<id>:<id2>`. Ingest would read
  that as an unknown launch, and Setup's session would never bind.
- **Setup and re-entry** (`resume_command`, the Setup `launch_cmd`): Rust
  registers the launch in-process (Step 1) and emits
  `LOGIC_LOOP_TAB_ID=<tab>:<id> codex --no-daemon …`. Setup keeps plain
  `codex`, not `command codex`, so a user's own `codex` alias/function still
  applies as it does today. The passthrough above keeps the wrapper from
  adding a second ID. Re-entry's `zsh -l -c` never loads `.zshrc`, so the
  wrapper does not run there. Retirement for these launches is PTY
  death/tab close only; there is no `/launch/end`. This covers bash/fish
  users for these two paths without any shell integration.
- Keep the Rust zsh test. Extend its fake `codex` to print
  `$LOGIC_LOOP_TAB_ID`, and point `CT_PORT` at a closed port to prove the
  fail-open path.

## Step 3 — Ingest normalization and binding rules

- `ingest.rs` `/event` (and the statusline route): split the header on the
  first `:`. Put the stable tab ID in `tab_id` (so every existing consumer,
  and the `EXTRACTOR_TETHER` check, sees the plain ID). Put the registry
  verdict in a new app-derived field `launch`: `"current" | "retired" |
  "unknown" | "none"`, plus the opaque ID for diagnostics. Do this before
  any other use of the header.
- `src/lib/ingest.ts` — `bindSession` stays the one binding decision. For
  `agent === "codex"` with a tether:

  | Event | `launch` | Tab state | Result |
  |---|---|---|---|
  | any | `unknown` / `retired` | any | never binds or replaces (recorded only) |
  | any | `none` | unbound | binds, first-session-wins (today; Decision A) |
  | any | `none` | bound | first-session-wins (today) |
  | first `SessionStart` of this launch | `current` | any | binds; replaces the tab's prior session |
  | later `SessionStart`, `source` ∈ {`clear`, `resume`, `fork`} | `current` | owned by this launch | replaces (`/clear`, in-TUI `/resume`, `/fork`) |
  | later `SessionStart`, `source` = `startup` (or absent/unknown) | `current` | any | rejected (`/new` and child `codex exec` are indistinguishable, per 0.1) |
  | `SessionStart`, `source` = `compact` | `current` | owns session | applies; same session id, no replacement |
  | non-`SessionStart` | `current` | owns session | applies (today) |

  The tab records which launch owns its current session (new `Tab` field,
  in memory only). Subagents (`agent_id`) never replace.
- `mergeTabIdentity`: on replacement, set `sessionId` and clear
  `agentState`/`lastEventTs`/`lastTurnAuto` even when the event carries no
  state. (`SessionStart` maps to no state; without this, the new session's
  first prompt fails ownership. This was found in Phase 44's reverted
  build.)
- `sessionBindingLocation` and `App.tsx`: on replacement, deactivate the
  tab's old `session_bindings` rows, then upsert the new one, in that order.
  The Phase 44 reverted diff is a reference: it had this ordering right.
- Other adapters: untouched. Add regression checks that Claude, OpenCode,
  Pi, Antigravity, and DeepSeek still use first-session-wins.

**Decision A — decided 2026-09-26: Yes.** A Codex event with no launch ID
(`launch: "none"`) may still bind an unbound live tab, as it does today.

- **What it keeps:** a manual `codex --no-daemon` typed in a bash/fish tab
  still binds. No Step 2b (bash `--rcfile` integration) in this phase.
- **Why gap 2 stays acceptable:** a stale-daemon claim can reach only a tab
  with no session yet, and it is recoverable. The next registered launch in
  that tab (bare `codex` in zsh, Setup, or Re-enter) hits the "first
  `SessionStart` of this launch" row and replaces the claimed session. The
  "No" option would protect almost nothing in zsh tabs, where every bare
  `codex` registers. Its only effect there would be breaking manual Codex in
  bash/fish tabs.
- **Residual gap:** the claim does not heal if the next agent started in
  that tab is not a registered Codex launch. Examples are Claude, another
  adapter, or unregistered Codex in bash/fish. That agent then meets
  first-session-wins against the stale Codex session, which is today's
  behavior, not a regression. The trigger requires a tab whose tether
  seeded a shared daemon through a bypassed launch. Since Phase 44, a bare
  `codex` in a zsh tab runs `--no-daemon` and seeds no daemon.
- **Reopen trigger:** if the residual gap is seen live, apply the narrow
  fix first: reject `none` for an unbound tab whose current PTY has ever
  registered a launch. Bash/fish tabs never register, so they stay
  unaffected. Switch to full "No" (plus Step 2b) only if that fix is not
  enough.

## Step 4 — Tests

- `bind:check`: every row of the Step 3 table. Also: a stale daemon event
  (plain tether, then an unknown launch) against a bound tab and an unbound
  tab; a retired launch's late `SessionStart`; a Claude tab plus a
  plugin-launched Codex session (plain tether) stays Claude; two tabs with
  two launches in one folder. Decision A: a `none` event binds an unbound
  tab, and a later first `SessionStart` from a `current` launch in that tab
  replaces it (the heal path).
- `tab-identity:check`: replacement clears state and accepts the new
  session's first prompt; late events from the old session and the old
  launch are ignored.
- Rust: registry register/retire/PTY-death; header split (`tab:launch`,
  plain, malformed, `EXTRACTOR_TETHER`); zsh wrapper fail-open; the
  `resume_command` output format. The PTY id is reserved before spawn, and
  an in-process launch is `current` before the command runs. A failed spawn
  retires its launch. Wrapper passthrough: with
  `LOGIC_LOOP_TAB_ID=tab:id`, the fake `codex` prints exactly `tab:id`
  (one suffix), and no `/launch` request is made.
- Gates: `npm run check`, `npx tsc --noEmit`, `npm run build`,
  `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`,
  `git diff --check`. No `golden` run (no extraction prompt change).

## Step 5 — Live matrix (`docs/TESTING.md` §67)

Use a single default-profile instance and leave the shared daemon running.

1. + tab → `codex` → prompt → exit → `codex` → prompt: the tab follows the
   new session; Re-enter lists only the new one.
2. Inside one launch (answer "Current checkout" in `/new`'s dialog):
   `/clear` → prompt: the tab follows. In-TUI `/resume` of an older session
   → prompt: the tab follows. `/fork` → prompt: the tab follows. `/new` →
   prompt: the tab **stays** on its current session (unsupported, per
   Step 0). `/compact`: no change.
3. Inside Codex, have the agent run `codex exec "echo hi"`: the tab does not
   switch.
4. Claude tab → Codex plugin run: stays Claude.
5. Setup → Codex (in a zsh tab), and Re-enter: bind, then exit + re-run
   replaces. The Setup session's `launch` verdict is `current`, not
   `unknown`, which confirms there was no double wrap.
6. Outside terminal, bare `codex` through the shared daemon: claims nothing.
   Also a synthetic stale-daemon event (plain tether of a live bound tab and
   a live unbound tab): the bound tab is unchanged, and the unbound tab
   binds (Decision A: Yes). Then run bare `codex` in the unbound tab and
   prompt: the tab switches to the new session.
10. bash tab (a scratch instance launched with `SHELL=/bin/bash`, since
    `pty_spawn` reads `$SHELL`): manual `codex --no-daemon` → prompt: the
    tab binds (Decision A keeps this path).
7. Two tabs in one folder, each re-run twice: no cross-talk.
8. Registration failure: `LOGIC_LOOP_PTY_GEN=999999 codex` in a zsh tab
   (`/launch` → 409). Codex still launches (untracked). Overriding `CT_PORT`
   does nothing, because the wrapper re-reads `ingest.env`. The Rust test
   covers an unreachable port.
9. Daemon PID/start time unchanged; zsh prompt/history/aliases intact.

## Alternatives considered

- **Hook-only takeover** (Phase 44, reverted): cannot separate clients that
  emit the same fields. Rejected.
- **Wall-clock launch stamps**: order launches, but equal stamps don't prove
  the same client, and clock corrections can reorder them. The registry
  replaces them.
- **Hook-process PID ancestry** (0.4): strong evidence, but it needs the
  hook command to send `$PPID`. That changes the hook command, so Codex
  re-prompts for hook trust. Keep it as a fallback only if 0.1 fails to
  separate `/new` from child sessions.
- **Private app-server per tab via `--remote`**: stronger isolation, but
  larger lifecycle and resource cost. Not needed if Step 0 passes.

## Out of scope

- The side-panel cards issue after close + Re-enter (§66, test 4 part 2,
  unconfirmed). Separate investigation.
- Per-tab side panels for two tabs in one folder (panels are project-scoped
  by design).
- Repairing sessions already running on the shared daemon.
