// Decision pipeline — ingestion layer. Assembles turn-pairs per session from
// transcript lines, runs the extractor, validates strictly, writes rows.
// Every failure is swallowed: extraction breaking must never touch terminals.
import { invoke } from "@tauri-apps/api/core";
import { buildPrompt, parseExtraction, type TurnPair } from "./extractor";
import * as repo from "./repo";

const assistantBuf = new Map<string, string>(); // session_id -> pending assistant text
let queue: Promise<void> = Promise.resolve(); // serialize LLM calls

function textFromTranscriptLine(line: string): { role: string; text: string } | null {
  try {
    const obj = JSON.parse(line) as {
      type?: string;
      message?: { content?: unknown };
    };
    if (obj.type !== "assistant" && obj.type !== "user") return null;
    const content = obj.message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b): b is { type: string; text: string } =>
          typeof b === "object" && b !== null && (b as { type?: string }).type === "text"
        )
        .map((b) => b.text)
        .join("\n");
    }
    // tool_use-only messages and tool_result user messages carry no text
    if (!text.trim()) return null;
    return { role: obj.type, text };
  } catch {
    return null;
  }
}

async function extract(sessionId: string, cwd: string, pair: TurnPair): Promise<void> {
  const s = await repo.getExtractorSettings();
  const raw = await invoke<string>("run_extractor", {
    prompt: buildPrompt(pair),
    backend: s.backend,
    lmstudioUrl: s.lmstudioUrl,
    lmstudioModel: s.lmstudioModel,
  });
  const decisions = parseExtraction(raw);
  if (!decisions) return; // contract violation → drop, fail open
  for (const d of decisions) {
    await repo.insertDecision(sessionId, cwd, d, JSON.stringify(pair));
  }
}

function enqueue(sessionId: string, cwd: string, pair: TurnPair, onDone: () => void): void {
  // ponytail: cheap prefilter — no question mark and no assumption language
  // means nothing to extract; saves an LLM call on most turns.
  if (!/\?|assum/i.test(pair.assistant)) return;
  queue = queue
    .then(() => extract(sessionId, cwd, pair))
    .then(onDone)
    .catch(() => undefined);
}

/** Feed every transcript line here. */
export function onTranscript(
  sessionId: string,
  cwd: string | undefined,
  line: string,
  onDone: () => void
): void {
  const msg = textFromTranscriptLine(line);
  if (!msg) return;
  if (msg.role === "assistant") {
    const prev = assistantBuf.get(sessionId);
    assistantBuf.set(sessionId, prev ? `${prev}\n${msg.text}` : msg.text);
    return;
  }
  // user reply closes the pending pair
  const assistant = assistantBuf.get(sessionId);
  assistantBuf.delete(sessionId);
  if (assistant && cwd) enqueue(sessionId, cwd, { assistant, user: msg.text }, onDone);
}

/** Feed Stop hooks here: turn ended with no user reply. Delayed so the
 *  500ms transcript tailer can deliver the turn's trailing assistant lines. */
export function onStop(sessionId: string, cwd: string | undefined, onDone: () => void): void {
  setTimeout(() => {
    const assistant = assistantBuf.get(sessionId);
    assistantBuf.delete(sessionId);
    if (assistant && cwd) enqueue(sessionId, cwd, { assistant, user: null }, onDone);
  }, 2000);
}
