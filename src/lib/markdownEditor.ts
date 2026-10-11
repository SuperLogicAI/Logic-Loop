import { invoke } from "@tauri-apps/api/core";

// Plan 062: the markdown editor's pure helpers + Rust command wrappers. File
// access, not DB access, so it lives beside board.ts rather than in repo.ts.

export type WriteOutcome = { state: "saved" } | { state: "conflict"; current: string };

export const listMarkdown = (projectKey: string) => invoke<string[]>("md_list", { projectKey });
export const readMarkdown = (projectKey: string, name: string) => invoke<string>("md_read", { projectKey, name });
export const writeMarkdown = (projectKey: string, name: string, base: string, content: string) =>
  invoke<WriteOutcome>("md_write", { projectKey, name, base, content });

/** What a textarea holds for `disk`: browsers normalize CRLF to LF. */
export const toTextarea = (disk: string) => disk.replace(/\r\n/g, "\n");

/** Back to disk form: a CRLF file stays CRLF, so saving isn't a whole-file
 * diff. ponytail: a mixed-ending file becomes all-CRLF; per-line restore if
 * that ever shows up. */
export const toDisk = (draft: string, base: string) =>
  base.includes("\r\n") ? draft.replace(/\r?\n/g, "\r\n") : draft;

export const isDirty = (draft: string, base: string) => draft !== toTextarea(base);

/** Files agents read once at session start (Claude Code docs, prompt caching). */
export const AGENT_MEMORY_FILES = new Set(["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"]);

export type MdKind = "text" | "h1" | "h2" | "h3" | "marker" | "code" | "fence" | "strong" | "link" | "import" | "quote" | "rule";
export type MdToken = { kind: MdKind; text: string };

const INLINE = /`[^`]+`|\*\*[^*]+\*\*|\[[^\]]*\]\([^)\s]*\)|(?:^|\s)@[\w./~-]+/g;

/** Per-line tokens for the editor's colour layer. A token's text is always a
 * verbatim slice, so each line's tokens join back to the line exactly and the
 * layer stays aligned under the textarea. ponytail: line-level regexes, not a
 * CommonMark parser — a fence toggles on any ``` or ~~~ line, and nested or
 * multi-line inline syntax stays plain. */
export function highlightMarkdown(src: string): MdToken[][] {
  let fenced = false;
  return src.split("\n").map((line): MdToken[] => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return [{ kind: "fence", text: line }];
    }
    if (fenced) return [{ kind: "code", text: line }];
    const h = /^(#{1,6})\s/.exec(line);
    if (h) return [{ kind: h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3", text: line }];
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return [{ kind: "rule", text: line }];
    if (/^\s*>/.test(line)) return [{ kind: "quote", text: line }];

    const out: MdToken[] = [];
    const push = (kind: MdKind, text: string) => text && out.push({ kind, text });
    const list = /^(\s*)([-*+]|\d+[.)])(\s+(?:\[[ xX]\]\s)?)/.exec(line);
    const rest = list ? line.slice(list[0].length) : line;
    if (list) {
      push("text", list[1]);
      push("marker", list[2] + list[3]);
    }
    let last = 0;
    for (const m of rest.matchAll(INLINE)) {
      const at = m.index ?? 0;
      push("text", rest.slice(last, at));
      const t = m[0];
      push(t[0] === "`" ? "code" : t[0] === "*" ? "strong" : t[0] === "[" ? "link" : "import", t);
      last = at + t.length;
    }
    push("text", rest.slice(last));
    return out;
  });
}
