/** Plan 066: app-chrome theme. Stored in localStorage (not the SQLite settings
 * table) so it can be applied synchronously before first paint — no dark
 * flash for light users. The terminal pane is not themed. */
export type ThemePref = "system" | "light" | "dark";

const KEY = "logic-loop.theme";
const ORDER: ThemePref[] = ["system", "light", "dark"];

export function parseThemePref(v: string | null): ThemePref {
  return v === "light" || v === "dark" ? v : "system";
}

export function resolveTheme(pref: ThemePref, systemLight: boolean): "light" | "dark" {
  return pref === "system" ? (systemLight ? "light" : "dark") : pref;
}

export function nextThemePref(pref: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
}

export function getThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(KEY));
  } catch {
    return "system";
  }
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // ponytail: unsaved pref just resets to System next launch
  }
}

const lightQuery = () => window.matchMedia("(prefers-color-scheme: light)");

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref, lightQuery().matches);
}

/** Re-applies on OS appearance change while pref is System. Returns cleanup. */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const q = lightQuery();
  const onChange = () => {
    if (getPref() === "system") applyTheme("system");
  };
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}
