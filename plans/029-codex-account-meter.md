# Plan 029: Codex session model and account meter

> Implementation authorized by the maintainer's 2026-09-17 request to bypass phase gates and build the Codex version in one testing sprint. Built on the staged Plan 023 Claude implementation in an isolated worktree.

## Source proof

OpenAI's [app-server protocol](https://learn.chatgpt.com/docs/app-server) documents `thread/read` without resume or subscription and `account/rateLimits/read` with legacy and named-bucket responses. A read-only probe of locally installed `codex-cli 0.154.0` on 2026-09-17 returned an exact CLI rollout session ID from `thread/read`, including `thread.model` and `cliVersion`. `account/read` reported `chatgpt`. `account/rateLimits/read` returned `codex` windows of 300 and 10080 minutes and a separate `base_model_inference` bucket with a 10080-minute window and no secondary window. These buckets were not mapped to the active model by the response; display each named bucket separately. The probe did not resume a thread, make a model request, or change authentication.

## Build

Add a bounded Rust reader that starts the installed Codex app-server, performs the initialization handshake, then calls only `account/read`, `account/rateLimits/read`, and `thread/read` for the exact bound session ID. Reject malformed fields and cap buckets, output, and runtime. Frontend polling runs only while a bound Codex tab's expanded sidebar is visible, no faster than 60 seconds, with generation cleanup. Keep snapshots transient. Render model plus each returned account bucket's actual windows; show loading, unavailable, missing-window, error, and stale states. No PTY inspection or input, SQLite migration, account mutation, or router attribution.

## Verification

Focused parser and UI checks, then repository gates. Manual macOS checks in `docs/TESTING.md` compare model and limits with Codex's own UI, exercise two tabs and model switching, and check no-router/router/non-Codex contexts.
