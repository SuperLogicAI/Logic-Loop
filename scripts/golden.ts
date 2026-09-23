// Golden test runner: node scripts via tsx. Runs every extraction fixture in
// tests/golden/ through the real extractor backend (claude CLI by default,
// EXTRACTOR=codex for Codex CLI, EXTRACTOR=lmstudio for LM Studio) and checks
// expectations. EXTRACTOR_MODEL overrides the claude backend's model
// (e.g. EXTRACTOR_MODEL=haiku) — the judge for any future model-default
// change, not intuition. Reconciliation fixtures were removed with automatic
// reconciliation itself (Plan 016).
// Usage: npm run golden
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt, parseExtraction, EXTRACTION_SCHEMA, type ExtractedDecision } from "../src/lib/extractor";

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

// Mirrors extractor.rs's claude_args() exactly — same fixed-overhead cut, same
// contract. Keep both in sync; a drift here makes golden stop measuring what
// the app actually spends.
const CLAUDE_SYSTEM_PROMPT =
  "You output only the JSON object specified by the user prompt. No prose, no code fences, no explanation.";

function runClaude(prompt: string, model: string): string {
  const stdout = execFileSync(
    "claude",
    [
      "-p",
      "--output-format",
      "json",
      "--model",
      model,
      "--strict-mcp-config",
      "--tools",
      "",
      "--setting-sources",
      "",
      "--no-session-persistence",
      "--system-prompt",
      CLAUDE_SYSTEM_PROMPT,
      "--json-schema",
      EXTRACTION_SCHEMA,
    ],
    {
      input: prompt,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, LOGIC_LOOP_TAB_ID: EXTRACTOR_TETHER },
    }
  );
  const parsed = JSON.parse(stdout) as { structured_output?: unknown; result?: string };
  if (parsed.structured_output !== undefined && parsed.structured_output !== null) {
    return typeof parsed.structured_output === "string"
      ? parsed.structured_output
      : JSON.stringify(parsed.structured_output);
  }
  if (typeof parsed.result !== "string") throw new Error("claude: no result field in json output");
  return parsed.result;
}

function runCodex(prompt: string): string {
  const args = ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-"];
  if (process.env.CODEX_MODEL) args.splice(6, 0, "-m", process.env.CODEX_MODEL);
  const stdout = execFileSync("codex", args, {
    input: prompt,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, LOGIC_LOOP_TAB_ID: EXTRACTOR_TETHER },
  });
  let finalMessage = "";
  let turnCompleted = false;
  let turnFailed = false;
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: unknown };
      };
      if (event.type === "turn.completed") turnCompleted = true;
      if (event.type === "turn.failed" || event.type === "error") turnFailed = true;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        finalMessage = event.item.text;
      }
    } catch {
      // Ignore non-JSON noise; the final agent_message remains authoritative.
    }
  }
  if (turnFailed) throw new Error("codex: turn failed");
  if (!turnCompleted) throw new Error("codex: turn did not complete");
  if (!finalMessage) throw new Error("codex: no final agent message");
  return finalMessage;
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

function checkExtraction(name: string, f: Fixture, raw: string): string[] {
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
let spawns = 0;

for (const file of files) {
  const f = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;

  const prompt = buildPrompt({ assistant: f.assistant, user: f.user });
  // EXTRACTOR_MODEL overrides; unset mirrors decisions.ts's shipped default
  // (sonnet — haiku showed a ~1-in-7 false positive on 09-question-in-code
  // across repeated runs).
  const model = process.env.EXTRACTOR_MODEL ?? "sonnet";
  let raw: string;
  try {
    spawns++;
    raw =
      backend === "lmstudio"
        ? await runLmStudio(prompt)
        : backend === "codex"
          ? runCodex(prompt)
          : runClaude(prompt, model);
  } catch (e) {
    console.error(`✗ ${file}: backend error: ${String(e).slice(0, 200)}`);
    failures++;
    continue;
  }
  const errs = checkExtraction(file, f, raw);
  if (errs.length === 0) {
    console.log(`✓ ${file} (1 spawn)`);
  } else {
    failures++;
    for (const e of errs) console.error(`✗ ${e}`);
  }
}

console.log(
  failures === 0
    ? `\nALL ${files.length} GOLDEN CASES PASS (${backend}, ${spawns} spawns)`
    : `\n${failures}/${files.length} FAILED (${backend}, ${spawns} spawns)`
);
process.exit(failures === 0 ? 0 : 1);
