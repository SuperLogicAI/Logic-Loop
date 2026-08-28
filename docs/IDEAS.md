# Logic Loop — Draft ideas (parking lot)

Not scheduled, not key features, no PLAN.md yet. Candidates surfaced
2026-08-27 discussing what's a cheap add given the current architecture.
Review at some point; promote to `docs/ROADMAP.md`'s sequencing table (with
its own PLAN.md) if/when one of these is actually next.

## Split-pane tabs

Already tracked in `docs/ROADMAP.md` ("Split-pane tabs — v1.x UI") — not
duplicated here, just noting it's the one item in this list that already has
a home.

## Diff/file preview pop-out

Click a "Wrote X"/"Edited X" row in the Accomplished panel → show the diff.
Cheap: `git_diff_cached` already exists (Commit & Push footer), the
Accomplished panel already carries `file_path` per row (`listToolEvents`,
`src/lib/repo.ts`). Read-only, no schema change, no new dependency for a v1
(raw diff text; syntax highlighting can come later if it's worth it).

## Detach tab to its own OS window

Tauri v2's native multiwindow. No new dependency. Still human-triggered
(a click), still just hosting the same PTY — doesn't touch invariant #4.

## Dev-server preview pop-out

Embedded webview pointed at `localhost:PORT`, opened from a tab. Tauri
webview windows are built-in, no heavy new dependency. Main open question is
port detection UX (read it off recent tool activity vs. just let the user
type/pick a port) — more work than the two above but still pure observation,
no ingestion/schema change.

## Editable code view pop-out — considered, not recommended

Flagged during the same discussion, kept here so it doesn't get silently
re-proposed without the reasoning: this is a mini-IDE, not a pop-out. Real
scope — new editor dependency, undo semantics, and a genuine save-race the
moment the agent is mid-edit on the same file while the user types in the
pop-out. Also duplicates what the agent and the user's actual editor already
do. The diff/file preview pop-out above gets ~90% of the value with none of
the risk — build that instead unless a concrete case shows up that the
read-only version doesn't cover.
