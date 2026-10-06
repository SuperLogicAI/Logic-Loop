# Semantic color tokens + hide unused sidebar controls

Status: **APPROVED 2026-10-06 — build in progress; Phase 50 acceptance pending maintainer testing.**

Approved decisions (2026-10-06): role list and hues as proposed; Isolate Loop
drops orange; Setup keeps a dedicated accent; Sidebar LM hides until a local
model is configured; two commits (A, B), one PR.

Source: docs/IDEAS.md "Semantic color tokens" (Part A) and "Hide Traffic /
Sidebar LM when unused" (Part B), both surfaced 2026-10-05 reviewing Phase 49.
Assigned Phase 50. Phase 49 was accepted 2026-10-03. The maintainer wrote
`PHASE 50 ACCEPTED` on 2026-10-06 before this plan existed; it was treated as a
go-ahead to draft only, not as acceptance (nothing had been built).

Estimated effort: Part A 1-2 days plus live visual pass; Part B hours.
UI-only. No SQL, no migration, no Rust change expected (Part B verifies this).

## Problem

Hues do several jobs at once (orange = Isolate Loop identity, stale Inbox, and
decision text; sky = focus ring, Setup outline, Inbox count), and `.lock-in-panel`
in `src/index.css` neutralizes them by matching class strings
(`[class*="text-orange-"]`, hand-listed `bg-*` shades). Any new color or shade
leaks through Lock-in until someone adds it there. ~320 raw hue-class usages
across `src` (SidePanel ~99, OnboardingModal ~20, index.css ~14, TabBar ~13).
Separately, Traffic and Sidebar LM render unconditionally beside Inbox, so a
new user sees two dead controls in the most prominent spot.

## Part A — semantic color tokens

Done = components use roles, not hues; Lock-in is one token override; a check
fails on new raw hue classes.

### Proposed roles (DEFAULTS — palette is the maintainer's call)

| Role | Meaning | Default hue | Replaces |
|------|---------|-------------|----------|
| `attn` | needs you / waiting / stale | amber | orange-*, yellow-* (warning use) |
| `ok` | done / healthy | emerald | emerald-*, green-* |
| `danger` | blocker / error | red | red-*, rose-* |
| `info` | neutral interactive, counts | sky | sky-* (non-focus) |
| `focus` | focus ring ONLY | blue-ish, distinct from `info` | sky focus rings |
| `setup` | Setup accent (dedicated) | teal | teal-*, blue-* |

Neutrals stay zinc. Feature identity (Isolate Loop, Traffic) moves to
icon/shape/position; Isolate Loop's existing worktree-tab glow stays and stops
borrowing a warning color. Purple's current uses are audited in step 1 and
mapped to a role or dropped; no seventh role without approval.

### Steps (each with its check)

1. **Audit + spike.** Script-count every raw hue class by file and map each to a
   role in a table at the top of this plan's appendix (committed). Spike: define
   `--color-attn` etc. via Tailwind v4 `@theme`, confirm utilities such as
   `text-attn`, `bg-attn/10`, `border-attn` compile and that overriding the
   variable on `.lock-in-panel` re-colors descendants (if `@theme` inlines, switch
   to `@theme inline` plus plain variables). *Check:* a throwaway element in
   the built CSS shows the override working. Stop and report if it does not.
2. **Define tokens** in `src/index.css`. *Check:* `tsc --noEmit`, build passes.
3. **Migrate components** file by file, largest first. No state-semantics change,
   only class swaps. *Check per file:* no raw hue class remains; visual diff at
   the end, not per file.
4. **Collapse Lock-in:** under `.lock-in-panel` re-point every role to zinc;
   delete the attribute-selector blocks (`text-/border-/bg-` lists). Keep the
   `shadow`/`lock-in-state` rule. *Check:* `lock-in:check` updated to assert
   the token override exists and the attribute-selector block is gone.
5. **Guard:** new `color-tokens:check` script (added to `npm run check`) that
   fails on `(text|bg|border|ring|from|to|fill|stroke|...)-<hue>-NNN` in
   `src/**/*.tsx`. Allowlist only what step 1 explicitly justifies (e.g.
   third-party brand colors). *Check:* script passes on the tree, fails on a
   planted violation (verify once, then remove).
6. **Document** the role table in CONTRIBUTING (or AGENTS if that is where UI
   rules live; verify which exists).

Out of scope: light mode / new themes, state semantics, notification policy.

## Part B — hide unused sidebar controls

Decisions are proposed defaults; maintainer confirms or overrides at approval.

- **Traffic:** show only when `read_safe_router_traffic` reports a log exists.
  `TrafficSnapshot::Missing` = absent; any unreadable/locked/error variant =
  **unknown → keep visible** (Unknown ≠ Absent). Step 0: read the full
  `TrafficSnapshot` enum to confirm it distinguishes Missing from error; if it
  does not, that is a Rust change and this plan is revised explicitly, not
  silently. Detection runs on app start and when Setup is opened; a Setup
  "Safe Router detected" row keeps it discoverable.
- **Existing users:** persist "Traffic has been seen" (existing UI-state store,
  not a new table) so a user who used it never loses it on upgrade or on a
  transient missing log.
- **Sidebar LM:** hide until the user has configured a local model; reachable
  from Setup. Not decided in the idea doc, so default is conservative: ship
  Traffic hide first, make Sidebar LM hide a single flag that is easy to flip.
- Expanded, compact rail, and hidden-sidebar entries follow the same rule
  (one predicate, passed as props into `SidebarControls`).
- *Checks:* extend `panel-layout:check` and `lock-in:check`; add a small
  pure-function check for the visibility predicate (missing / present /
  error / previously-seen).

Out of scope: removing either feature, Safe Router ingestion, notification
policy.

## Gates and evidence

- `tsc --noEmit` clean; `npm run check` (including the new check); Rust
  untouched unless Part B step 0 says otherwise (then `cargo clippy
  --all-targets -- -D warnings`).
- Manual, recorded in docs/TESTING.md and called out in the phase report
  (a machine cannot verify these): every state color in expanded sidebar, compact
  rail, hidden sidebar, minimum width, and Lock-in; Traffic hidden with no
  router, visible with log present, visible with unreadable log; Setup row.
  Do not accept from screenshots.
- Plan revisions mid-phase are stated explicitly in this file.

## Decisions needed before build

1. Approve or edit the role list and hues above (palette is yours).
2. Does Isolate Loop drop orange? (Default: yes, identity via icon/glow.)
3. Does Setup keep a dedicated accent? (Default: yes, `setup`.)
4. Sidebar LM: hide until configured, or leave always visible this sprint?
5. Ship Part A and B as one PR or two? (Default: two commits, one PR.)
