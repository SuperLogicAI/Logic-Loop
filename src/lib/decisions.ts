// Decision pipeline — ingestion layer. Assembles turn-pairs per session from
// transcript lines, runs the extractor, validates strictly, writes rows.
// Every failure is swallowed: extraction breaking must never touch terminals.
import { invoke } from "@tauri-apps/api/core";
import { buildPrompt, parseExtraction, type TurnPair } from "./extractor";
import { matchAnswerNowReply } from "./decisionReconciliation";
import { serialize } from "./extractorQueue";
import * as repo from "./repo";
import type { AttentionSourceContext } from "../types";

interface PendingAssistant {
  text: string;
  context: AttentionSourceContext;
}

const assistantBuf = new Map<string, PendingAssistant>(); // session_id -> pending assistant text

// Schema-drift tripwire. Claude Code's own docs say the JSONL transcript
// entry format "is internal to Claude Code and changes between versions, so
// scripts that parse these files directly can break on any release" — found
// 2026-09-12 chasing a live break on CLI v2.1.270's new "bridge session"
// format, where every line's `type` became last-prompt/mode/permission-mode/
// atis-latch/bridge-session, none of which this module has ever recognized.
// Rather than watch changelogs for the next one, detect it directly: a real
// session's lines are overwhelmingly `type: "assistant"`/`"user"` (Claude) or
// `"response_item"` (Codex) even on a turn with no extractable text (a
// tool-only exchange) — `textFromTranscriptLine` already treats that as a
// normal, silent no-op. A long run of lines whose *envelope* type matches
// none of those means the schema itself moved, not just a quiet turn.
// THRESHOLD is generous enough to absorb a session's small number of
// non-message lines (summaries, system prompts) at start without firing on a
// healthy, unchanged transcript.
const SCHEMA_DRIFT_THRESHOLD = 20;
const unrecognizedStreak = new Map<string, number>(); // session_id -> consecutive unrecognized-envelope lines
const driftWarned = new Set<string>(); // session_id already warned — fire once, not per line

/** Whether a transcript line's own envelope is one this module knows how to
 * read at all, independent of whether that particular line carries
 * extractable text. A line that fails to parse as JSON at all (e.g. a
 * partial line mid-flush) is neither — it must not reset or extend the
 * streak, since that's ordinary tailing noise, not a schema signal. */
export function transcriptEnvelopeType(line: string): "recognized" | "unrecognized" | "unparseable" {
  let obj: { type?: unknown };
  try {
    obj = JSON.parse(line) as { type?: unknown };
  } catch {
    return "unparseable";
  }
  return obj.type === "assistant" || obj.type === "user" || obj.type === "response_item"
    ? "recognized"
    : "unrecognized";
}

function trackSchemaDrift(
  sessionId: string,
  line: string,
  agent: string | undefined,
  onSchemaDrift: ((agent: string) => void) | undefined
): void {
  const kind = transcriptEnvelopeType(line);
  if (kind === "unparseable") return;
  if (kind === "recognized") {
    unrecognizedStreak.delete(sessionId);
    return;
  }
  const streak = (unrecognizedStreak.get(sessionId) ?? 0) + 1;
  unrecognizedStreak.set(sessionId, streak);
  if (streak >= SCHEMA_DRIFT_THRESHOLD && !driftWarned.has(sessionId)) {
    driftWarned.add(sessionId);
    onSchemaDrift?.(agent ?? "claude");
  }
}

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
  context: AttentionSourceContext,
  onExtractionFailed?: (agent: string, reason: string) => void,
  onExtractionSucceeded?: (agent: string) => void
): Promise<void> {
  const s = await repo.getExtractorSettings();
  let raw: string;
  try {
    raw = await invoke<string>("run_extractor", {
      prompt: buildPrompt(pair),
      backend: s.backend,
      lmstudioUrl: s.lmstudioUrl,
      lmstudioModel: s.lmstudioModel,
      codexModel: s.codexModel,
      model: s.claudeModel,
    });
  } catch (error) {
    // The extraction call itself failed (spawn error, non-JSON reply, CLI
    // exited non-zero, etc). Stays fail-open — no card, no throw — but no
    // longer invisible: logged, and surfaced once via the same adapter-
    // warning strip transcript schema drift already uses.
    console.error("decision extraction failed:", error);
    onExtractionFailed?.(s.backend, "extraction_failed");
    return;
  }
  // The call reached the backend and got a reply — whatever caused a past
  // "extraction_failed" warning for this backend (wrong URL, LM Studio down,
  // bad model) no longer applies, even if this particular turn's JSON is
  // later rejected by parseExtraction below.
  onExtractionSucceeded?.(s.backend);
  const decisions = parseExtraction(raw);
  if (!decisions) return; // contract violation → drop, fail open
  for (const d of decisions) {
    await repo.insertDecision(sessionId, cwd, d, JSON.stringify(pair), context);
  }
}

async function reconcile(sessionId: string, submittedReply: string): Promise<boolean> {
  // Load inside the shared queue: earlier Stop extraction must settle before
  // we inspect the session's open rows.
  const candidates = await repo.openDecisionsForSession(sessionId);
  if (candidates.length === 0) return false;
  const answerNowId = matchAnswerNowReply(candidates, submittedReply);
  if (answerNowId === null) return false;
  return (await repo.answerOpenDecisions(sessionId, [answerNowId], submittedReply)) > 0;
}

function enqueueReconciliation(sessionId: string, submittedReply: string, onDone: () => void): void {
  void serialize(() => reconcile(sessionId, submittedReply))
    .then((changed) => {
      if (changed) onDone();
    })
    .catch(() => undefined);
}

function enqueue(
  sessionId: string,
  cwd: string,
  pair: TurnPair,
  context: AttentionSourceContext,
  onDone: () => void,
  onExtractionFailed?: (agent: string, reason: string) => void,
  onExtractionSucceeded?: (agent: string) => void
): void {
  // ponytail: cheap prefilter — no question mark and no assumption language
  // means nothing to extract; saves an LLM call on most turns.
  if (!/\?|assum/i.test(pair.assistant)) return;
  void serialize(() => extract(sessionId, cwd, pair, context, onExtractionFailed, onExtractionSucceeded))
    .then(onDone)
    .catch(() => undefined);
}

/** Feed every transcript line here. */
export function onTranscript(
  sessionId: string,
  cwd: string | undefined,
  line: string,
  onDone: () => void,
  context: AttentionSourceContext = { sessionId },
  onSchemaDrift?: (agent: string) => void,
  onExtractionFailed?: (agent: string, reason: string) => void,
  onExtractionSucceeded?: (agent: string) => void
): void {
  // Tracked on every line, independent of whether this one parses into
  // extractable text below — the drift signal is about the envelope shape,
  // not any single turn's content.
  trackSchemaDrift(sessionId, line, context.agent, onSchemaDrift);
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
  // Every structured submitted user message can answer an older open card.
  // Queue this before fresh pair extraction so that the new pair's decisions
  // cannot be reconsidered using its own reply.
  enqueueReconciliation(sessionId, msg.text, onDone);
  // user reply closes the pending pair
  const assistant = assistantBuf.get(sessionId);
  assistantBuf.delete(sessionId);
  if (assistant && cwd)
    enqueue(sessionId, cwd, { assistant: assistant.text, user: msg.text }, assistant.context, onDone, onExtractionFailed, onExtractionSucceeded);
}

/** Feed Stop hooks here: turn ended with no user reply. Delayed so the
 *  500ms transcript tailer can deliver the turn's trailing assistant lines. */
export function onStop(
  sessionId: string,
  cwd: string | undefined,
  onDone: () => void,
  context: AttentionSourceContext = { sessionId },
  onExtractionFailed?: (agent: string, reason: string) => void,
  onExtractionSucceeded?: (agent: string) => void
): void {
  setTimeout(() => {
    const assistant = assistantBuf.get(sessionId);
    assistantBuf.delete(sessionId);
    if (assistant && cwd) {
      enqueue(
        sessionId,
        cwd,
        { assistant: assistant.text, user: null },
        assistant.context ?? { ...context },
        onDone,
        onExtractionFailed,
        onExtractionSucceeded
      );
    }
  }, 2000);
}
