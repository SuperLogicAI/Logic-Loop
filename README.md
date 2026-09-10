<h1>
  <img src="docs/assets/logo.png" alt="Logic Loop logo" height="32" valign="middle">
  &nbsp;Logic Loop
</h1>

**Effortlessly switch between multiple concurrent AI coding agent terminal sessions — a macOS app.**

![Logic Loop](docs/assets/logic-loop-ui.png)

Logic Loop is an open-source macOS app, built by [Super Logic AI](https://superlogicai.com),
that aids the human's context-switching limits while running several AI coding
agent terminal sessions at once — Claude Code, OpenCode, Codex and Antigravity
today, more adapters planned. Every competing tool tells you what your *agents*
are doing. Logic Loop tells you what *you* need to do — and remembers
everything you'd otherwise lose in the switch.

> Agent viewers manage the agents' context. Logic Loop manages yours.

---

## Why

The bottleneck in multi-agent development is no longer the model's context
window — it's the operator's working memory. Run four Claude Code sessions and
the cost isn't watching them; it's the tax you pay every time you switch: lost
open questions, forgotten state, re-reading a terminal to remember where you
were.

Each panel in Logic Loop counters a documented failure mode of human task
switching:

| Panel | What it counters |
|---|---|
| **Decision Tracker** | *Missed forks* — the agent asks two questions, you answer one, the second silently dies and the agent decides for you. |
| **Accomplished** | *Progress blindness* — re-entry starts with "where was I?" instead of "what's next?" |
| **Blockers** | *Non-viable switches* — switching into a project only to find it's waiting on something external. |
| **Landing Note** | *State reconstruction cost* — rebuilding mental state on return can take 15–25 min; a written next action collapses it. |
| **Attention Residue** | *Attention residue* — part of your mind stays on the task you left; externalize the loop to return clean. |
| **Momentum Builder** | *Re-entry friction* — surfaces the single lowest-friction next action to convert staring into motion. |
| **Idea Board** | *Where did that idea go* — a per-project kanban dock (idea → planned → building → later → done) living in a git-committed `.logic-loop/board.md`; star up to 3 cards as "Now" and Momentum Builder prefers them over the plain top-of-column pick. |
| **Attention Inbox** | *Which of my N projects needs me* — a cross-project, keyboard-driven (`Cmd/Ctrl+K`) rollup of every open decision, unclaimed result, unresolved blocker, and stalled-quiet session across all tabs, ranked actionability-first with searchable per-row jump-to-tab. |

Two supporting controls round out re-entry and focus: a **folded/compact side
rail** — collapse any expanded panel down to icon-only, click an icon to jump
back to its section — for when screen space matters more than detail, and
**Lock-in** (Do Not Disturb, indefinite or a 1-hour timer) — the side panel
goes neutral and OS notifications/dock badge stay silent while every panel,
hook, and background session keeps updating underneath, so nothing is missed,
just not pushed at you.

## How it works

Logic Loop never scrapes the terminal screen. Semantic events come from
structured agent protocols only — an agent's lifecycle **hooks** (Claude Code,
Codex, Antigravity), its JSONL session **transcripts**, or its own
plugin/event API where one exists (OpenCode) — deterministic, structured, no
ANSI parsing. Raw PTY bytes pass through untouched. Panels are plain SQL views
over an append-only event log; the only place an LLM is used is the ambiguous
10% (did your reply address every question the agent asked?), and even that
fails open — if extraction breaks, the terminals keep working.

Every adapter normalizes to one wire shape, so a tab running any of them gets
the same state dots, rollups and fan-out tracking. Each installs itself into
that agent's own global config via a toggle in the app, and removes itself
byte-identically when switched off. [AGENTS.md](AGENTS.md) is this repo's own
shared contract for coding agents working on Logic Loop itself — repo map,
verify commands, and invariants in one place, readable by OpenCode and Codex
alongside Claude Code.

## Supported agents

| Agent | Activity, state & fan-out | Decision / blocker extraction | Notes |
|---|---|---|---|
| **Claude Code** | ✅ | ✅ | Hooks + JSONL transcript tailing. The reference adapter. Resume/re-entry supported. |
| **OpenCode** | ✅ | — | In-process plugin translating native events; no transcript file to tail. |
| **Codex** | ✅ | ✅ | Hook contract is near-identical to Claude's; registers into `~/.codex/hooks.json`. Carries its own adapter marker, resumes via `codex resume`, handles `Interrupt`/`SessionEnd` lifecycle events, and can back the Sidebar LM extractor. |
| **[Antigravity](https://github.com/google-antigravity/antigravity-cli)** (`agy`) | ✅ | — | See caveats below. |

Decision and blocker extraction is available for Claude Code and Codex. The
Sidebar LM chooser supports Claude CLI (default), Codex CLI, and LM Studio
(local); Codex CLI uses its configured default model unless an optional model
override is supplied. The Decisions panel groups open questions into
per-session, collapsible clusters (newest expanded, one "dismiss all" per
cluster) instead of one flat list, and its empty state now says *why* nothing's
showing rather than one generic "nothing waiting" —
confirmed-empty, blind session (no transcript), unbound fan-out child, or
"not available for this agent" are each called out distinctly.

Antigravity's tool activity (file edits, commands run) now shows real detail
in the Accomplished panel and Since-you-left digest, and a second turn in the
same session correctly returns the tab to "working" instead of freezing on
"idle" — both were Logic Loop-side gaps, now fixed.

One Antigravity-specific limit remains, upstream in `agy` and not fixable
from this side (full derivation in [docs/TESTING.md](docs/TESTING.md) §21):

- A tool call that exits non-zero is indistinguishable from one that
  succeeded — `agy` strips the field carrying that status before the hook
  sees it, so an `agy` tab shows "working" rather than "error" on a failed
  command. Everything else still lands.

`agy`'s separate `PostToolUse` named-hook merge bug (present through earlier
`agy` releases) is confirmed fixed upstream as of `agy` 1.1.27. Logic Loop
now also detects a foreign `PostToolUse` hook in `~/.gemini/config/hooks.json`
at setup time and surfaces a warning strip if one is found, so an older or
regressed `agy` install fails loud instead of silently dropping every tool
event.

## Status

Early, actively built, dogfooded daily. Shipped:

- ✅ Terminal shell — tabs, real PTYs, per-session state dots
- ✅ Event spine — hook ingestion + transcript tailing
- ✅ Accomplished + Blockers panels (deterministic)
- ✅ Decision Tracker with fork detection
- ✅ Landing Note · Attention Residue · Momentum Builder
- ✅ Re-entry, unclaimed-result tracking, desktop nudges
- ✅ Fan-out spawn groups — launch and track several agents from one session
- ✅ OpenCode adapter — first non-Claude ingestion pipeline
- ✅ Codex adapter — adapter identity marker, resume/re-entry, Interrupt/SessionEnd lifecycle
- ✅ Isolated loops (git worktree–backed tabs)
- ✅ Antigravity (`agy`) adapter — multi-turn tracking fix, normalized tool detail, foreign-`PostToolUse`-hook detection
- ✅ Decisions grouped by session with per-cluster bulk-dismiss
- ✅ Decisions empty-state clarity — distinguishes confirmed-empty from
  blind/unbound/non-Claude-agent
- ✅ Idea Board — per-project kanban dock with a starred "Now" set
- ✅ Cross-project Attention Inbox — `Cmd/Ctrl+K` searchable rollup of
  decisions, unclaimed results, blockers, and stalled sessions across all
  open projects, with archive/backlog triage for unavailable rows
- ✅ Folded/compact side rail — icon-only panel mode, width and mode persist
- ✅ Blockers bulk clear — resolve every open blocker for a project in one
  action
- ✅ Lock-in (Do Not Disturb) — indefinite or 1-hour-timed, mutes
  notifications/dock badge without pausing ingestion
- ⏳ Crash recovery, onboarding, public release polish

## Stack

Tauri v2 (Rust core) · portable-pty · React + TypeScript + Tailwind ·
xterm.js · SQLite (tauri-plugin-sql) · localhost hook-ingest server.

## Requirements

- macOS (Apple Silicon) — primary, daily-dogfooded platform.
- Windows — early testing build, see below.
- [Rust](https://rustup.rs) + Node 18+
- At least one supported agent CLI installed — [Claude Code](https://claude.com/claude-code),
  [OpenCode](https://opencode.ai), [Codex](https://github.com/openai/codex),
  or [Antigravity](https://github.com/google-antigravity/antigravity-cli)
  (`agy`). Each is detected independently — `PATH` plus the
  usual install locations — and its toggle appears only once found.

## Windows (early testing)

CI compiles and tests the Rust core on `windows-latest` on every push, but the
macOS build is what's dogfooded daily — treat Windows as early/unverified.

To get an installer:

1. Go to [Actions → Windows build](../../actions/workflows/windows-build.yml)
   in this repo.
2. Run the workflow (`Run workflow` button, `main` branch), or grab the
   artifact from the latest run if one already exists.
3. Once it finishes, open the run and download the `logic-loop-windows-unsigned`
   artifact — it's a zip containing a `*-setup.exe` NSIS installer.
4. Run the installer. It's **unsigned**, so Windows SmartScreen will warn —
   click **More info → Run anyway**.

No installer is published automatically; each run builds from whatever's on
`main` at the time. Report issues (crashes, PTY/terminal quirks, missing
agent detection) via GitHub Issues — include your Windows version and which
agent CLI you were testing.

## Development

```bash
npm install
npm run tauri dev     # run the app
npm run build         # tsc + vite build
```

## Contributing

Bug reports, adapter requests and PRs welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, the merge gates, and the
architecture rules that aren't up for debate.

## License

[GNU GPLv3](LICENSE).

---

Built and maintained by [Super Logic AI](https://superlogicai.com) — AI automation
for small businesses.
