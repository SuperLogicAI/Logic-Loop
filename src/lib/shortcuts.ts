// Input types that take typed text — a focused checkbox/button/range is not
// an editing context, so ⌘K etc. still work there.
const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** The minimal element shape this reads — a structural type so checks can use
 * plain objects instead of a DOM. */
export interface ShortcutTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  classList?: { contains(token: string): boolean };
}

/** True when keyboard focus is in a field the human is typing into, where
 * app-level ⌘ shortcuts must yield to the field's own behavior. xterm's
 * hidden helper textarea is the terminal, not a field: terminals keep every
 * app shortcut. */
export function isEditableShortcutTarget(el: ShortcutTarget | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return !el.classList?.contains("xterm-helper-textarea");
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((el.type ?? "").toLowerCase());
  return false;
}
