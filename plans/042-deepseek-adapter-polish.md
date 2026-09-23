# Plan 042: Polish the DeepSeek adapter — non-blocking install + a readable dsh terminal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan, `plans/README.md`, `docs/TESTING.md`, and
> `docs/PROGRESS.md` with actual evidence.
>
> **Phase gate**: This is a CANDIDATE sprint, not authorization. It proposes a
> new phase number, but the maintainer assigns that. Implementation must not
> begin until the maintainer copies the accepted scope into `PLAN.md` and
> writes the literal token `PHASE N ACCEPTED` (per `AGENTS.md`/`CLAUDE.md`).
> Planning and drift-checking this file are allowed before that.
>
> **Drift check (run first)**:
> `git diff --stat aca37cb..HEAD -- dsh-terminal-app src-tauri/src/deepseek.rs src-tauri/src/statusline.rs src-tauri/tauri.conf.json scripts/deepseek-check.ts scripts/deepseek-transcript-check.ts package.json docs/TESTING.md docs/PROGRESS.md plans/README.md`
> Part 0 already landed on `main` as `50fddd9`, so
> `dsh-terminal-app/src/index.js`, `dsh-terminal-app/package.json`,
> `src-tauri/src/deepseek.rs`, and `scripts/deepseek-check.ts` are expected to
> differ from `aca37cb` (adapter is now v4). Treat those as done; on any other
> mismatch, compare against the "Current state" excerpts and STOP.

## Status

- **Priority**: P1 — adapter polish and two real bugs (release-relevant; the
  freeze is the failure class Plan 017 fixed, the type-ahead leak corrupts the
  live reply, and the terminal surface is the product).
- **Effort**: M — ~1 focused build day: Part 0 (type-ahead) is the risky part,
  Part A (freeze) is ~1 hour, Part B (styling) is the rest.
- **Risk**: MED — Part 0 changes when readline reads stdin and must preserve
  submit/exit behavior; Part A is a mechanical `spawn_blocking` conversion (low
  risk); Part B edits a live PTY display path, must not change the extraction
  path, and every new formatting function must be byte-preserving apart from
  added SGR.
- **Depends on**: current approved phase's literal acceptance; clean `main`.
- **Category**: bug (Part 0 + Part A) + direction/polish (Part B).
- **Planned at**: commit `aca37cb`, 2026-09-22.
- **Part 0 outcome**: **LIVE-VERIFIED 2026-09-22** — merged to `main` as
  `50fddd9` (fast-forward; adapter v4). Typing during a streaming reply no
  longer leaks into the reply; the queued text appears once at the brand prompt
  behind the dim `· working — typing is queued…` hint. The first test attempt
  ran the still-installed v3 plugin and reproduced the old behavior; the fix
  only took effect after an Enable redeploy moved the profile to v4 and a fresh
  tab was opened. Parts A (freeze) and B (presentation) remain.
- **Parts A/B outcome**: **DONE / LIVE-VERIFIED 2026-09-22**; merged to `main`
  at `31c65a0` (Part A `05bd09d`, Part B `31c65a0`), adapter v5. All automated
  gates re-run clean by the reviewer: focused checks, `npm run check`, `tsc`,
  `npm run build`, 139 Rust tests, clippy, `git diff --check`. Part B shipped
  Tier 2 (fence styling). The maintainer confirmed v5 works and is a serious
  readability improvement. Only doc records remain (`docs/TESTING.md` manual
  entry + before/after captures, `docs/PROGRESS.md` line); Part A's
  no-beachball behavior during Enable was not separately confirmed.

## Why this matters

Three problems in one first-party adapter, in priority order:

0. **Typing while the agent is working leaks into the reply, uncolored.** The
   2026-09-22 10.31.48 / 10.32.03 PM captures show a reply with the user's typed
   keystrokes woven into it character-by-character in the same white as the
   assistant text (e.g. `...didn't change color anLet me clean up the staged
   screenshots t`), and then the same text appearing again at the next prompt.
   Cause: the runner only calls `rl.question()` between turns, but the readline
   `Interface` keeps consuming and echoing stdin for the whole session. During
   `await agent.whenIdle()` there is no active prompt, so readline echoes bare
   keystrokes with no `> ` and no color into the same stdout the assistant
   `agent/assistant-stream` is writing to. This is the bug to fix in this pass:
   queued input must not be written into the live reply, and when it appears it
   must be in the brand color.
   **Dropped from this pass:** the one-frame query duplication in the
   10.19.20 PM capture is attributed to a window resize during the turn. It
   looks agent-agnostic (xterm/PTY resize redraw of wrapped readline input, not
   dsh-specific) and is listed as out of scope below; it should get its own
   investigation.

1. **Enabling DeepSeek can beachball the whole app.** `deepseek_hooks_setup`
   is a plain (`pub fn`) Tauri command, so Tauri v2 runs it on the app's
   main/event-loop thread. It shells out to `dsh` and then
   `npm install --legacy-peer-deps` — network operations that can take
   minutes. This is exactly the freeze class Plan 017 root-caused for
   `git_*`/`read_board` (see the `spawn_blocking` helpers in `pty.rs:10-38`).
   The DeepSeek adapter reintroduced it.

2. **The dsh reply text is hard to read.** `dsh-terminal-app/src/index.js` is
   Logic Loop's first-party interactive runner. It colors the user's input
   brand-blue but streams the assistant's reply as raw terminal-default
   foreground (xterm's default `#ffffff`) with no turn framing, no code
   styling, and no sanitization of model text. The three screenshots from the
   original request were macOS `screencapture` temp files and had already been
   deleted, so Step 0c re-captures the current rendering too. Part B is safe to
   ship once the type-ahead leak is fixed.

**Hard boundary**: Part B changes only what the runner *prints*. It must never
touch what the runner *reports*. Semantic data still flows exclusively through
`postEvent` / `postTranscriptLine` / `assistantMessagesSince` /
`visibleText` (structured events). Never parse PTY or stdout for meaning
(invariant #1); sanitizing and styling output the runner is about to print is
display work, not parsing.

## Current state

Repo root: `/Users/vandershark/Desktop/dev/context_terminal`.

- `dsh-terminal-app/src/index.js` (401 lines) — the first-party dsh runner.
  - `:34-35` — `const USER_BLUE = "\x1b[38;2;77;106;254m"; const RESET = "\x1b[0m";`
  - `:221-270` — `streamAssistantText(ctx, agent, stdout)`: writes `chunk.text`
    directly to `stdout` on `text-delta`, no color, no sanitization. `close()`
    only ensures a trailing newline.
  - `:340-354` — startup banner and prompt:
    `io.stdout.write(`dsh terminal — session ${sessionId}\n`)`;
    `line = await rl.question(`${USER_BLUE}> `, ...)`; then
    `io.stdout.write(`${RESET}\n`)`.
  - `:281-291` — `reportTurnError` writes `dsh: ${code}: ${message}` raw to
    stderr.
  - `:183-210` — `observeToolCalls` posts `PostToolUse` but prints nothing.
  - `:366-375` — post-idle scan posts committed assistant messages and then
    `io.stdout.write("\n")` after each turn.
- `dsh-terminal-app/src/messages.js` (36 lines) — pure extraction reducers
  (`visibleText`, `assistantMessagesSince`). **Do not change its behavior.**
- `dsh-terminal-app/package.json:7` — `"logicLoopAdapterVersion": 3`.
- `src-tauri/src/deepseek.rs`:
  - `:16` — `const DEEPSEEK_ADAPTER_VERSION: u64 = 3;`
  - `:210-211` — `#[tauri::command] pub fn deepseek_hooks_setup(app: AppHandle) -> Result<(), String>`
    (sync; calls `run()` at `:232-235`, `:259-262`, and `npm install` at
    `:289-298` via blocking `Command::output()`).
  - `:326-337` — `deepseek_hooks_status` checks the marker plus
    `src/index.js`, `src/messages.js`, `src/startup.js` exist.
  - `#[cfg(test)]` fixtures: `OWNED` has version `3`, `STALE` has `2`.
- `src-tauri/src/statusline.rs:217-229` — `claude_statusline_status` is also a
  sync command; `claude_binary_path()` → `cli_version_ok()` (`:196-202`) runs
  `claude --version` on the main thread.
- `src-tauri/src/pty.rs:21-38` — the existing helpers to reuse:
  `spawn_blocking_or_default` and `spawn_blocking_result(label, f)`.
- `src-tauri/tauri.conf.json:37-45` — explicit `bundle.resources` list; every
  bundled dsh-terminal-app file must be listed here (the installer copies only
  what is in `resource_dir`).
- `scripts/deepseek-check.ts` — structural characterization; hardcodes
  `DEEPSEEK_ADAPTER_VERSION: u64 = 3` (`:11`) and
  `bundledPackage.logicLoopAdapterVersion === 3` (`:14`), and asserts which
  dsh-terminal-app files are bundled (`:59-72`).
- `scripts/deepseek-transcript-check.ts` — behavioral tests for
  `messages.js` + the `deepseek_message` envelope, plus a source-order
  contract (`:93-100`). This file must keep passing unchanged.
- `package.json` — `deepseek:check` and `deepseek-transcript:check` are wired
  into the aggregate `check` script.

Repo conventions to match:

- Pure, side-effect-free logic lives in exported JS helpers and is tested by a
  `scripts/*-check.ts` file run under `tsx` (`messages.js` +
  `deepseek-transcript-check.ts` is the exemplar — model the new module on it).
- `tsconfig.json` includes only `src`, so `dsh-terminal-app` stays plain JS;
  check scripts import it directly.
- Rust blocking work goes through `crate::pty::spawn_blocking_result`.
- Conventional commits, e.g. `fix(deepseek): run adapter install off the main thread`.

## Presentation spec (Part B)

Use 24-bit SGR constants only (no new dependency). Logic Loop's terminal
background is `#1e2127` (`src/components/Terminal.tsx:36`).

| Token | Hex | SGR | Use |
|---|---|---|---|
| `brand` | `#4d6afe` | `\x1b[38;2;77;106;254m` | user prompt, assistant gutter marker |
| `text` | `#dbe2ec` | `\x1b[38;2;219;226;236m` | assistant prose (replaces harsh `#ffffff`) |
| `code` | `#9cdcfe` | `\x1b[38;2;156;220;254m` | fenced code content |
| `dim` | `#7b8695` | `\x1b[38;2;123;134;149m` | separators, tool lines, usage, hints |
| `error` | `#f87171` | `\x1b[38;2;248;113;113m` | turn errors |
| `reset` | — | `\x1b[0m` | close every styled span |

Behavior rules:

1. **Color gate.** Emit SGR only when `stdout.isTTY` is truthy, `NO_COLOR` is
   unset/empty, and (if set) `FORCE_COLOR` is not `0`. Otherwise emit plain
   text. Today the runner emits SGR unconditionally, which corrupts piped
   output — the gate fixes that too.
2. **Assistant reply framing.** Print a blank line, then a brand-colored gutter
   marker (`\x1b[38;2;77;106;254m▌\x1b[0m `) at the start of the first visible
   text of each reply; print assistant prose in `text`. End the reply with
   `reset` and one blank line. Never print a marker for a tool-only or
   reasoning-only turn.
3. **Sanitize every untrusted string before printing** (assistant text, tool
   names, error messages): strip ESC/CSI/OSC sequences and every C0/C1 control
   character except `\n` and `\t` (CR is removed). This prevents model text
   from moving the cursor, recoloring, or overwriting earlier output — a
   readability *and* display-integrity fix for untrusted content.
4. **Errors** print as `error dsh: <sanitized>` on stderr.
5. **Usage line (optional, only if a `usage` chunk is observed):** one dim line
   after the reply, e.g. `· tokens in <n> / out <n>`; omit entirely when the
   chunk is absent.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused adapter check | `npm run deepseek:check` | exit 0 |
| New format check | `npm run deepseek-format:check` | exit 0 |
| Envelope/parse check | `npm run deepseek-transcript:check` | exit 0 |
| Aggregate frontend | `npm run check` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Rust tests | `cd src-tauri && cargo test --lib` | all pass |
| Rust lints | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | exit 0 |
| Whitespace | `git diff --check` | no output |

Do **not** run `npm run golden` — no extraction prompt changes.

## Scope

**In scope** (the only files to modify/create):

- `dsh-terminal-app/src/format.js` (new)
- `dsh-terminal-app/src/index.js`
- `dsh-terminal-app/package.json`
- `src-tauri/src/deepseek.rs`
- `src-tauri/src/statusline.rs`
- `src-tauri/tauri.conf.json`
- `scripts/deepseek-check.ts`
- `scripts/deepseek-format-check.ts` (new)
- `scripts/statusline-check.ts` (Part A async assertion only)
- `package.json` (add the `deepseek-format:check` script + aggregate entry)
- `docs/TESTING.md`, `docs/PROGRESS.md`, `plans/README.md`, this plan

**Out of scope** (do NOT touch, even if related):

- `dsh-terminal-app/src/messages.js`, `src/lib/decisions.ts`,
  `src-tauri/src/ingest.rs`, the extractor, or any prompt/schema — Part B must
  not change extraction semantics.
- Any other adapter (`pi.rs`, `opencode.rs`, `antigravity.rs`, Claude/Codex).
- `src/components/Terminal.tsx`'s xterm theme/font, or any app-wide styling —
  the fix is scoped to the dsh runner.
- The 2026-09-22 10.19.20 PM one-frame query duplication (window resize during a
  turn). It appears agent-agnostic (PTY/xterm resize redraw of wrapped readline
  input) and needs its own investigation; do not fix it here.
- New npm dependencies or markdown/ANSI-parsing libraries.
- Reading/parsing PTY output for meaning.
- Database/migrations, `src/lib/repo.ts`.

## Git workflow

- Branch from clean `main`, e.g. `feat/deepseek-adapter-polish`.
- Three commits are appropriate: Part 0 (type-ahead), Part A (freeze), Part B
  (display). Use conventional messages, e.g.
  `fix(deepseek-tui): keep type-ahead out of the reply`,
  `fix(deepseek): run adapter install off the main thread`, and
  `feat(deepseek-tui): add readable, sanitized terminal presentation`.
- Do not push or open a PR unless instructed.

## Steps

### Step 0a: Reproduce and confirm the type-ahead leak

1. Add a temporary, env-gated stream mirror to `dsh-terminal-app/src/index.js`
   (`LOGIC_LOOP_TRACE=1`) that **patches the stream methods**, not the runner's
   call sites: wrap `io.stdout.write` and `io.stderr.write` so every write —
   including readline's own echo — is both passed through and appended,
   timestamped and control-escaped (`\r` → `\\r`, `\x1b` → `\\e`,
   `\n` → `\\n`), to `~/.context-terminal/dsh-trace.log`. Patching only the
   runner's explicit writes would miss readline's echo entirely. Remove the
   mirror before the final commit.
2. In a real tab, send a prompt whose reply streams for several seconds, then
   type `hello` while the reply is still being written. Record what happens and
   confirm both halves of the symptom:
   - `hello` (or a partial) is echoed white into the middle of the assistant
     text, character-by-character (the 10.31.48 PM artifact);
   - the same keystrokes appear again at the next `> ` prompt.
3. Confirm from the trace that the interleaved bytes are readline's no-prompt
   echo (bare keystrokes written between `agent/assistant-stream` chunks), not a
   runner write. That fixes the remedy: stop readline consuming input while the
   assistant owns stdout, rather than changing the assistant writer.

**Verify**: `docs/TESTING.md` records the trace and a capture of the
interleaving; extraction behavior is unchanged.

### Step 0b: Defer and color type-ahead

Implement in `dsh-terminal-app/src/index.js`:

1. **Pause readline for the duration of the agent turn.** Immediately after a
   non-empty line is submitted (after `UserPromptSubmit` and `agent.followup`),
   call `rl.pause()`. While paused, readline does not read stdin, so it cannot
   echo keystrokes into the reply; the PTY buffers them. At the top of the next
   iteration, set up the question first and then resume:
   ```js
   const answer = rl.question(PROMPT); // sets the prompt/line state
   rl.resume();                        // now buffered type-ahead renders at the prompt
   line = await answer;
   ```
   Calling `resume()` after `question()` closes the window where buffered bytes
   could be echoed with no prompt. `await agent.whenIdle()` and the transcript
   posts then run with readline paused.
2. **Keep the brand-colored prompt** so the deferred input appears once, in
   blue, prefixed `> ` (Part B formalizes the palette as `SGR.brand`; the
   existing `${USER_BLUE}> ` prompt color is enough for this step).
3. **Give one-line feedback that input is queued**, because echo is deferred
   while working. On the first turn where readline is paused, write a single dim
   line, e.g. `· working — typing is queued until this reply finishes`. Do not
   try to update it per keystroke: readline is paused, so the runner cannot see
   the keys without a full TUI, and one line is the agreed scope.
4. **Preserve today's exit/submit behavior.** A queued newline must submit the
   next turn; Ctrl-C/Ctrl-D still exit or clear at the prompt; an empty queued
   line is ignored exactly as now. If `rl.pause()`/`resume()` around
   `readline/promises.question` proves broken (the trace shows no prompt after
   resume), STOP and report rather than replacing the whole input path in this
   pass.

**Verify**: typing during a streaming reply produces no white interleaving and
no duplicate echo; the text appears once, in brand color, at the next prompt;
`npm run deepseek-transcript:check` exits 0 (extraction ordering unchanged).

### Step 0c: Capture the styling baseline

In a real tab, run one prompt that produces (a) a prose paragraph and (b) a
fenced code block, and capture the before state so Part B's improvement is
demonstrable.

**Verify**: a capture exists and is recorded in `docs/TESTING.md`.

### Step 1: Run the DeepSeek profile install off the main thread (Part A)

In `src-tauri/src/deepseek.rs`, rename the existing body to a private blocking
function and make the command `async`:

```rust
#[tauri::command]
pub async fn deepseek_hooks_setup(app: AppHandle) -> Result<(), String> {
    crate::pty::spawn_blocking_result("deepseek_hooks_setup", move || {
        deepseek_hooks_setup_blocking(&app)
    })
    .await
}

fn deepseek_hooks_setup_blocking(app: &AppHandle) -> Result<(), String> {
    // ...existing body of the old deepseek_hooks_setup, unchanged...
}
```

Keep the foreign-directory guard, `pin_core_versions`, symlink replacement,
`copy_dir_recursive`, GUI PATH fix, and `--legacy-peer-deps` exactly as they
are. Do not change `deepseek_hooks_remove`, `deepseek_hooks_status`, or
`deepseek_detect` (they only touch fs/PATH).

**Verify**: `cd src-tauri && cargo check` exits 0; `cargo clippy --all-targets -- -D warnings` exits 0.

### Step 2: Same treatment for the Claude statusline probe (secondary)

`src-tauri/src/statusline.rs:217-229`'s `claude_statusline_status` runs
`claude --version` on the main thread. Apply the same split:

```rust
#[tauri::command]
pub async fn claude_statusline_status() -> Result<StatuslineStatus, String> {
    crate::pty::spawn_blocking_result("claude_statusline_status", claude_statusline_status_blocking).await
}
```

Leave `claude_statusline_setup`/`remove` unchanged (no subprocess).

**Verify**: `cd src-tauri && cargo test --lib` passes; `cargo clippy --all-targets -- -D warnings` exits 0.

### Step 3: Add the pure formatting module

Create `dsh-terminal-app/src/format.js` exporting:

1. `SGR` — the palette table from "Presentation spec" as string constants.
2. `shouldUseColor({ isTTY, noColor, forceColor })` — pure; returns a boolean.
   Truth table: `forceColor === "0"` → false; `noColor` non-empty → false;
   `isTTY` falsy → false; otherwise true.
3. `sanitizeForTerminal(text)` — returns a string with OSC (`ESC ] ... BEL` or
   `ESC \`), CSI (`ESC [ ... final-byte`), and two-byte ESC sequences removed,
   and all C0/C1 controls except `\n` (`\x0a`) and `\t` (`\x09`) removed.
   `String(text)` first so non-strings never throw.
4. `paint(text, sgr, enabled)` — returns `text` when `!enabled`, else
   `sgr + text + SGR.reset`. Never double-append a reset.
5. `createStyler(enabled)` — fence-aware stream styler used in Step 5. Provide
   this in Step 3 but wire it in Step 5. Contract:
   - `push(text) -> string` returns SGR-wrapped output for that delta.
   - `flush() -> string` emits any held partial line and resets.
   - **Byte-preservation invariant**: with all SGR sequences stripped, the
     concatenation of every `push`/`flush` return value equals the concatenation
     of every input exactly (no characters added, dropped, or reordered).
   - Fence rule: a line whose first non-space characters are three backticks
     toggles fenced mode; fenced content is painted `SGR.code`, the fence
     markers themselves `SGR.dim`, everything else `SGR.text`. Holding a
     fence-candidate prefix (leading spaces + up to three backticks) is
     permitted; holding more than that is not.

**Verify**: `npm run deepseek-format:check` exits 0 (Step 4 adds the script).

### Step 4: Wire the format check

Create `scripts/deepseek-format-check.ts` (model on
`scripts/deepseek-transcript-check.ts`'s import style, importing from
`../dsh-terminal-app/src/format.js`) and assert:

- `shouldUseColor` for: `{isTTY:true}` → true; `{isTTY:true,noColor:""}` → true;
  `{isTTY:true,noColor:"1"}` → false; `{isTTY:false}` → false;
  `{isTTY:true,forceColor:"0"}` → false.
- `sanitizeForTerminal` removes `\x1b[31m`, `\x1b]0;title\x07`, `\x1b[2K`,
  `\r`, `\x00`, and a C1 `\x9b`, while preserving `"a\nb\tc"` exactly.
- `paint("x", SGR.text, true)` starts with `SGR.text` and ends with `SGR.reset`;
  `paint("x", SGR.text, false) === "x"`.
- `createStyler(true)`: feed a sample containing a fenced block; assert the
  concatenated output (a) contains `SGR.code` inside the fence, (b) contains
  `SGR.text` outside it, and (c) `output.replace(/\x1b\[[0-9;]*m/g, "")`
  equals the input exactly. Run the same byte-preservation assertion with
  `createStyler(false)`.
- `SGR.brand === "\x1b[38;2;77;106;254m"`.

Add to `package.json`:
`"deepseek-format:check": "tsx scripts/deepseek-format-check.ts"`, and insert
`npm run deepseek-format:check &&` immediately after
`npm run deepseek-transcript:check &&` in the aggregate `check` script.

**Verify**: `npm run deepseek-format:check` exits 0; `npm run check` exits 0.

### Step 5: Wire Tier-1 presentation into the runner

Edit `dsh-terminal-app/src/index.js`:

1. Import `SGR`, `shouldUseColor`, `sanitizeForTerminal`, `paint`, and
   `createStyler` from `./format.js`. Delete the local `USER_BLUE`/`RESET`
   literals; use `SGR.brand`/`SGR.reset`.
2. In `run()`, compute `const color = shouldUseColor({ isTTY: io.stdout.isTTY, noColor: process.env.NO_COLOR, forceColor: process.env.FORCE_COLOR });`
   and thread it into the banner, prompt, and `streamAssistantText`.
3. Banner: print the first line in `SGR.brand` and the hint line in `SGR.dim`
   (all through `paint`).
4. In `streamAssistantText`:
   - On the **first** `text-delta` of a reply, print one blank line, then
     `paint("\u258c", SGR.brand, color) + " "` as the gutter marker, then open
     `SGR.text`. Do not print the marker for reasoning-only/tool-only replies.
   - Sanitize `chunk.text` before writing. The first sanitized delta opens the
     `SGR.text` span; `close()` writes `SGR.reset` and (as today) a newline only
     when one is missing.
   - **Do not** change the ordering or content of `postEvent` calls.
5. Errors: `reportTurnError` writes
   `paint("dsh: " + sanitizeForTerminal(`${code}: ${message}`), SGR.error, color) + "\n"`.
6. Keep the existing `io.stdout.write("\n")` turn separator, or make it a blank
   line consistent with rule 2 — either is acceptable, but the user/assistant
   turns must be visually separated.

**Verify**: `npm run deepseek-transcript:check` still exits 0 (the source-order
contract at `:93-100` is unchanged); `npx tsc --noEmit` exits 0.

### Step 6: Fenced-code styling (Tier 2)

Replace the direct write of sanitized text with `createStyler(color)`:

- `styler.push(sanitizedDelta)` for each `text-delta`.
- `styler.flush()` inside `close()`.
- Ensure `close()` still appends a newline only when the reply did not end with
  one, and still resets SGR.

If any byte-preservation assertion fails, or if fence detection visibly
mangles a real code block, STOP and report — do not ship a lossy renderer.
Fenced-code styling is the lowest-priority item here; Tier 1 alone is
acceptable if this step is unstable.

**Verify**: `npm run deepseek-format:check` exits 0; a real DeepSeek reply with a
fenced code block renders with distinct code coloring and identical characters.

### Step 7: Version, bundle, and status plumbing

**Version note (2026-09-22):** Part 0 was built first on `exec/042-part0` and
claimed adapter version **4** (both `logicLoopAdapterVersion` and
`DEEPSEEK_ADAPTER_VERSION`, plus the `OWNED`/`STALE` fixtures and
`scripts/deepseek-check.ts`). Part B changes `src/index.js` again, so whatever
executes Parts A/B must bump to **5**, not to 4, or an already-redeployed v4
profile will never be seen as stale. Parts A/B did exactly that; confirm the
live current values before editing (the numbers below assume the post-Part-0
value is 4).

The installed profile must be detected as stale so Enable redeploys it.

1. `dsh-terminal-app/package.json`: `logicLoopAdapterVersion` **4 → 5**.
2. `src-tauri/src/deepseek.rs`: `DEEPSEEK_ADAPTER_VERSION` **4 → 5**.
3. `src-tauri/src/deepseek.rs` `deepseek_hooks_status`: also require
   `dir.join("src/format.js").is_file()`.
4. `src-tauri/tauri.conf.json` `bundle.resources`: add
   `"../dsh-terminal-app/src/format.js": "dsh-terminal-app/src/format.js"`.
5. `scripts/deepseek-check.ts`: update the two hardcoded `4`s to `5`; add
   `src/format.js` to the bundled-file loop; assert `deepseek_hooks_status`
   checks `src/format.js`; and assert Part A:
   `assert.match(rust, /pub async fn deepseek_hooks_setup/)` and
   `assert.ok(rust.includes('spawn_blocking_result("deepseek_hooks_setup"'))`.
6. `src-tauri/src/deepseek.rs` tests: update `OWNED` to version `5` and `STALE`
   to version `4`. Keep the semantics (owned-stale vs owned-current).
7. `scripts/statusline-check.ts`: add an analogous async assertion for
   `claude_statusline_status` (inspect the file for its existing style first;
   if it has no source-structure assertions, add one minimal match rather than
   restructuring it).

**Verify**: `npm run deepseek:check` and `npm run statusline:check` exit 0;
`cd src-tauri && cargo test --lib` passes.

### Step 8: Live evidence, docs, final gates

1. Rebuild/relaunch. Enable DeepSeek on a profile: the UI must stay responsive
   (no beachball) throughout `npm install`; the status flips to current.
2. Run the Step 0a type-ahead check again plus a real turn with prose + a fenced
   code block; capture the new rendering and compare with Step 0c's capture.
3. Record both in `docs/TESTING.md` with the build SHA and platform, the Harness
   version, and honestly mark anything unrun.
4. Add a `docs/PROGRESS.md` entry (append-only) and a `plans/README.md` row.
5. Run the full gate list from "Commands you will need".

**Verify**: all gates exit 0 and `git status --short` shows only in-scope files.

## Test plan

- **New** `scripts/deepseek-format-check.ts`: `shouldUseColor` truth table,
  `sanitizeForTerminal` escape/control removal + preservation of `\n`/`\t`,
  `paint` on/off, fence-classification + byte-preservation for
  `createStyler(true|false)`, and the brand constant.
- **Extended** `scripts/deepseek-check.ts`: adapter version 5 in both places,
  `src/format.js` bundled and required by status, async `deepseek_hooks_setup`
  routed through `spawn_blocking_result`.
- **Unchanged** `scripts/deepseek-transcript-check.ts` must stay green — it is
  the guard that Part B did not touch extraction ordering or the envelope.
- **Rust**: updated `OWNED`/`STALE` fixtures; existing installer, identity, and
  detection tests unchanged.
- **Manual**: type-ahead-during-streaming check (no interleaving; appears once,
  in brand color, at the next prompt); responsive Enable; before/after rendering
  capture.

## Done criteria

Machine-checkable; ALL must hold:

- [x] `npm run deepseek:check` exits 0 with version-5 assertions.
- [x] `npm run deepseek-format:check` exits 0.
- [x] `npm run deepseek-transcript:check` exits 0 (unchanged semantics).
- [x] `npm run check` exits 0 (includes the new script).
- [x] `npx tsc --noEmit` exits 0.
- [x] `npm run build` exits 0.
- [x] `cd src-tauri && cargo test --lib` passes (139/139); `cargo clippy --all-targets -- -D warnings` exits 0.
- [x] `git diff --check` is clean; no file outside Scope is modified.
- [x] Typing during a streaming reply does not interleave into the reply and
  appears once, in brand color, at the next prompt — confirmed live by the
  maintainer after the v4 redeploy (the Step 0a trace instrumentation was
  deliberately skipped; the screenshots are the evidence).
- [ ] Recorded in `docs/TESTING.md`: the manual type-ahead/rendering matrix and
  before/after captures. **Outstanding — doc-only; Step 8 was skipped.**
- [ ] The Enable action was observed not to block the UI. **Not separately
  confirmed** — the v5 redeploy completed and the maintainer reported success,
  but a freeze during install was not explicitly checked.
- [x] `logicLoopAdapterVersion` and `DEEPSEEK_ADAPTER_VERSION` are both 5.

## STOP conditions

Stop and report (do not improvise) if:

- The code at the "Current state" locations does not match the excerpts
  (baseline drifted).
- The type-ahead leak cannot be reproduced, or `rl.pause()`/`resume()` around
  `readline/promises.question` cannot be made to work (the trace shows no prompt
  after resume). Capture the trace and report rather than replacing the whole
  input path in this pass. Adding a new dependency is always a stop.
- Styling seems to require changing `src/components/Terminal.tsx`'s theme,
  `messages.js`, `decisions.ts`, `ingest.rs`, or any extraction path.
- A pure formatting function cannot preserve characters byte-for-byte
  (fence handling in particular) after one reasonable fix attempt.
- A new dependency, a markdown renderer, or ANSI/PTY parsing seems necessary.
- `cargo clippy` rejects the async conversion, or `AppHandle`/`StatuslineStatus`
  turns out not to be `Send`.
- A gate fails twice after one focused fix, or another adapter regresses.

## Maintenance notes

- Every future `dsh-terminal-app` change must bump
  `logicLoopAdapterVersion` **and** `DEEPSEEK_ADAPTER_VERSION` together, add any
  new file to `tauri.conf.json` `bundle.resources` and to
  `deepseek_hooks_status`, and extend `scripts/deepseek-check.ts`. An installed
  profile only redeploys through the explicit Enable action.
- **Live-testing a runner change is a three-step deploy, not just a rebuild.**
  (1) Run the build that carries the new `DEEPSEEK_ADAPTER_VERSION`. (2) Toggle
  the adapter so Enable copies the new plugin into
  `~/.dsh/profiles/logic-loop/node_modules/dsh-terminal-app` (verify the
  installed `package.json` marker and that `src/index.js` contains the change —
  `grep -n "rl.pause()" …/src/index.js`). (3) Open a **fresh** tab: a running
  `dsh` process keeps its already-loaded plugin code, so an old or re-entered
  tab still runs the previous version (same caveat as OpenCode adapter bumps,
  `src/lib/onboarding.ts`). The 2026-09-22 10.55.45 PM attempt failed only
  because step 2/3 were skipped — the installed marker was still `3`.
- `format.js` is display-only. If a future change makes it feed extracted text,
  that is a bug — extraction reads structured session events, never rendered
  output.
- The fence styler is heuristic by design; keep the byte-preservation test as
  its contract. If DeepSeek starts emitting exotic markdown, prefer degrading to
  plain `SGR.text` over guessing.
- If the assistant color later needs tuning, change only `SGR.text`; do not
  reintroduce unconditional SGR (keep the TTY/`NO_COLOR` gate so piped output
  stays clean).
- Part 0 defers type-ahead by pausing readline for the turn. Known edge case:
  if more than one complete line is queued during a turn, only the first
  submits the next prompt and the rest may be dropped because the runner has no
  interface-level `line` listener. Single-line type-ahead is the supported
  case; revisit with a real queue if multi-line queuing is ever wanted.
- Deferred on purpose: syntax highlighting, tables, inline bold/italic, a
  persistent status line, and configurable themes. Add them only with their own
  plan and regression tests.
