# dsh-terminal-app

A first-party interactive terminal chat runner for [DeepSeek
Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), built for
Logic Loop per `plans/028-deepseek-inhouse-tui-adapter.md`.

## Why this exists

No shipped DeepSeek Harness profile supports a human-interactive terminal
conversation: `headless` runs one task and exits, `sdk`/`sdk-minimal` serve
JSON-RPC to programs, `acp` serves the Agent Client Protocol to automation
clients, and `web` is a browser UI. See
`plans/027-deepseek-harness-readiness.md` for the research trail and why the
four community `tui` bundles reviewed there were rejected (unaudited
single-maintainer projects, a monorepo copied wholesale under a
provenance-misrepresenting description, and a hosted-account Electron
product) in favor of this small first-party alternative.

This package patches the same `dsh-base` layer the shipped `headless` bundle
patches — confirmed live via `dsh --profile headless --dump-default-config`
and reading `@deepseek-ai/dsh-headless`'s own (MIT, official) source as the
reference implementation — but loops on stdin instead of running one task.

## Non-goals

- Not published to npm. Install by local path only.
- No installer script, no network fetch beyond what `dsh`/pnpm already do
  to resolve the peer packages below.
- No ingest/observer wiring yet — that is Step 2 of the linked plan.
- No tool-call rendering or answer to the base profile's `dsh-user-approval`
  "ask" policy yet. A tool call under the default `workspace-write`/`ask`
  policy has not been proven live to resolve rather than hang; the plan's
  next live-continuity check (two turns + one tool call) must verify this
  before the scaffold is treated as viable for a Logic Loop PTY tab.

## Install (disposable profile only, per the plan's gates)

```sh
DSH_HOME=/path/to/disposable/dir npx --yes @deepseek-ai/dsh \
  --from-default-profile headless --profile logic-loop --help
DSH_HOME=/path/to/disposable/dir npx --yes @deepseek-ai/dsh \
  plugin --profile logic-loop add -w /absolute/path/to/dsh-terminal-app
DSH_HOME=/path/to/disposable/dir npx --yes @deepseek-ai/dsh --profile logic-loop
```

Never point this at the real `~/.dsh` until the plan's live-continuity gate
passes.
