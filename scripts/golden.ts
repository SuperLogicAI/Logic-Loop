// Golden test runner: node scripts via tsx. Runs every fixture in
// tests/golden/ through the real extractor backend (claude CLI by default,
// EXTRACTOR=lmstudio for LM Studio) and checks expectations.
// Usage: npm run golden
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt, parseExtraction, type ExtractedDecision } from "../src/lib/extractor";

interface Fixture {
  assistant: string;
  user: string | null;
  expect: {
    count: number;
    answered: boolean[];
    has_assumption?: boolean;
    must_not_contain?: string[];
  };
}

// Same tether the app's own extractor.rs stamps on its `claude -p` child
// (crate::ingest::EXTRACTOR_TETHER) — the ingest server drops any request
// carrying it. Without this, running `npm run golden` from inside a Logic
// Loop terminal tab inherits that tab's real LOGIC_LOOP_TAB_ID from the
// shell env, so each fixture becomes a real observed session bound to that
// tab, and its transcript gets fed to the live decision extractor — fixture
// questions ("drop temp_users?") show up as real decisions on the project.
// Found 2026-08-15 via a polluted Decisions panel; same bug class as the
// 2026-07-19 self-ingest incident, different spawn site.
const EXTRACTOR_TETHER = "__logic_loop_extractor__";

function runClaude(prompt: string): string {
  return execFileSync("claude", ["-p", "--output-format", "text", "--model", "sonnet"], {
    input: prompt,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, LOGIC_LOOP_TAB_ID: EXTRACTOR_TETHER },
  });
}

async function runLmStudio(prompt: string): Promise<string> {
  const res = await fetch(`${process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234"}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      // LM Studio 400s when several models are loaded and none is named. The
      // app always sends one (⚙ Sidebar LM); mirror that here or every fixture
      // fails on the error body rather than on model quality.
      ...(process.env.LMSTUDIO_MODEL ? { model: process.env.LMSTUDIO_MODEL } : {}),
    }),
  });
  const body = (await res.json()) as {
    choices?: { message: { content: string } }[];
    error?: { message: string };
  };
  // Surface the API's own error; otherwise a bad request shows up as an
  // undefined-property TypeError that reads like a model failure.
  if (body.error) throw new Error(`lmstudio: ${body.error.message}`);
  return body.choices?.[0]?.message.content ?? "";
}

function check(name: string, f: Fixture, raw: string): string[] {
  const errs: string[] = [];
  const decisions = parseExtraction(raw);
  if (decisions === null) return [`${name}: output violates strict JSON contract: ${raw.slice(0, 120)}`];
  if (decisions.length !== f.expect.count)
    errs.push(`${name}: expected ${f.expect.count} decisions, got ${decisions.length}`);
  const got = decisions.map((d: ExtractedDecision) => d.answered).sort().join(",");
  const want = [...f.expect.answered].sort().join(",");
  if (decisions.length === f.expect.count && got !== want)
    errs.push(`${name}: answered flags ${got || "(none)"} != expected ${want || "(none)"}`);
  if (f.expect.has_assumption && !decisions.some((d) => d.agent_assumption))
    errs.push(`${name}: expected an agent_assumption, none extracted`);
  for (const bad of f.expect.must_not_contain ?? []) {
    if (raw.includes(bad)) errs.push(`${name}: output contains forbidden string "${bad}" (injection leaked)`);
  }
  return errs;
}

const dir = join(import.meta.dirname, "../tests/golden");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const backend = process.env.EXTRACTOR ?? "claude";
let failures = 0;

for (const file of files) {
  const f = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
  const prompt = buildPrompt({ assistant: f.assistant, user: f.user });
  let raw: string;
  try {
    raw = backend === "lmstudio" ? await runLmStudio(prompt) : runClaude(prompt);
  } catch (e) {
    console.error(`✗ ${file}: backend error: ${String(e).slice(0, 200)}`);
    failures++;
    continue;
  }
  const errs = check(file, f, raw);
  if (errs.length === 0) {
    console.log(`✓ ${file}`);
  } else {
    failures++;
    for (const e of errs) console.error(`✗ ${e}`);
  }
}

console.log(failures === 0 ? `\nALL ${files.length} GOLDEN CASES PASS (${backend})` : `\n${failures}/${files.length} FAILED (${backend})`);
process.exit(failures === 0 ? 0 : 1);
