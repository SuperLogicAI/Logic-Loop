import { useEffect, useState } from "react";
import { applyTheme, getThemePref, nextThemePref, setThemePref, watchSystemTheme, type ThemePref } from "../lib/theme";

// \uFE0E forces text presentation; bare ☀ renders as a color emoji on macOS.
const GLYPH: Record<ThemePref, string> = { system: "◐\uFE0E", light: "☀\uFE0E", dark: "☾\uFE0E" };
const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

/** Plan 066: titlebar control cycling System → Light → Dark. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);

  useEffect(() => {
    applyTheme(pref);
    return watchSystemTheme(() => pref);
  }, [pref]);

  const next = nextThemePref(pref);
  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      onClick={() => {
        setThemePref(next);
        setPref(next);
      }}
      title={`Theme: ${LABEL[pref]} (click for ${LABEL[next]})`}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}`}
      className="mr-2 flex h-5 items-center gap-1 rounded px-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-500"
    >
      <span aria-hidden>{GLYPH[pref]}</span>
      <span>{LABEL[pref]}</span>
    </button>
  );
}
