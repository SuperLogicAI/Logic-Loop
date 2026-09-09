# Plan 002: Codex CLI Sidebar LM backend

Status: deferred. This proposal was the pending Phase 22 plan before Phase 22
was re-scoped to the Cross-project Attention foundation. It is retained here
for later scheduling; it is not authorization to implement.

## Outcome

Add Codex CLI as a third Sidebar LM backend alongside Claude CLI and LM
Studio. Do not add a ChatGPT/Responses API backend in the same work: that
would introduce credentials, network/data-retention decisions, and a separate
error model.

## Required design

- Extend `ExtractorSettings.backend` with `"codex"`; keep the optional
  `codexModel` override blank by default and never store credentials,
  sessions, or API keys.
- Add an explicit Rust extractor branch using `codex exec --ephemeral
  --sandbox read-only --skip-git-repo-check --json`, command argument arrays,
  and stdin for the prompt. It must parse only the final assistant message
  from JSONL and fail open for malformed output, non-zero exit, timeout,
  cancellation, missing text, or auth failure.
- Stamp every Codex extractor child with
  `LOGIC_LOOP_TAB_ID=__logic_loop_extractor__`. Preserve the ingest server's
  existing extractor-tether rejection. Do not weaken hook trust or use a
  bypass-trust flag.
- Reuse the existing extractor queue and parsing/validation layers. Codex
  output remains untrusted until those existing parsers accept it.
- Update Sidebar LM settings UI, golden runner selection, focused parser and
  command-shape tests, and manual testing documentation.

## Constraints and stop conditions

Do not change decision, landing-note, or commit prompt semantics; transcript
ingestion; session binding; terminal input; or workspace-write permissions.
Stop and revise the design if the installed Codex CLI cannot provide a stable
final JSONL assistant message without interactive mode, write access,
trust-bypass, or a new credential path.

## Expected verification when scheduled

```sh
npx tsc --noEmit
npm run check
cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings
npm run golden
EXTRACTOR=codex npm run golden
git diff --check
```
