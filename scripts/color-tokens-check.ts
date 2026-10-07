import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Plan 050: components use semantic roles (attn/ok/danger/info/focus/setup),
// never raw Tailwind hues, so Lock-in can re-point roles to grey in one rule.
const PROPS = "text|bg|border|ring|from|to|via|divide|outline|fill|stroke|shadow|accent|decoration|placeholder|caret";
const HUES = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW_HUE = new RegExp(`(?<![A-Za-z0-9_-])(${PROPS})-(${HUES})-\\d+`, "g");

export function rawHueClasses(source: string): string[] {
  return source.match(RAW_HUE) ?? [];
}

// The guard must catch a planted violation and ignore roles / zinc.
assert.deepEqual(rawHueClasses(`className="hover:bg-orange-400/10 text-zinc-300 text-attn-300"`), ["bg-orange-400"]);
assert.deepEqual(rawHueClasses(`className="text-info-300 border-focus-400 bg-setup-950/20"`), []);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const srcDir = new URL("../src", import.meta.url).pathname;
const offenders = walk(srcDir)
  .map((path) => [path, rawHueClasses(readFileSync(path, "utf8"))] as const)
  .filter(([, hits]) => hits.length > 0);
assert.deepEqual(offenders, [], "raw hue classes found; use a color role from src/index.css");

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
for (const role of ["attn", "ok", "danger", "info", "focus", "setup"]) {
  assert.match(css, new RegExp(`@theme \\{[\\s\\S]*--color-${role}-500:`), `missing theme role ${role}`);
  assert.match(css, new RegExp(`\\.lock-in-panel \\{[\\s\\S]*--color-${role}-500: var\\(--color-zinc-500\\)`), `Lock-in must grey ${role}`);
}
assert.doesNotMatch(css, /\.lock-in-panel \[class[*~]="(text|bg|border)-/, "Lock-in must not match class strings");

console.log("color-tokens-check: all assertions passed");
