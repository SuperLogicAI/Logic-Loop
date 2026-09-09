// Decision pipeline — ingestion layer. Assembles turn-pairs per session from
// transcript lines, runs the extractor, validates strictly, writes rows.
// Every failure is swallowed: extraction breaking must never touch terminals.
import { invoke } from "@tauri-apps/api/core";
import { buildPrompt, parseExtraction, type TurnPair } from "./extractor";
import { serialize } from "./extractorQueue";
import * as repo from "./repo";
import type { AttentionSourceContext } from "../types";

interface PendingAssistant {
  text: string;
  context: AttentionSourceContext;
}

const assistantBuf = new Map<string, PendingAssistant>(); // session_id -> pending assistant text

export function textFromTranscriptLine(line: string): { role: string; text: string } | null {
  try {
    const obj = JSON.parse(line) as {
      type?: string;
      message?: { content?: unknown };
      payload?: {
        type?: string;
        role?: string;
        content?: unknown;
      };
    };
    if (obj.type === "assistant" || obj.type === "user") {
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
    }
    if (obj.type !== "response_item") return null;
    const payload = obj.payload;
    if (payload?.type !== "message" || (payload.role !== "assistant" && payload.role !== "user")) {
      return null;
    }
    const blockType = payload.role === "assistant" ? "output_text" : "input_text";
    if (!Array.isArray(payload.content)) return null;
    const text = payload.content
      .filter(
        (b): b is { type: string; text: string } =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: unknown }).type === blockType &&
          typeof (b as { text?: unknown }).text === "string"
      )
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) return null;
    return { role: payload.role, text };
  } catch {
    return null;
  }
}

async function extract(
  sessionId: string,
  cwd: string,
  pair: TurnPair,
  context: AttentionSourceContext
): Promise<void> {
  const s = await repo.getExtractorSettings();
  const raw = await invoke<string>("run_extractor", {
    prompt: buildPrompt(pair),
    backend: s.backend,
    lmstudioUrl: s.lmstudioUrl,
    lmstudioModel: s.lmstudioModel,
    codexModel: s.codexModel,
  });
  const decisions = parseExtraction(raw);
  if (!decisions) return; // contract violation → drop, fail open
  for (const d of decisions) {
    await repo.insertDecision(sessionId, cwd, d, JSON.stringify(pair), context);
  }
}

function enqueue(
  sessionId: string,
  cwd: string,
  pair: TurnPair,
  context: AttentionSourceContext,
  onDone: () => void
): void {
  // ponytail: cheap prefilter — no question mark and no assumption language
  // means nothing to extract; saves an LLM call on most turns.
  if (!/\?|assum/i.test(pair.assistant)) return;
  void serialize(() => extract(sessionId, cwd, pair, context))
    .then(onDone)
    .catch(() => undefined);
}

/** Feed every transcript line here. */
export function onTranscript(
  sessionId: string,
  cwd: string | undefined,
  line: string,
  onDone: () => void,
  context: AttentionSourceContext = { sessionId }
): void {
  const msg = textFromTranscriptLine(line);
  if (!msg) return;
  if (msg.role === "assistant") {
    const prev = assistantBuf.get(sessionId);
    assistantBuf.set(sessionId, {
      text: prev ? `${prev.text}\n${msg.text}` : msg.text,
      // Capture context with the assistant message, before extraction enters
      // its async queue. A later tab switch cannot retarget this decision.
      context: prev?.context ?? { ...context },
    });
    return;
  }
  // user reply closes the pending pair
  const assistant = assistantBuf.get(sessionId);
  assistantBuf.delete(sessionId);
  if (assistant && cwd) enqueue(sessionId, cwd, { assistant: assistant.text, user: msg.text }, assistant.context, onDone);
}

/** Feed Stop hooks here: turn ended with no user reply. Delayed so the
 *  500ms transcript tailer can deliver the turn's trailing assistant lines. */
export function onStop(
  sessionId: string,
  cwd: string | undefined,
  onDone: () => void,
  context: AttentionSourceContext = { sessionId }
): void {
  setTimeout(() => {
    const assistant = assistantBuf.get(sessionId);
    assistantBuf.delete(sessionId);
    if (assistant && cwd) {
      enqueue(sessionId, cwd, { assistant: assistant.text, user: null }, assistant.context ?? { ...context }, onDone);
    }
  }, 2000);
}
