---
name: Bug report
about: Something in Logic Loop is broken
labels: bug
---

**What happened**

**What you expected**

**Steps to reproduce**
1.
2.

**Environment**
- macOS version:
- Logic Loop version (or commit):
- Agent CLI and version (e.g. `claude --version`, `codex`, `opencode`, `agy`):
- Installed from a build, or `npm run tauri dev`:

**If it's an ingestion bug** (panels empty, state dot stuck, rows missing)
- Did the agent's toggle read "on"?
- Do you have your own pre-existing hooks in that agent's config?
  (`~/.claude/settings.json`, `~/.codex/hooks.json`,
  `~/.config/opencode/opencode.json`, `~/.gemini/config/hooks.json`)
- Any warning strip in the side panel?

**Logs / payloads** — sanitize first; transcript content can be private.
