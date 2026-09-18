# Plan 028: Build a first-party DeepSeek Harness terminal adapter

> **Status: CANDIDATE. Planning only.** Follow-on to
> `plans/027-deepseek-harness-readiness.md`'s BUILD decision, which rejected
> all four reviewed third-party `tui` bundles (one misrepresents its
> provenance, one bundles a hosted account system + Electron installer, two
> are unaudited single/dual-maintainer hobby projects) in favor of a small
> first-party profile Logic Loop owns end to end, matching the Codex/
> Antigravity/OpenCode/Pi adapter pattern. Implementation beyond Step 0's
> read-only-adjacent live probe waits for the literal approval of the
> assigned phase.

## Status

- **Priority:** P1, sixth adapter candidate
- **Effort:** M, roughly 2-3 days (contract proof + thin UI + ingest wiring
  + live macOS pass), larger than Pi (026) because there is no existing
  first-party frontend to build against — this plan writes one
- **Risk:** MEDIUM — no community UI dependency to inherit, but the
  `headless`/`sdk-minimal` session-driving contract is unverified for an
  interactive human loop (both are documented as programmatic/scripted
  profiles, not confirmed as human-in-the-loop terminal targets)
- **Depends on:** Plan 027's decision record; explicit phase authorization
  before Step 0's disposable-`DSH_HOME` live probe; code must stay scoped
  separately from Pi's `plans/026-pi-agent-adapter.md` (separate files,
  separate installer, separate tests)
- **Planned at:** 2026-09-17

## Decision to make

Plan 027 proved `dsh` itself is real and locally reachable
(`@deepseek-ai/dsh@0.1.6-alpha.2` via `npx`, no global install needed) but
that no shipped or safely-adoptable community `tui` profile exists. The
open question here is narrower: can `headless` or `sdk-minimal` — both
shipped, both documented as scriptable/programmatic profiles — host a
small interactive stdin/stdout loop we write ourselves, well enough to
back a Logic Loop PTY tab the same way `claude`, `codex`, `agy`, and `pi`
already do? If yes, build a thin first-party Ink or plain-readline
frontend as a `dsh` plugin app (same shape as the rejected `gxinxing`
bundle, but authored, reviewed, and owned in this repo). If the chosen
profile turns out to require a real browser or non-interactive batch
mode only, stop and keep DeepSeek Harness DEFERRED — do not force a PTY
UI onto a profile that isn't built for one.

## Existing Logic Loop contract (unchanged from Plan 027)

- `src/lib/onboarding.ts` / `src/components/AgentStatusBar.tsx` enumerate
  adapters; this would be a sixth entry alongside Pi.
- `src-tauri/src/pty.rs::pty_spawn` hosts the PTY and sets
  `LOGIC_LOOP_TAB_ID`; `src-tauri/src/ingest.rs` recognizes adapter
  markers. `src/lib/ingest.ts::stateForHook` consumes normalized
  `UserPromptSubmit`/`PostToolUse`/`Stop`.
- Hard invariants from `CLAUDE.md` apply unchanged: never parse PTY bytes
  for meaning, fail open, panels stay dumb SQL views, no autonomous input,
  transcript/agent content is untrusted data.

## Build steps

0. **Live profile-viability probe — DONE 2026-09-17, corrected premise.**
   Disposable `DSH_HOME` under `/tmp` (never the real `~/.dsh`),
   `@deepseek-ai/dsh@0.1.6-alpha.2` via `npx`. As literally scoped, the
   original question was answered and the plan's own stop condition would
   have fired: `dsh --profile headless --help` confirms one-shot only
   ("Answer one task ... and exit", no resume flag); `dsh --profile
   sdk-minimal --help` confirms stdio JSON-RPC "until its client
   disconnects" — a programmatic protocol server, not a human-typed loop.
   Neither is a terminal chat loop.

   **But that framing was wrong, found live before stopping.** The
   top-level `dsh --help` itself documents the real extension point:
   `dsh --profile tui --resume <session>` and `dsh plugin --profile tui
   add <package>` are launcher-level, profile-name-agnostic — "tui" is
   just a profile *name* someone chose, not a special mode. `dsh
   --profile web --dump-default-config` (the exact read-only command Plan
   027 pre-authorized) shows why: the web profile is the shared
   `@deepseek-ai/dsh-base` plugin stack (session, agent, LLM, sandbox,
   approval, tools — all profile-agnostic) with a final patch layer,
   `@deepseek-ai/dsh-web-app` (plus its `/startup` sub-export), that is
   the *only* thing that's browser-specific — it disables/reconfigures a
   handful of base tool ids and adds the actual UI. This is exactly the
   shape `gxinxing`'s reviewed-and-rejected bundle used too (a
   `cordis.patch.yml` + app entrypoint, declared via `dsh: { bundle:
   { patch: ... } }` in `package.json`) — confirming it's the documented,
   sanctioned mechanism, not something those bundles reverse-engineered.

   **Revised target, stated explicitly per this repo's plan-revision
   rule:** build our own `-app`-shaped patch layer (working name
   `dsh-terminal-app`, local-file-referenced only, never published) that
   patches the same shared base `dsh-web-app` patches, rendering to a TTY
   instead of serving a browser. Install it into a Logic-Loop-owned
   profile via `dsh --profile logic-loop --from-default-profile web` (or
   a leaner base if the web template pulls in browser-only deps we don't
   want) plus `dsh plugin --profile logic-loop add <local path>`. This is
   a real, bounded build (comparable in shape and size to the reviewed
   `gxinxing` bundle we already read in full), not a retrofit of a
   batch/RPC profile. **Verify (met):** launcher accepts an arbitrary
   profile name; `--dump-default-config` proves the base/app-patch split
   is real and inspectable; the extension mechanism matches a bundle
   already reviewed line-by-line in Plan 027. Proceeding to Step 1 under
   this corrected target.
1. **Scaffold the first-party plugin app — DONE 2026-09-17.** New
   top-level directory `dsh-terminal-app/` (separate from `src/`,
   `src-tauri/`, and root `package.json` — not part of any npm/pnpm
   workspace, installed only by local path). MIT-licensed, `private:
   true`. Built from primary sources, not from any of the four rejected
   bundles: `dsh --profile headless --dump-default-config` (live,
   disposable `DSH_HOME`) proved the base/app-patch split is real;
   reading the actual installed `@deepseek-ai/dsh-headless` package's own
   compiled source (official, MIT, already a `dsh` dependency — not a
   supply-chain addition) gave the exact Cordis plugin contract
   (`{ name, inject, Config, apply(ctx, config) }`, `ctx.get("agents"
   /"sessions"/"agentDefaultModel")`, `agents.create(...)`,
   `agent.followup(createUserMessage(...))`, `agent.whenIdle()`,
   `ctx.on("agent/assistant-stream", ...)` frame/chunk shape) instead of
   guessing it. `cordis.patch.yml` disables `headless-startup`/
   `headless-runner` and installs `terminal-startup` (CLI arg parsing,
   commander + `@deepseek-ai/dsh-cmdline`, matching `dsh-headless/
   startup.js`'s own pattern, adding a `--resume <sessionId>` option) and
   `terminal-runner` (the loop itself: create-or-resume one Agent, then
   `node:readline/promises` reads a line, forwards it, streams the
   assistant's `text-delta` chunks to stdout via the same frame-handling
   shape `dsh-headless` uses for its reasoning stream, repeats until
   `/exit` or EOF). Zero dependencies beyond what `dsh-headless`/
   `dsh-web-app` themselves already depend on (`commander`,
   `@deepseek-ai/dsh-cmdline`, `@deepseek-ai/dsh-util-values`,
   `@deepseek-ai/schemastery`) — no Ink/React, `node:readline/promises`
   covers the interactive loop. `node --check` clean on both source
   files. **Known, explicitly flagged gap, not yet resolved:** no
   handling of the base profile's `dsh-user-approval` "ask" policy — a
   tool call under default `workspace-write`/`ask` has not been proven
   live to resolve rather than hang. That is exactly what Step 2's
   multi-turn-plus-tool-call live proof (folded into this plan from Plan
   027's original Step 2 gate) must verify before this scaffold is
   treated as viable for a real PTY tab. Not run against any profile yet
   — this step was source-only, no `dsh plugin add` executed.
2. Wire the observer half: a passive `session/event` listener sending
   only allowlisted, bounded metadata (mirroring Pi's
   `command`/`file_path`/`description` allowlist pattern) to the localhost
   ingest server, stamped with `LOGIC_LOOP_TAB_ID` like every other
   adapter. Verify against a local mock ingest server first, per Pi's
   Build step 2 precedent — never point an unverified adapter at the
   real dev app's ingest port.

   **2026-09-17 partial live proof, boot-to-idle only — no model call
   yet.** Installed the Step 1 scaffold into a disposable `logic-loop`
   profile (`--from-default-profile headless`) under a throwaway
   `DSH_HOME`, never the real `~/.dsh`. Real findings, each fixed in the
   scaffold itself, not worked around:

   - **`peerDependencies` was the wrong call for an out-of-tree plugin.**
     `dsh-headless`'s own official package.json declares `dsh-agent`/
     `dsh-session`/`dsh-llm`/`cordis` as peers, which works for it because
     it's hoisted flat inside the `dsh` CLI's own npx-resolved
     `node_modules` next to those exact packages. Our plugin lives outside
     that tree entirely, so peers were never satisfiable. Fixed by making
     them regular `dependencies` instead — this matches `gxinxing`'s
     reviewed-and-rejected bundle's own (correct) choice, confirming it
     wasn't a mistake on their part.
   - **`pnpm add -w <local path>` symlinks; it does not install the
     linked package's own dependencies**, because the profile's
     `pnpm-workspace.yaml` only lists itself (`packages: [.]`), not the
     external path. `--preserve-symlinks` "fixes" module resolution for
     an externally-symlinked package but breaks pnpm's own
     symlink-based store for *other* packages already working in the
     tree — confirmed live: it made an unrelated base-bundle plugin
     (`dsh-attachment-local`, via `sharp`'s native binary) fail, which
     doesn't fail without that flag. **Do not use `--preserve-symlinks`
     for the real installer.** Fix instead: install the plugin as a real
     copied directory with its own `node_modules` (`npm install` inside
     it), not a symlink. This is the correct model for Step 3's Rust
     installer too — copy the package into the profile, don't `pnpm add
     -w` an absolute path.
   - **`@deepseek-ai/schemastery`'s API differs from zod**: fields are
     optional by default, there is no `.optional()` (confirmed against
     the installed package's own README) — only `.required()` to opt a
     field *in*. `Config = z.object({ resumeSessionId: z.string() })`,
     no modifier, is correct.
   - **A real bug in the Step 1 loop, only surfaced by this live test**:
     `node:readline/promises`' `question()` does not reject on its own
     when stdin simply ends (EOF) — it hangs forever waiting for a "line"
     event that never comes. Fixed with an `AbortController` aborted on
     the input stream's `"end"` event, passed as `question()`'s `signal`
     option.

   With all four fixed, the patched profile boots cleanly end to end with
   no credentials required: creates a real session id, prints the banner
   and `>` prompt, and exits 0 cleanly on EOF.

   **Real model round trip attempted same day**, with a maintainer-
   provided disposable test key (handed off via a scratch file outside
   the chat transcript, read once, never printed, deleted immediately
   after use — never written to any tracked file). First attempt used a
   plain `printf ... | dsh` pipe and produced no visible output at all;
   root cause was the test harness, not the runner — a plain pipe's
   writer closes as soon as it finishes writing, which can fire stdin's
   `"end"` before `readline` has dispatched the corresponding `"line"`
   events, so the Step 2 abort-on-EOF fix silently cancelled the first
   `question()` before it ever resolved. Re-tested with a FIFO whose
   writer process stays open across delayed, scripted sends — that's the
   right harness shape for any future non-interactive test script (Step
   2's own future automated check, if one gets added) and confirms the
   Step 1 EOF fix isn't the problem; a real interactive terminal never
   hits this because stdin never ends on its own.

   With the FIFO harness, three prompts printed but still with no
   assistant text between them. Differential test isolated the cause
   immediately and conclusively: `dsh --profile headless "..."` with the
   same key, same environment, returned `dsh: QUOTA: Insufficient
   Balance` — the key authenticates correctly (proves credential wiring,
   env-var pickup, and the whole plugin/profile install chain are all
   correct end to end) but the account has no balance. **Not a code bug
   in the scaffold; an account/billing fact outside this plan's
   scope.** Test key deleted immediately after use.

   That said, the quota failure did catch one real remaining gap, now
   fixed: the runner never checked for a `turn/end` error reason the way
   `dsh-headless`'s own `summarize()` does, so a failed turn (like this
   one) produced no output at all instead of the `dsh: QUOTA: ...` line
   headless itself printed. Added `reportTurnError()`, reading the
   session's own events for the just-run turn's range and printing
   `code`/`message` on an error reason — mirrors the official pattern
   instead of inventing a new one. `node --check` clean.

   **Funded-key retest, same day — full pass.** The maintainer topped up
   the same key ($5) and handed it off again the same secure way. Refresh
   attempt caught one more real bug before the retest could even boot:
   the package.json's `"*"` version ranges for the core `@deepseek-ai/*`
   packages resolved, via plain `npm install`, to `@deepseek-ai/dsh-
   session@0.0.1-rc.1` — an old, incompatible, differently-shaped package
   published under the same name (no `SessionSeq`, no `eventAt`, a
   completely different export surface: `Session`/`SessionStore`/etc.).
   These prerelease-only scoped packages don't reliably carry a sane
   "latest" dist-tag, so an unpinned range is unsafe here specifically —
   fixed by pinning every core dependency to the exact version already
   confirmed working inside the `dsh` CLI's own resolved tree (`0.1.5-
   rc.2` for the dsh-* packages, `4.0.2` cordis, `1.0.3` cordis-plugin-
   loader, `3.18.2` schemastery), read directly off that tree rather than
   guessed. **Real installer implication for Step 3:** don't hand-pin
   these as static literals long-term — they'll drift from whatever `dsh`
   ships next. The Rust installer should read the target profile's own
   resolved versions at install time and pin to those, the same way this
   fix did by hand.

   With that fixed, the full scripted two-turn conversation passed for
   real: turn one ("Say the single word: hello") produced a real
   streamed "hello" reply; turn two ("List the files in this directory
   using a tool call...") drove an actual tool call (a glob for `*`)
   against the scratch test cwd, which correctly returned the one
   fixture file present (`sample.txt`), and the assistant's follow-up
   text correctly described it — **with no approval prompt and no
   hang.** This answers Step 2's single biggest open risk: a tool call
   under the base profile's default `workspace-write`/`ask` policy
   resolves cleanly with no interactive answer needed in this context,
   contrary to the standing worry carried since Step 1. Clean exit 0
   after `/exit`. Test key deleted immediately after the run.

   **Session resume — proven live the same day, one real bug found and
   fixed first.** The first resume attempt (fresh process,
   `--resume session-<id>` from the completed conversation above) failed
   immediately: `session "..." already exists`. Root cause, confirmed
   against `@deepseek-ai/dsh-agent-loop`'s own source (the factory behind
   the injected `agents` service): **`create()` and `resume()` are two
   distinct methods, not one create-or-attach call** — `create()` always
   rejects if the session id is already persisted; only `resume()` loads
   it. Their option shapes differ too: `create()` takes `sessionId`,
   `resume()` takes `resumeSessionId` (matching the name our own startup
   service already used, by coincidence not intent). The scaffold had
   been calling `create()` unconditionally with the resumed id, which is
   why this was never going to work regardless of anything upstream.
   Fixed by branching: `resumeSessionId` present → `agents.resume(...)`,
   absent → `agents.create(...)` with a fresh id, same `agentOptions`/
   `setup` either way.

   Retested clean: a fresh process (`--resume` with the exact session id
   from the earlier conversation, no other state carried over) correctly
   recalled a fact planted in that earlier process — a session-only
   detail (a made-up code word) the model could only know from persisted
   session history, not general knowledge. Exit 0.

   All three of Plan 027's original Step-2 live-continuity requirements
   (two turns, one tool call, resume by exact ID) are now proven live
   against the real scaffold.

   **Observer/ingest wiring — DONE and live-verified, 2026-09-17.** Built
   directly into `dsh-terminal-app/src/index.js` itself rather than as a
   separate generated file (unlike Pi/OpenCode, this plugin already runs
   inside the target process with a live `ctx`, so no drop-a-file
   mechanism is needed) — but the wire contract is copied deliberately
   from `src-tauri/src/pi.rs`'s already-shipped, already-accepted
   extension: same `POST http://127.0.0.1:<port>/event`, same
   `Authorization: Bearer`/`X-Logic-Loop-Tab`/`X-Logic-Loop-Hook`/
   `X-Logic-Loop-Agent` headers (`X-Logic-Loop-Agent: deepseek`, not yet
   in `ingest.rs`'s `RECOGNIZED_AGENTS` allowlist — that's Step 3's Rust
   change, deliberately not made here), same fire-and-forget/2s-abort/
   swallow-errors discipline, same `command`/`file_path`/`description`
   tool-arg allowlist as a starting point. `SessionStart`/
   `UserPromptSubmit`/`Stop` are emitted directly at this file's own known
   lifecycle points (agent created/resumed, about to call `followup()`,
   after `whenIdle()` returns) rather than inferred from a session event —
   simpler and more reliable than Pi's own approach, since this plugin
   *is* the lifecycle driver, not an external observer of one.
   `PostToolUse` is the one genuinely event-driven row: `tool/call` and
   `tool/result` arrive via `ctx.on("session/event", ...)`, buffered by
   `callId` in a small map (same shape as Pi's `pendingTools`) since only
   `tool/result` carries the error outcome.

   Verified against a disposable local mock ingest server on an ephemeral
   port (`mock-ingest-server.mjs`, scratchpad-only) — critically, **not**
   the real dev app's ingest port, which was confirmed live and running
   at the time (`Logic Loop.app`, ~56 minutes uptime). Rather than write
   to the real `~/.context-terminal/ingest.env` (which would have raced
   with the live app), the test ran with `HOME` pointed at an isolated
   scratch directory — the same "isolated $HOME" pattern Plan 026's own
   Pi verification used — so `loadIngestEnv()` read a throwaway
   `ingest.env` and the real one was never touched or read.

   Two real bugs found and fixed by this live test, neither guessable
   from reading code alone:
   - **First run produced only 3 of the expected 6 events** (one full
     turn's worth), the process exiting after turn one instead of
     reaching the scripted tool-call turn. Root cause: an isolated,
     never-before-used `HOME` forces `npx` to cold-fetch the entire `dsh`
     CLI dependency tree fresh (visible via an interleaved "npm notice:
     new version available"), eating enough of the test's scripted
     timing budget that the second turn's input arrived late. Fixed the
     *test*, not the code: pre-warm the isolated `HOME`'s npx cache with
     a throwaway `--help` invocation before the timed run. Confirms
     nothing about the adapter itself was wrong.
   - **A real code bug**: the first successful full run's `PostToolUse`
     came back with `tool_input: {}` — empty — even though the tool
     call's underlying `command`/`pattern` field existed. Root cause:
     `tool/call`'s `arguments` field is the model's raw, accumulated
     JSON-text stream (confirmed against `@deepseek-ai/dsh-llm`'s
     `BlockAssembler`, which builds it via `+= chunk.argumentsDelta`) — a
     **string**, not a parsed object. `normalizeToolArgs()` was indexing
     a string by property name, which is always empty. Fixed by
     `JSON.parse`-ing first (swallowing a parse error to an empty result,
     never throwing). Re-verified clean: a real `bash` tool call's
     `command` field, and separately a real `glob` tool call's `pattern`
     field (added to the allowlist after this same live test showed
     `dsh-tool-fs-search`'s glob/grep tools key their argument `pattern`,
     not any of Pi's original three names — confirmed against that
     package's own `parameters` schema, not guessed), both came through
     correctly end to end: right headers, right `hook_event_name`
     sequence (`SessionStart` → `UserPromptSubmit` → `Stop` →
     `UserPromptSubmit` → `PostToolUse` → `Stop`), right `tool_input`.

   Mock server stopped and its scratch log/isolated-home directory left
   under the session scratchpad (not the repo, not `~/.context-terminal`).
   Step 2 is now fully complete: conversation, tool calls, resume, and
   observer wiring are all proven live. Remaining before a menu entry:
   Step 3 (Rust side — `deepseek.rs`, `RECOGNIZED_AGENTS` entry, resume
   command, checks) and Step 4 (live macOS matrix).

   Side note, unrelated to this plan: a `dsh web` process from the
   original Plan 027 research session was found still running (since
   that morning) against the real `~/.dsh`, not this plan's disposable
   directories. Killed at the maintainer's direction; real `~/.dsh` was
   not otherwise touched.
3. **Rust side — DONE 2026-09-17.** `src-tauri/src/deepseek.rs` (new,
   separate from `pi.rs`), following the same pure-function-plus-thin-
   command shape as every other adapter installer, adapted for the fact
   that this one orchestrates a real multi-step install (a `dsh` profile
   plus a copied, dependency-installed plugin package) instead of writing
   one file:

   - `deepseek_detect()`: PATH scan for `dsh`, matching every other
     adapter's own convention (detects the agent's own binary, not its
     runtime prerequisite) — an honest signal that most users will see
     as "not detected" until they globally install `@deepseek-ai/dsh`,
     consistent with Plan 027's own finding that no global install exists
     by default. `deepseek_hooks_setup()` does **not** gate on this
     signal — it falls back to the `npx --yes @deepseek-ai/dsh`
     invocation Plans 027/028 already proved works with no global
     install, so setup still succeeds for the typical case detect()
     honestly reports as "not detected".
   - `deepseek_hooks_setup(app)`: mirrors the live-proven manual sequence
     exactly, no handling added for a scenario that sequence didn't
     actually hit (a missing `pnpm`, a corrupt prior install, a
     mid-install network failure — explicitly declined per the
     maintainer's own scope choice for this step). In order: materialize
     the `logic-loop` profile from the `headless` template if absent (a
     cheap `--help` boot still runs the full plugin-tree install first,
     proven live); read this profile's actual resolved versions for all
     9 core `@deepseek-ai/*` packages from its shared
     `profiles/node_modules` tree (not hardcoded — the exact fix an
     unpinned `*` range needed live); resolve the bundled
     `dsh-terminal-app` resource via Tauri's documented
     `resolve(..., BaseDirectory::Resource)` (works under `tauri dev`,
     confirmed against Tauri's own docs via `find-docs`, not only a
     built app bundle — the maintainer's explicit choice over deferring
     real resource packaging); run `dsh plugin add -w <resource>`; then
     replace the symlink it leaves with a real recursive copy (the
     `--preserve-symlinks`-breaks-pnpm's-own-store finding from Step 2);
     pin the copy's core dependency versions to what was just resolved;
     `npm install --legacy-peer-deps` inside it. A foreign-directory
     guard (mirroring `pi.rs`'s own `is_ours` protection) refuses to
     touch a `dsh-terminal-app` plugin directory that exists but isn't
     ours.
   - `deepseek_hooks_remove()`/`deepseek_hooks_status()`: same
     marker-field pattern as every other adapter, keyed on a
     `logicLoopAdapterVersion` field added to the bundled
     `dsh-terminal-app/package.json` itself (the closest equivalent to
     `pi.rs`'s embedded-string marker, since this plugin is a real
     multi-file package, not a single generated file).
   - `tauri.conf.json`'s `bundle.resources` now maps `dsh-terminal-app`'s
     six source files individually (package.json, cordis.patch.yml,
     LICENSE, README.md, src/index.js, src/startup.js) — an explicit map,
     not a glob, specifically so `node_modules`/`package-lock.json` can
     never be accidentally swept into the shipped app regardless of what
     happens to exist on the build machine's disk at build time.
   - `pty.rs`'s `resume_command` gets a `deepseek` arm using the same
     `npx --yes @deepseek-ai/dsh --profile logic-loop --resume <id>`
     invocation, not a bare `dsh` — a bare binary would silently fall
     through to a plain shell for most users, the same npx-first reality
     `deepseek_detect()`'s comment explains.
   - `RECOGNIZED_AGENTS` (ingest.rs), `AdapterId`/`ADAPTERS`/
     `adapterIdForHook` (onboarding.ts), `ADAPTER_ACTIONS` + the render
     list (AgentStatusBar.tsx), and the TS wrapper functions
     (ingest.ts) all extended, mirroring Pi's own cross-file wiring
     shape exactly. `scripts/deepseek-check.ts` (mirroring
     `pi-check.ts`'s structure) plus updates to `pi-check.ts`'s own
     `RECOGNIZED_AGENTS` regex (widened, no longer pinned to exactly 4
     entries) and `onboarding-check.ts`'s pinned `ADAPTERS` list.

   Gates clean: `cargo test --lib` 89/89 (9 new deepseek.rs tests, all
   on the pure functions — version-pinning rewrite, marker/version
   detection — since the actual install sequence's live correctness is
   Step 4's job, same precedent as every prior adapter), `cargo clippy
   --all-targets -- -D warnings`, `npm run check` 29/29, `tsc --noEmit`,
   production build, `git diff --check`. Not yet run: the installer's own
   first live execution through the real Tauri command (Step 4).
4. Live macOS matrix (own `docs/TESTING.md` section): toggle on/off,
   spawn a tab, multi-turn conversation, tool-call detail rendering,
   quit/relaunch session continuity, two tabs same cwd, disable-while-
   running, foreign-config-file error path. Same bar Pi's Step 5 is held
   to.

## Scope, verification, and stop conditions

In scope: the new adapter files listed above, its own installer/removal
path, its own tests, its own `docs/TESTING.md` section. Out of scope:
touching `pi.rs`, Pi's extension file, or any of Plan 026's tests — a
shared normalized ingest contract is fine to reuse, shared code ownership
is not.

Automated gates before any phase is reported done: `npm run check`
(including the new `deepseek-check.ts`), `tsc --noEmit`, production
build, `cargo test`, `cargo clippy --all-targets -- -D warnings`,
`git diff --check`. No `npm run golden` change expected unless decision/
blocker extraction is added for this adapter (not currently planned —
mirrors Pi's non-goal here).

**Stop and revert to DEFER** if Step 0 finds neither `headless` nor
`sdk-minimal` supports genuine interactive multi-turn use from a plain
terminal, if `session/event` turns out not to deliver reliably in that
profile, or if exact session ID / resume-by-ID cannot be proven live —
same bar Plan 027 already set. Do not fall back to embedding the Web
profile in a terminal or scraping its output.
