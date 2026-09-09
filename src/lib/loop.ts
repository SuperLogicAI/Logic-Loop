// Turn provenance + loop digest (Phase 15). Pure reducer over the same event
// row shape `delta.ts` already uses — no new query primitive.
import { textFromTranscriptLine } from "./decisions";
import type { DeltaDecision, EventRow } from "./delta";

export interface Iteration {
  startTs: number;
  /** null until a Stop closes it — the trailing iteration of a still-running
   * loop stays open rather than being dropped. */
  endTs: number | null;
  firstAssistantText: string;
  toolCount: number;
  errorCount: number;
  decisions: DeltaDecision[];
  noop: boolean;
}

const NOOP_PHRASES = ["no change", "nothing to do", "still waiting", "all good"];

function isNoop(text: string): boolean {
  const t = text.toLowerCase();
  return NOOP_PHRASES.some((p) => t.includes(p));
}

function parsePayload(r: EventRow): Record<string, unknown> | null {
  try {
    return JSON.parse(r.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Rows written before this phase (or from a session with no tether) carry
 * no `provenance` field — default `human`, the same safe default `App.tsx`
 * stamps live (decisions #4/#5 in PLAN.md's Phase 15 write-up). */
function provenanceOf(r: EventRow): "human" | "auto" {
  return parsePayload(r)?.["provenance"] === "auto" ? "auto" : "human";
}

/** Groups an ordered event stream into iterations: an iteration opens at an
 * `auto` UserPromptSubmit and closes at the next Stop. A human
 * UserPromptSubmit never opens one and drops any dangling reference to the
 * previous auto iteration. Decision extraction is async and its row always
 * lands *after* the iteration's own Stop (found 2026-09-06: extraction took
 * 6-7s, consistently landing in the gap after `endTs` and before the next
 * iteration's `startTs` — never inside `[startTs, endTs)`). So a decision is
 * attached to whichever iteration has the latest `startTs` at or before the
 * decision's timestamp — that iteration owns everything up to the next
 * iteration's start, not just up to its own Stop.
 *
 * The same race hits the closing assistant message itself, not just
 * decisions (found 2026-09-06, same session): `hook:Stop` is a shell hook
 * that fires the instant the model finishes, while the transcript tailer
 * reads the JSONL line off disk independently and can land ~300ms later —
 * for a one-line reply with no tool calls (e.g. "no change"), that's the
 * *only* assistant line the iteration has, and it was arriving after `open`
 * had already been nulled at Stop, so it was silently dropped: noop
 * detection saw stale/empty text and never fired. Fix: `open` keeps
 * attributing rows (transcript, tools) past its own Stop — only the next
 * `UserPromptSubmit` (or end of the row stream) actually closes it out for
 * noop purposes. `endTs` itself still gets set the instant Stop is seen.
 *
 * ponytail: iterations aren't grouped into separate "runs" split by human
 * turns in between — `isLoopRun` just checks the total count. A session
 * shaped auto → human → auto (no consecutive pair on either side of the
 * human turn) would misread as one 2-iteration loop; not observed in
 * practice and cheap to fix later if it shows up in dogfood. */
export function groupIterations(rows: EventRow[], decisionRows: DeltaDecision[]): Iteration[] {
  const iterations: Iteration[] = [];
  let open: Iteration | null = null;
  let lastAssistantText = "";
  for (const r of rows) {
    if (r.type === "hook:UserPromptSubmit") {
      if (open && open.endTs !== null) open.noop = isNoop(lastAssistantText);
      if (provenanceOf(r) === "auto") {
        open = {
          startTs: r.ts,
          endTs: null,
          firstAssistantText: "",
          toolCount: 0,
          errorCount: 0,
          decisions: [],
          noop: false,
        };
        iterations.push(open);
      } else {
        open = null;
      }
      lastAssistantText = "";
      continue;
    }
    if (!open) continue;
    if (r.type === "hook:PostToolUse") {
      open.toolCount++;
      const p = parsePayload(r);
      const resp = p?.["tool_response"];
      if (typeof resp === "object" && resp !== null && (resp as Record<string, unknown>)["is_error"] === true) {
        open.errorCount++;
      }
    } else if (r.type === "transcript") {
      const msg = textFromTranscriptLine(r.payload_json);
      if (msg && msg.role === "assistant" && msg.text) {
        if (!open.firstAssistantText) open.firstAssistantText = msg.text.slice(0, 400);
        lastAssistantText = msg.text;
      }
    } else if (r.type === "hook:Stop") {
      open.endTs = r.ts;
    }
  }
  if (open && open.endTs !== null) open.noop = isNoop(lastAssistantText);
  for (const d of decisionRows) {
    let it: Iteration | undefined;
    for (const cand of iterations) {
      if (d.ts >= cand.startTs) it = cand;
      else break;
    }
    if (it) it.decisions.push(d);
  }
  return iterations;
}

/** ≥2 auto opens is what makes a run worth digesting instead of rendering
 * flat — one stray auto resubmit isn't a "loop". */
export function isLoopRun(iterations: Iteration[]): boolean {
  return iterations.length >= 2;
}

export type DigestLine =
  | { kind: "noop-run"; count: number }
  | { kind: "iteration"; iteration: Iteration };

/** Collapses consecutive no-op iterations into one `×N no change` line;
 * iterations are already chronological, so "consecutive in the array" is
 * "consecutive in time" — no separate adjacency check needed. */
export function collapseNoopRuns(iterations: Iteration[]): DigestLine[] {
  const lines: DigestLine[] = [];
  let i = 0;
  while (i < iterations.length) {
    if (iterations[i].noop) {
      let count = 0;
      while (i < iterations.length && iterations[i].noop) {
        count++;
        i++;
      }
      lines.push({ kind: "noop-run", count });
    } else {
      lines.push({ kind: "iteration", iteration: iterations[i] });
      i++;
    }
  }
  return lines;
}
