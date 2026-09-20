# Landmines — Logic Loop

Gotchas found live, with root cause and fix. Check before touching related
code — most of these are non-obvious and will bite again if the underlying
fix is ever reverted or bypassed. Referenced from CLAUDE.md.

- WebGL addon only on the visible terminal; hidden tabs use DOM renderer
  (webview GPU-context cap ~8–16). Keep the context-loss handler.
- `~/.claude/settings.json` writes must stay idempotent and byte-identical
  reversible; the user has pre-existing hooks that must survive. Unit tests
  cover this — keep them passing.
- Events table dedupe (migration 6, `dedupe_key` UNIQUE index): key is
  `tool_use_id` alone for types that carry one (PostToolUse — a real Anthropic
  API id, immune to concurrent subagents sharing one session_id); for types
  without one (Stop, Notification, UserPromptSubmit, transcript lines) it's
  session + agent_id + full payload + a 500ms time bucket. Content alone would
  collapse every same-session Stop into one row — today's Stop payload carries
  no per-turn field. `dedupeKey`/`addEvent` live in `src/lib/repo.ts`;
  `INSERT OR IGNORE` makes a caught duplicate a silent no-op. Don't add a
  second call site that inserts into `events` without going through
  `addEvent`, or it skips the key.
- Project keys are derived, never raw cwd. `pty::project_key()` walks up to the
  nearest `.git` (stopping at `$HOME`, so a dotfiles repo can't swallow every
  project); `pty::canon()` handles case/tilde underneath it. Derivation happens
  in exactly two places — `openTab` for tabs, and the ingest server for hook
  payloads (`project_key` field). A third call site is how the split comes
  back: route new cwd write paths through one of those two, never a raw string.
- **The app must never ingest its own agent subprocesses.** `run_extractor`'s
  `claude -p` child inherits the user's `~/.claude/settings.json` hooks and
  POSTs straight back to our ingest server. Uncaught (found 2026-07-19) this
  self-amplified: the child runs with the app's cwd (`/` when launched from
  `/Applications`), bound to whatever tab was active via the untethered
  fallback, overwrote that tab's cwd with `/`, and its transcript fed the
  extractor again — 174 billed `claude -p` runs in 20 minutes and every
  bookmark tab's panel keyed on garbage. Defence is two-layer, keep both:
  `extractor.rs` stamps `LOGIC_LOOP_TAB_ID=ingest::EXTRACTOR_TETHER` on the
  child, and the ingest server drops that tether before parsing. Any future
  code path that spawns an agent CLI must carry the same stamp.
- **RESOLVED (Phase 33.1, 2026-09-12) — root cause was the child spawn, not
  reconciliation logic.** Phase 33's ~7-14x landmine estimate above was real
  but misdiagnosed the mechanism: `claude -p`'s spawn in `extractor.rs` (and
  mirrored in `scripts/golden.ts`) carried no context-stripping flags, so
  every extraction/reconciliation call booted a full Claude Code environment
  — every configured MCP server's tool schema, every skill description,
  CLAUDE.md discovery, the default system prompt. Measured live via
  `--output-format json` before any change: **57,293** fixed input-side
  tokens per extraction call, **57,015** per reconciliation call, for a ~1-2k
  char prompt. `claude_args()` now adds `--strict-mcp-config --tools ""
  --setting-sources "" --no-session-persistence --system-prompt "<...>"`,
  cutting fixed overhead to **1,402** / **1,124** (41x / 51x). `--bare` was
  rejected — it forces API-key auth and breaks OAuth/Max-subscription logins.
  Secondary fixes shipped alongside: Answer-now replies close their card
  deterministically (zero model calls, matched against the `Re: "<question>"
  — ` prefix `App.tsx`'s `answerNow` writes); bare/short/lexically-unrelated
  replies skip reconciliation entirely (`shouldSkipReconciliation` in
  `decisionReconciliation.ts`); `insertDecision` now dedupes against the
  session's other still-open rows by normalized question text, closing the
  duplicate-card gap named in Phase 33's own notes below; reconciliation's
  candidate/char caps dropped from 100/2000/2000 to 20/400/400. Haiku was
  tried on reconciliation and reverted in the same sprint — it wraps its JSON
  reply in ` ```json ` fences that `parseReconciliation`'s strict contract
  rejected; reconciliation stayed on sonnet.

  **Superseded same day (Phase 33.1 sidequest, 2026-09-12):** the fence
  rejection was the actual bug, not a reason to avoid haiku. Fixed
  `parseReconciliation` to tolerate ` ```json ` fences exactly like
  `parseExtraction` already does (same schema validation underneath, just a
  formatting strip) — reconciliation then passed **3/3 full golden runs**
  clean on haiku. Also tried haiku on extraction: 14/14 on two of three full
  runs, but a real, reproducible ~1-in-7 false positive on
  `09-question-in-code` (extracts a decision from a question embedded in a
  code comment) across repeated direct re-runs — exactly the over-extraction
  failure mode this file already treats as worse than under-extraction (see
  the LM Studio model comparison in `docs/TESTING.md`'s quality-gates
  section). Per the rule this experiment was run under ("any miss, that path
  stays sonnet"): **extraction stays sonnet, reconciliation now defaults to
  haiku.** `ExtractorSettings.reconcileModel` (persisted, `⚙ Sidebar LM` UI)
  lets a user dial reconciliation back to sonnet; extraction has no such
  dial because it isn't switchable — sonnet is the only golden-clean choice.
  `scripts/golden.ts`'s `EXTRACTOR_MODEL` env var forces one model across
  every fixture for any future experiment like this one; unset, it mirrors
  the shipped per-path defaults. See
  `plans/014-reconciliation-haiku-default.md`.

  Any future extractor call site (`decisions.ts`, `landing.ts`,
  `commitMessage.ts`) must keep passing the `model` arg through
  `run_extractor` — a new call site that skips it silently reverts to the
  Rust-side `"sonnet"` default, which is fine, but a new call site that
  reintroduces the old unstripped args vector would reopen this whole
  landmine. See `plans/013-extractor-spend-emergency-sprint.md` and
  `docs/TESTING.md` §46.
- `expand("/")` returns `""` — the trailing-slash strip eats a root path, and an
  empty cwd silently makes every panel query match nothing. `bindSession`
  refuses to bind an untethered session whose project key is `/`
  (`bind-check.ts` covers it). Treat any cwd that can reach `expand()` as
  possibly-root.
- A transcript tailer that exits must de-register from `TailerRegistry`.
  Registering before the file opens meant one failed open blinded a session for
  the life of the app: hooks kept arriving, no transcripts, so no decisions
  ever extracted — and nothing on screen said so. Failures emit
  `ingest://tailer-failed`, surfaced as the side-panel warning strip.
- Unclaimed results live in two places and both must agree: the persisted
  `result_landed`/`result_claimed` event pair, and `unseenStops`, the in-memory
  flag set that `claimTab` gates on. A restart empties the set but not the
  table, so startup **must** seed the set from `repo.unclaimedSessions()`
  before `setActiveId` — the `activeId` effect claims whatever tab it
  activates, so seeding afterwards strands the first restored tab
  flagged-but-active. Found 2026-08-12: a surviving result displayed forever
  and could never be claimed. `seedUnclaimedTabs` (src/lib/ingest.ts) is pure
  so `unclaimed:check` can cover it; the manual half is docs/TESTING.md §16's
  "Claim it after that relaunch" step. Persistence passing is not proof —
  the display path works while the claim path is broken.
- Bundle `"targets"` is `["app"]`, not `"all"`, on purpose. The DMG step stages
  through an `Applications -> /Applications` symlink and deleted the installed
  `/Applications/Logic Loop.app` mid-session. Re-enable DMG only for an actual
  release, and never while dogfooding.
- A stuck/denied Desktop-folder TCC grant for Logic Loop's own bundle id
  (`com.vandershark.context-terminal`) makes **every** PTY-spawned command
  fail with `EPERM` — not just paths under Desktop. Found 2026-08-15: `claude`
  and even `brew` errored (`An internal error occurred (EPERM)`, "current
  working directory must be readable") inside Logic Loop terminals. The error
  text points at Terminal.app / DeveloperTool — it doesn't; that's a red
  herring, and `tccutil reset DeveloperTool com.apple.Terminal` (wrong bundle
  id, wrong TCC class) has no effect. Real fix:
  `tccutil reset SystemPolicyDesktopFolder com.vandershark.context-terminal`
  and `tccutil reset SystemPolicyAllFiles com.vandershark.context-terminal`,
  then fully quit Logic Loop (not just close the window) and relaunch —
  approve the TCC prompt when it fires. Also check System Settings → Privacy
  & Security → Files and Folders for a stale denied Desktop toggle. No
  rebuild needed; this is TCC state, not a stale ad-hoc signature.
- Fresh dev builds can also surface unrelated first-launch TCC prompts
  (Apple Music, Photos, network volume) with no usage-description keys and no
  entitlements file present in the bundle — the dialogs do say "Logic Loop."
  Not traced to any downward filesystem walk in `src-tauri/src` (none exists);
  treat as an unsigned/ad-hoc-build artifact until it recurs on a signed
  build. Doesn't block Phase 6 — separate from the notification-permission
  prompt in TESTING.md §16.
- Codex's hook trust is keyed per-hook-type by a hash of that hook's inner
  `command` string (`~/.codex/config.toml`'s `[hooks.state."<hooks.json
  path>:<event>:0:0"]` → `trusted_hash`), persisted independently of the
  hooks.json file itself. Found 2026-09-06 (Phase 16 follow-up, live during
  §29 testing): Phase 16 added the `X-Logic-Loop-Agent: codex` header to the
  hook command text, changing every hook's command string — but the user's
  already-trusted hashes from before that change stayed in `config.toml`.
  Result: every Codex hook silently failed the trust check and never ran, no
  visible prompt, no error — `codex doctor` reported hooks fully enabled and
  reachable the whole time. Symptom was a Codex tab stuck at "no session · no
  events yet" forever despite Codex answering prompts normally in the
  terminal. Fix: delete the stale `[hooks.state...]` blocks from
  `config.toml` and start a fresh Codex session — this time the real trust
  prompt appears (it does NOT reappear while a stale-but-present hash sits in
  config, which is what made it invisible) and approving it writes fresh
  hashes for all 7 registered events. Any future change to `codex::install`'s
  hook command text must be treated as a trust-invalidating change — there is
  no code-side way to force re-trust, only manual `config.toml` surgery by the
  user, so flag it loudly in the phase report rather than assuming an
  install-time hooks.json rewrite alone fixes existing installs.
- **RESOLVED upstream in agy 1.1.27** (re-verified live 2026-09-07, four
  hook-config matrices incl. multiple named hooks + mixed matchers + reversed
  registration order — all fired sequentially as documented). Originally
  found 2026-08-27 on an older build: Antigravity's `hooks.json` did **not**
  merge named hooks on `PostToolUse`, despite its own doc promising "multiple
  named hooks … are merged and executed sequentially" — with `logic-loop` and
  a probe hook both registered, only one fired. A user on agy < 1.1.27 could
  still hit this (zero Logic Loop tool events, no error, toggle says on) — if
  it recurs, check for a foreign `PostToolUse` hook before debugging anything
  else. Defensive detection (`detect_foreign_post_tool_use` in
  `antigravity.rs`, warns via the tailer-failure channel without blocking
  setup) covers exactly this case for older/regressed agy installs.
  Separately, agy strips `result`/`model_output`/`model_thinking`/
  `final_model_output` from every command-hook payload, which is why a failed
  `run_command` is invisible to the adapter (docs/TESTING.md §21, and the
  `translate()` doc comment in `antigravity.rs`) — re-confirmed live on
  1.1.27, `error` comes back `""` on both success and failure, no exit code
  or status field exists to map. This one has no fix: don't try to recover it
  by parsing model prose or the transcript — invariants #1 and #5. The pinned
  tripwire test (`translate_real_failing_run_command_payload_carries_no_failure_signal`)
  stays as permanent documentation of this ceiling, not a TODO.
- The Commit & Push footer's `git add -u` only stages tracked files —
  `git_has_changes` also queries with `--untracked-files=no`, so a change
  that's *only* a new file never even marks the footer dirty. Found
  2026-08-27: the "Add Codex adapter" push to `main` committed a message
  describing the new `codex.rs` module while the file itself, being
  untracked, was silently never staged — `origin/main` failed `cargo check`
  for anyone cloning fresh (`mod codex;` + 4 `codex::*` command
  registrations pointing at a file that didn't exist in the tree). Fixed by
  push (`fb79dea`): `git_untracked_files`/`git_add_all` (`pty.rs`) plus a
  `hasStageable = gitDirty || untrackedFiles.length > 0` footer gate
  (`SidePanel.tsx`) so an untracked-only change still opens the footer, and
  an amber warning box lists the untracked files with an opt-in checkbox
  before they're included in a commit — never auto-included, always visible.
  Any future change to the footer's staging logic must keep both checks
  (dirty gate + stage step) untracked-file-aware, not just one. The opt-in
  checkbox this fix added is easy to leave unchecked on real work by
  habit — found recurring 2026-08-27 during TESTING.md §19 item 11's manual
  test, on real Phase 11 content this time (PR #4), not a throwaway. Not an
  app bug (the box is deliberately opt-in, visible, and was honored exactly
  as designed both times) — just confirm what the amber box says before
  clicking, especially right after adding a new source file.
- The Commit & Push footer's wip-branch path (`commitAndPush("branch")` in
  `SidePanel.tsx`, when `gitBranch === "main"`) does a real `git checkout -b`
  in the tab's own live working directory — not a worktree — to create
  `wip/<timestamp>`. Found 2026-08-27 (TESTING.md §19 item 11): it committed,
  pushed, and never checked back out, permanently leaving the tab's actual
  git checkout on the new branch with no indication beyond the footer's
  branch pill (UI state, not real git state). `main`'s ref/remote were
  technically untouched, satisfying the item's literal wording, but the live
  working directory silently drifted — a real risk to a running agent
  session in that same terminal, and it read as working-tree data loss
  when an unrelated later `git checkout main` (cleanup of a throwaway test
  branch) correctly reverted tracked files to `main`'s committed content,
  since by then the real diff had been committed onto the abandoned wip
  branch rather than lost. Recovered via `git fsck --dangling` — the commit
  object was still in the odb. Fixed same session: new `git_checkout`
  command (`pty.rs`, plain checkout of an *existing* branch — distinct from
  `git_create_branch`'s `-b`) plus a `switchedFrom` tracker in
  `commitAndPush` whose `finally` checks the tab back out to its original
  branch on every exit path (success, push failure, PR failure). Any future
  branch-switching flow triggered from the footer must check back out
  afterward the same way — never leave a live tab parked on a branch the
  user didn't ask to stay on.
- Antigravity's `PreInvocation` fires **multiple times per top-level turn**
  (once per intra-turn model round-trip in its tool-call loop — 3 firings
  live-observed for one turn with 2 tool calls), not once per turn. Found
  2026-09-06 (Phase 16) live-verifying a source review's proposed epoch-bug
  fix (map every `PreInvocation` → `UserPromptSubmit`) before shipping it —
  that mapping would have inflated Since-you-left's turn count and
  corrupted Phase 15's turn-provenance tagging for every multi-tool-call
  Antigravity turn. The reliable once-per-turn signal is `invocationNum ==
  0`, confirmed live to reset at the start of every new turn — including a
  second turn resumed in the *same* long-lived process via
  `--input-format stream-json` (not just a fresh process each time, which
  would trivially always read 0). `antigravity.rs`'s `translate()` gates on
  exactly this. Separately, this same live pass overturned Phase 11's own
  prior architecture comment, which had grouped `PreToolUse` and
  `PreInvocation` together as uniformly unsafe to register (both
  synchronous, hooks.md's "Current Limitations" note) — true for latency
  (every agy hook already blocks the loop, that's not `Pre*`-specific), but
  `PreInvocation`'s actual contract has no required response field at all
  (no `decision`, no deny semantics — `injectSteps` is optional), while
  `PreToolUse`'s does (`decision` is required); a bare `{}`, confirmed live
  across normal and deliberately-slow/malformed responses, never blocked or
  denied a `PreInvocation` turn. `PreToolUse` remains unregistered — its
  required-field gap is real and untested. Any future work reusing
  `invocationNum` (e.g. Antigravity Plan 003's SessionStart detection) must
  use `== 0`, not `== 1` as originally drafted before this was verified.

- Tab restore can lose one of two same-project tabs on quit/relaunch. Found
  2026-09-11 during Phase 33 live testing — separate bug, not a Phase 33
  regression (Phase 33 touches decision reconciliation only, not tab
  restore). Not yet root-caused; flagging for its own investigation.

- **RESOLVED (Plan 017, 2026-09-12) — root cause was never `run_extractor`.**
  Found 2026-09-12 (first live Claude-CLI-backed UI pass since Phase 33.1's
  rebuild): a real macOS beachball (mouse control lost app-wide, other
  project tabs included) on `run_extractor`-adjacent actions, duration
  matching the CLI's real wall-clock latency. Two Rust-side fixes to
  `run_extractor` (`async fn`, then `spawn_blocking`) were correct and kept,
  but neither eliminated the freeze — the falsifying fact (Answer-Now froze
  identically despite never calling `run_extractor`) turned out to be a red
  herring pointing at the wrong function, not proof the fix was wrong.
  A live `sample` capture during an actual freeze (`plans/017-fix-extractor-
  freeze.md`) pinned it directly: `SidePanel.tsx`'s `reload()` — fired after
  nearly every ingested event — awaits five plain `pub fn` Tauri commands
  (`git_log`, `git_current_branch`, `git_has_changes`, `git_untracked_files`,
  `read_board`), all synchronous, all running on the app's actual main/
  event-loop thread per Tauri v2's default (confirmed via context7). One
  sample showed `git_untracked_files`'s `Command::output()` alone parked in
  `poll()` for ~31 of ~31 sampled seconds on that exact thread. Fixed: all
  15 git-shelling commands in `pty.rs` plus `read_board`/`write_board` in
  `board.rs` converted to `async fn` + `tauri::async_runtime::spawn_blocking`
  via two small shared helpers (`spawn_blocking_or_default`,
  `spawn_blocking_result`), mirroring `run_extractor`'s already-correct
  pattern. Verified structurally (post-fix `sample`: the git subprocess wait
  no longer appears under the main thread's call tree, only the ~2ms dispatch
  does) and live (maintainer: "exceptionally snappy... no lag").
  Second, related finding same session: an unintended `~/.git` (created
  2026-09-11, empty, no commits — not created by this codebase, confirmed no
  `git init` call site exists anywhere in it) meant a project with no `.git`
  of its own (e.g. a scratch test dir) had every `git -C <cwd> ...` silently
  walk up and operate on the whole home directory — `--untracked-files=all`
  enumerating everything under `~` is almost certainly why the freeze was so
  severe. Fixed with `pty::has_own_repo(cwd)`, mirroring `project_key`'s
  existing `$HOME`-stop walk: every one of the 15 git_* commands now refuses
  (same fallback each already had) before shelling out at all when no `.git`
  exists between `cwd` and `$HOME`, regardless of whether a stray
  home-directory repo exists. Regression test:
  `has_own_repo_refuses_a_home_directory_git_it_did_not_create` (`pty.rs`).
  **Recurrence 2026-09-14:** the stray `~/.git` itself was never actually
  removed by the above fix — only defended against inside Logic Loop's own
  15 git_* commands. It was still present and got triggered again live, this
  time by a maintainer testing session running plain `git -C <dir>` commands
  (not through the app) against a scratch tab bound to a directory with no
  `.git` of its own. Confirmed via `git -C ~ log` (`fatal: your current
  branch 'master' does not have any commits yet`, matching the 2026-09-11
  creation date exactly) before anything destructive happened — only two
  already-intended file stages landed, nothing else. Deleted this time
  (`mv ~/.git ~/.Trash/git-stray-landmine-deleted-20260914`) rather than
  just defended against again. `has_own_repo()` still protects Logic Loop's
  own commands regardless, but any agent or human running plain `git`
  commands from a home-rooted directory lacking its own repo is not
  protected by that guard — worth remembering if this recurs a third time.
  Two unrelated findings surfaced during the same live pass, neither fixed
  here: Claude Code CLI stopped writing transcript `.jsonl` files for new
  sessions in the test project starting ~9:31am 2026-09-12 (confirmed via
  directory mtime — a CLI/environment issue, not this codebase, decisions
  extraction has nothing to read without a transcript file); and
  `cache_creation_input_tokens` occasionally spiking to ~25-27k instead of
  the ~1.4k Phase 33.1 baseline (not chased). Full trail:
  `plans/017-fix-extractor-freeze.md`.
- Launching the dev server (`npm run tauri dev`) or the built app **from
  inside a Claude Code CLI shell** leaks that shell's environment to every
  process the app spawns, PTY tabs included. Found 2026-09-14 live-testing
  §26 (diff pop-out): a maintainer's Claude session running inside a fresh
  Logic Loop tab showed "no transcript for 2 sessions — decisions
  incomplete" and, inside the CLI itself, "Transcript saving is off —
  inherited `CLAUDE_CODE_CHILD_SESSION` marker." Root cause: the terminal
  used to run `npm run tauri dev` was itself a Claude Code CLI session,
  which had `CLAUDE_CODE_CHILD_SESSION=1` set in its own environment
  (confirmed via `env | grep CLAUDE_CODE_CHILD_SESSION`); that var
  propagated through `npm run tauri dev` → the Tauri app → every PTY tab it
  spawned → the interactive `claude` process running in each tab, which
  then correctly-per-its-own-logic treated itself as a child/sub-agent
  session and disabled its own transcript persistence — even though a real
  human was interactively using it. This is not an extractor-tether issue
  (invariant #1's `LOGIC_LOOP_TAB_ID=ingest::EXTRACTOR_TETHER` stamp is
  Logic Loop's own mechanism, unrelated to this CLI-level env var) and
  nothing in this codebase sets or reads `CLAUDE_CODE_CHILD_SESSION` — nor
  should it try to strip it defensively; that would be papering over the
  dev workflow that caused it rather than fixing the workflow. Fixed for
  this session by killing and relaunching with
  `env -u CLAUDE_CODE_CHILD_SESSION npm run tauri dev`. Anyone dogfooding
  Logic Loop by launching it from inside an existing Claude Code session
  (a natural thing to do while developing Logic Loop itself) should expect
  this and either unset the var first or launch from a plain shell.
  Likely explains a previously-unresolved mystery from Plan 017's addendum
  (below) with an identical symptom shape.
