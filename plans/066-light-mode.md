# Light mode for app chrome (terminal untouched)

Status: **Approved 2026-10-17 (`PHASE 66 APPROVED`), defaults taken for all
three decisions, with one change: the control lives in the titlebar.** Phase
65 accepted. Built; automated gates passed; manual matrix pending.

Source: user request 2026-10-17 (one user would only use a light UI). Plan 050
listed light mode as out of scope; its semantic tokens are what make this cheap.

Estimated effort: 1 day plus live visual pass. UI-only. No SQL, no migration,
no Rust change expected.

## Problem

The app is dark-only. Neutrals are raw `zinc-*` classes (~850 uses), roles
(`attn`/`ok`/`danger`/`info`/`focus`/`setup`) are tokens in `src/index.css`,
and ~10 hex literals are hardcoded (`#18181b`, `#27272a`, `#3f3f46`, `#71717a`,
`#a1a1aa`) in `index.css`, `SidePanel.tsx`, `LandingNoteModal.tsx`.

## Scope

Done = a Theme setting (System / Dark / Light, default **System**) re-colors
all app chrome; dark mode is pixel-identical to today; the xterm pane and its
container are unchanged in every mode.

Out of scope: terminal/xterm theme, ANSI palette, any agent's own theme,
per-project themes, new palettes or brand colors.

## Approach

No class rewrites. Tailwind v4 utilities read CSS variables, so light mode is
one variable override block under `:root[data-theme="light"]`:

- **Zinc scale flipped** (50↔950, 100↔900 ... 500 stays). Must be literal
  `oklch()` values copied from Tailwind's palette, not `var(--color-zinc-N)`:
  redefining a variable in terms of its own scale is a cycle and resolves to
  invalid.
- **Role tokens flipped** the same way (`--color-attn-300: var(--color-amber-700)`
  etc.). Safe as `var()` since base hues are not redefined.
- **Lock-in needs no change**: it maps roles to `zinc-N`, which is already
  flipped.
- **Hex literals** become variables (`--surface`, `--surface-raised`,
  `--hairline`, `--scroll-thumb`, `--scroll-thumb-hover`) defined for both modes.
- `color-scheme: light|dark` set with the attribute so native controls and
  scrollbars match.
- `text-white`/`text-black`/`bg-black/NN` overlays (~25 uses): audit, not
  flipped by default. Modal scrims stay black; text-on-accent stays white.
- Terminal: `Terminal.tsx` and its wrapper keep explicit dark colors. If the
  wrapper currently relies on `zinc-*` it gets pinned to its current dark
  values so the flip does not reach it.

Setting storage: `localStorage` key `logic-loop.theme`, read synchronously in
`main.tsx` before first render so a light user never sees a dark flash.
`System` follows `matchMedia("(prefers-color-scheme: light)")` with a change
listener (StrictMode-safe cleanup).

## Steps (each with its check)

1. **Spike.** Add the flipped zinc block, toggle `data-theme` by hand in a dev
   build. *Check:* `bg-zinc-900`, `text-zinc-300/60`, and a Lock-in panel all
   re-color; dark unchanged. Stop and report if Tailwind inlines values and the
   override does not apply.
2. **Tokens:** zinc + role flip blocks, hex → variables, `color-scheme`.
   *Check:* `npx tsc --noEmit`, `npm run build`; grep shows no remaining
   `#18181b|#27272a|#3f3f46|#71717a|#a1a1aa` outside the variable definitions.
3. **Terminal pinned:** xterm container is already explicit
   (`bg-[#1e2127]`, `Terminal.tsx:159`) — leave it. The exited-process overlay
   card (`bg-zinc-800`, line 162) is chrome and flips with the theme.
   *Check:* terminal pane identical in light mode (manual).
4. **Setting:** `src/lib/theme.ts` (`getThemePref`/`setThemePref`/
   `applyTheme`, pure resolve function), applied in `main.tsx`; control in
   Setup (`OnboardingModal`) as a 3-way segmented control. *Check:* new
   `theme:check` script (added to `npm run check`) asserting resolve for
   system-light / system-dark / forced dark / forced light / bad stored value
   → System.
5. **Overlay audit:** classify each `text-white|text-black|bg-black/*|bg-white`
   use as keep or token. *Check:* listed in the phase report.
6. **Docs:** one line in CONTRIBUTING (or wherever Plan 050's role table
   landed): new colors must read in both modes; terminal is exempt.

## Gates and evidence

- `npm run check`, `npx tsc --noEmit`, `npm run build`, `git diff --check`.
  Rust untouched (clippy/test run only if that changes).
- Manual, recorded in docs/TESTING.md (machine can't judge contrast): every
  surface in light mode — tab strip, expanded sidebar, compact rail, hidden
  sidebar, Lock-in, Home/dashboard cards, Idea Board modes, diff pop-out,
  markdown editor, Setup, Landing note, confetti, modals; dark mode spot-check
  for regressions; switching System while the OS appearance changes; launch
  with Light set shows no dark flash. Do not accept from screenshots.

## Decisions needed before build

1. Default `System`, or keep `Dark` default and make Light opt-in?
2. Storage: `localStorage` (no launch flash, proposed) vs the SQLite settings
   table used by Sidebar LM (consistent, but async → dark flash on launch).
3. Setting location: Setup only, or also a quick toggle in sidebar controls?

## Plan revisions during build (2026-10-17)

Stated explicitly per process rules:
- **Toggle location (maintainer):** titlebar, right-aligned on the logo /
  "Logic Loop" row, instead of Setup. Single button cycling System → Light →
  Dark (`ThemeToggle.tsx`), `data-tauri-drag-region="false"`. Assumed: no
  duplicate control in Setup — the titlebar one is always visible.
- **No new surface variables for zinc hexes:** each hex was exactly a zinc
  shade, so they became `var(--color-zinc-N)` and flip with the scale. Two
  warm attention-tinted surfaces that aren't zinc got `--surface-warm` /
  `--surface-warm-deep` (dark values unchanged; light = amber-50).
- **Role flip is partial:** 50-400 and 800-950 flip, 500-700 stay. A full
  flip turned `bg-info-600 text-white` buttons into white-on-sky-400.
- **Overlay audit:** `bg-black/*` scrims and inset wells kept; `text-white`
  on solid `info-600` buttons kept; `text-black` → `text-zinc-950`,
  `hover:text-white` / `after:border-white` / Landing button text →
  `zinc-50` so they flip (dark shift: pure white → zinc-50, ~1.5% L).
  `split-view:check` assertion updated `border-white` → `border-zinc-50`.
- CONTRIBUTING line (step 6) not added yet — pending how light mode reads in
  the manual pass.

### Post-acceptance tune (2026-10-18, maintainer-requested after rebuild)

- Pure white read harsh. Light zinc is now a warm neutral scale anchored on
  `#F5F0E8` (zinc-900 = app background, oklch 95.682% 0.012 79.784); hue
  79.784 throughout, low chroma. Text shades 400-600 have equal or higher
  WCAG contrast on the background than their dark-mode counterparts
  (e.g. zinc-500: 5.08 light vs 3.67 dark).
- Decision (and other role-tinted) cards were nearly invisible on cream. Role
  800/900/950 now map to 400/300/200 in light (was 200/100/50). Lock-in gets a
  matching light-only override so its grey tints show too. Warm surfaces =
  30% amber-200 over the background.
- Decision card glyphs: ⌕ context and ⤳ delegate at 1.2em, ◇ remember at
  0.8em; ✎ answer unchanged.
- `theme:check` asserts the `#F5F0E8` anchor.
- Tour moved from the stack above Home (TabBar) to the titlebar, just left of
  the theme toggle; `TabBar`'s `onOpenTour` prop removed. Home dashboard's
  own Tour button unchanged.
- `public/*.svg` icons (home, split ×2, traffic, fan out, isolate loop) are
  filled `#e3e3e3` and vanished on cream. They carry `.mono-icon`; light
  applies `filter: invert(0.75)` (≈ #4e4e4e). `theme:check` fails on any
  component `<img>` of a `/x.svg` without it. Fan out / Isolate loop weren't
  reported but had the same fill, so they're included.
- Raised surfaces (bookmarks bar, cards, menus = zinc-800) set to the
  maintainer's `#E7E2DA` (was #e9e2d7, slightly less yellow). Selected tab
  and active Home use a light-only `light:bg-zinc-800` (new
  `@custom-variant light`) so they match the bookmarks bar, Chrome-style,
  instead of the darker zinc-700. zinc-700 itself unchanged: it's 52 borders.
  `theme:check` asserts the `#E7E2DA` anchor.
- Harness pass fixes (2026-10-18): Fan out's Launch keeps `text-black`
  (its `bg-info-500` doesn't flip, so flipping the text made white-on-sky);
  FanOutModal is back to its pre-phase state. Inset text wells
  (`bg-black/20|30` in SidePanel and DiffModal) get `light:bg-black/5`; on the
  warm surface they read muddy brown. Light Lock-in maps role 500/600/700 to
  zinc-600/500/400 so "dismiss all" style text stays readable. Theme glyphs
  carry U+FE0E (☀ rendered as a color emoji).
