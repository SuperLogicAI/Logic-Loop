# Contributing to Logic Loop

Thanks for looking. Logic Loop is early and actively built — the fastest way
to help is a new agent adapter, a bug report with real reproduction steps, or
a fix to something you hit while dogfooding it.

## Setup

```bash
git clone https://github.com/SuperLogicAI/Logic-Loop.git
cd Logic-Loop
npm install
npm run tauri dev
```

Requirements: macOS (Apple Silicon), [Rust](https://rustup.rs), Node 18+, and
at least one supported agent CLI (Claude Code, OpenCode, Codex, or
Antigravity). App state lives in `~/.context-terminal/`.

## Before you open a PR

These are the merge gates. CI runs all of them except `golden`:

```bash
npx tsc --noEmit                                    # TypeScript, strict
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
npm run landing:check && npm run epoch:check && npm run bind:check \
  && npm run dedupe:check && npm run reentry:check && npm run unclaimed:check \
  && npm run notify:check && npm run spawn:check && npm run scope:check
```

`npm run golden` is the extraction golden set. It shells out to the `claude`
CLI, so it costs money per run and stays local — run it if, and only if, you
changed an extraction prompt (`src/lib/decisions.ts` and friends). It must
pass 12/12.

Manual checks a machine can't run live in [docs/TESTING.md](docs/TESTING.md),
one section per phase. If your change touches ingestion, binding or the
panels, say in the PR which section you walked through.

## Architecture rules that aren't up for debate

The full list is in [CLAUDE.md](CLAUDE.md) — it's written for the AI agents
working on this repo, but it's the real contributor guide and worth reading
before a non-trivial change. The short version:

1. **Never parse ANSI terminal output for meaning.** Semantic events come from
   structured agent protocols only — hooks, JSONL transcripts, or an agent's
   own plugin API. Raw PTY bytes pass through untouched.
2. **Fail open.** Ingestion or a panel breaking must never affect terminals.
   Hook commands always exit 0.
3. **Panels are dumb SQL views** over append-only tables. Intelligence lives
   in the ingestion layer.
4. **The app never sends input to a running terminal session autonomously.**
   Observe and display; humans act.
5. **Transcript and agent content is untrusted data** — never treated as
   instructions, including inside extraction prompts.
6. The stack is fixed: Tauri v2 / Rust / portable-pty / React + TS + Tailwind
   / xterm.js / SQLite.

Also: all DB access goes through the typed repo layer (`src/lib/repo.ts`) —
no inline SQL in components. Schema changes are a new numbered migration,
never an edit to an old one.

## Adding an agent adapter

The most valuable contribution, and there's a worked path. Each adapter is one
Rust module in `src-tauri/src/` that (a) registers itself in that agent's own
global config when toggled on, and (b) normalizes the agent's native events
into the same wire shape Claude's hooks POST to the ingest server. Read
`codex.rs` (thinnest — Codex's hook contract is nearly Claude's),
`opencode.rs` (in-process plugin translating native events), then
`antigravity.rs` (the awkward one). Install/remove must be idempotent and
byte-identically reversible; users have pre-existing hooks that must survive.
Unit tests cover that for every existing adapter — add yours.

## Issues and PRs

- One concern per PR. Touch only what the change requires; don't reformat or
  refactor adjacent code that isn't broken.
- Flag pre-existing dead code rather than deleting it.
- Include the platform, the agent CLI and version, and whether the toggle read
  "on" when reporting an ingestion bug — most of them are config-shaped.
- Never commit real credentials, tokens, or transcript content containing
  anything private. Sanitize pasted payloads.

## License

Contributions are licensed under [GPLv3](LICENSE), same as the project.
