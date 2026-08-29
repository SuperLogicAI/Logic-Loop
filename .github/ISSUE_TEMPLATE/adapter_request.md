---
name: Agent adapter request
about: Support a coding agent Logic Loop doesn't ingest yet
labels: enhancement, adapter
---

**Agent** — name, repo, install command.

**Structured event source** — Logic Loop never parses terminal output, so an
adapter needs one of: lifecycle hooks, a JSONL transcript, or a plugin/event
API. Link the docs for whichever it has. If it has none, say so — that's the
answer to whether this is possible at all.

**Config file the adapter would register itself into** (path, format), and
whether it's global or per-project.

**Are you interested in building it?** See CONTRIBUTING.md § Adding an agent
adapter.
