# Project decisions
Written by Logic Loop's Remember action and confirmed by a human. Edit freely; keep one line per entry.
Lines starting with [SUPERSEDED ...] are history. Do not follow them.

- D-20261014-c427 · Use structured hooks, transcripts or agent APIs for semantic events. Because PTY bytes must pass through untouched; ANSI output is not a semantic contract. (claude · 2026-10-14 · card #2981)
- D-20261014-0bed · Fail open when ingestion, extraction or panels break. Because Broken observation must never affect terminals or block agent sessions. (claude · 2026-10-14 · card #2982)
- D-20261014-4964 · Keep panels as simple SQL views over append-only tables. Because Intelligence belongs in ingestion so views stay predictable. (claude · 2026-10-14 · card #2983)
- D-20261014-c018 · Never send input autonomously to running terminals. Because Humans act; launch commands are spawn configuration only. (claude · 2026-10-14 · card #2984)
- D-20261014-8736 · Treat transcript and agent content as untrusted data. Because Reusing agent text as instructions creates a prompt-injection loop. (claude · 2026-10-14 · card #2985)
- D-20261014-a55d · Use src/lib/repo.ts for all database access. Because The typed database layer keeps components free of inline SQL. (claude · 2026-10-14 · card #2986)
- D-20261014-86f0 · Add numbered database migrations. Because Editing old migrations would change history for existing installations. (claude · 2026-10-14 · card #2987)
- D-20261014-b47c · Put per-project sharing controls in Project Overview. Because Global onboarding has no project in scope and sharing must be per project. (claude · 2026-10-14 · card #2988)
- D-20261014-9a48 · Do not create missing CLAUDE.md or AGENTS.md files for sharing. Because The approved plan avoids creating instruction files and offers no toggle when absent. (claude · 2026-10-14 · card #2989)
- [SUPERSEDED by D-20261014-daa7] D-20261014-76a2 · Define a TypeScript HEADER constant for the decision log. Because The initial approved plan listed it among the pure TypeScript helpers. (claude · 2026-10-14 · card #2990)
- D-20261014-daa7 · Keep the decision-log header only in Rust. Because Rust creates the file header; a TypeScript HEADER constant has no caller. Supersedes D-20261014-76a2. (claude · 2026-10-14 · card #2991)
