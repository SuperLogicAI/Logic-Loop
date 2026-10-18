import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { nextThemePref, parseThemePref, resolveTheme } from "../src/lib/theme";

// Stored value: anything unknown falls back to System.
assert.equal(parseThemePref(null), "system");
assert.equal(parseThemePref("bogus"), "system");
assert.equal(parseThemePref("light"), "light");
assert.equal(parseThemePref("dark"), "dark");

assert.equal(resolveTheme("system", true), "light");
assert.equal(resolveTheme("system", false), "dark");
assert.equal(resolveTheme("light", false), "light", "forced light ignores OS");
assert.equal(resolveTheme("dark", true), "dark", "forced dark ignores OS");

assert.equal(nextThemePref("system"), "light");
assert.equal(nextThemePref("light"), "dark");
assert.equal(nextThemePref("dark"), "system");

// CSS: light block exists, terminal keeps its fixed dark background.
const css = readFileSync("src/index.css", "utf8");
assert.match(css, /:root\[data-theme="light"\]\s*\{[^}]*--color-zinc-900:/, "light zinc flip missing");
assert.match(css, /color-scheme:\s*light/);
assert.match(css, /--color-zinc-900: oklch\(95\.682% 0\.012 79\.784\)/, "light app background must stay #F5F0E8");
assert.match(css, /--color-zinc-800: oklch\(91\.449% 0\.012 79\.782\)/, "light raised surface must stay #E7E2DA");
const term = readFileSync("src/components/Terminal.tsx", "utf8");
assert.match(term, /bg-\[#1e2127\]/, "terminal pane must stay explicitly dark");

// public/*.svg icons are filled #e3e3e3; each <img> of one needs mono-icon so
// light mode can darken it.
for (const f of readdirSync("src/components").filter((n) => n.endsWith(".tsx"))) {
  for (const line of readFileSync(`src/components/${f}`, "utf8").split("\n")) {
    if (/<img [^>]*\/[\w-]+\.svg/.test(line)) assert.match(line, /mono-icon/, `${f}: svg icon without mono-icon`);
  }
}
assert.match(css, /\[data-theme="light"\] \.mono-icon \{ filter:/);

console.log("theme check ok");
