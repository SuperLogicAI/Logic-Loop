// Plan 055: Claude Code's multiple-choice prompts (`AskUserQuestion`) are a
// tool call, not text, so transcript extraction never sees them. The hooks
// carry them structured: PreToolUse has `tool_input.questions[]` while the
// prompt is open, PostToolUse adds `tool_response.answers` ({question: label})
// after you pick. Pure parsers, no model call. Agent text is untrusted data
// (invariant 5): only strings and booleans are read, nothing is interpreted.

export const ASK_USER_QUESTION_SOURCE = "ask_user_question";

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect: boolean;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function isAskUserQuestion(p: Record<string, unknown>, event: string): boolean {
  return p["hook_event_name"] === event && p["tool_name"] === "AskUserQuestion";
}

function questionsOf(input: unknown): AskQuestion[] {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.flatMap((q): AskQuestion[] => {
    if (typeof q !== "object" || q === null) return [];
    const r = q as Record<string, unknown>;
    const question = str(r.question);
    if (!question) return [];
    const options = (Array.isArray(r.options) ? r.options : []).flatMap((o): AskOption[] => {
      const label = str((o as { label?: unknown } | null)?.label);
      if (!label) return [];
      const description = str((o as { description?: unknown }).description);
      return [description ? { label, description } : { label }];
    });
    const header = str(r.header);
    return [{ question, ...(header ? { header } : {}), options, multiSelect: r.multiSelect === true }];
  });
}

/** Questions from a PreToolUse `AskUserQuestion` payload; [] for anything else. */
export function questionsFromPre(p: Record<string, unknown>): AskQuestion[] {
  return isAskUserQuestion(p, "PreToolUse") ? questionsOf(p["tool_input"]) : [];
}

/** question → chosen label(s) from a PostToolUse `AskUserQuestion` payload. */
export function answersFromPost(p: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  if (!isAskUserQuestion(p, "PostToolUse")) return out;
  const answers = (p["tool_response"] as { answers?: unknown } | null)?.answers;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return out;
  for (const [question, answer] of Object.entries(answers)) {
    const a = str(answer);
    if (a) out.set(question, a);
  }
  return out;
}

/** The context_json stored on a multiple-choice card. */
export function askContextJson(q: AskQuestion, toolUseId: unknown): string {
  return JSON.stringify({
    source: ASK_USER_QUESTION_SOURCE,
    tool_use_id: typeof toolUseId === "string" ? toolUseId : null,
    header: q.header ?? null,
    options: q.options,
    multiSelect: q.multiSelect,
  });
}

/** Option labels for a card created from `AskUserQuestion`, else null. */
export function askOptionsFromContext(contextJson: string): AskOption[] | null {
  try {
    const c = JSON.parse(contextJson) as { source?: unknown; options?: unknown };
    if (c?.source !== ASK_USER_QUESTION_SOURCE) return null;
    return Array.isArray(c.options) ? c.options.filter((o): o is AskOption => typeof o?.label === "string") : [];
  } catch {
    return null;
  }
}
