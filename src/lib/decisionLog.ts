import { invoke } from "@tauri-apps/api/core";
import type { WriteOutcome } from "./markdownEditor";

// Plan 064: `.logic-loop/DECISIONS.md`, human-confirmed decisions. Pure
// helpers + Rust wrappers; the file is the record, no DB access here.

export const CAPS = { decision: 160, reason: 240, revisitIf: 120 } as const;
export const CLAUDE_LINK = "@.logic-loop/DECISIONS.md";
export const CODEX_LINK =
  "Project decisions live in `.logic-loop/DECISIONS.md`. Read it before changing anything it covers; lines marked SUPERSEDED are history.";

const ID = "D-\\d{8}-[0-9a-f]{4}";
const ENTRY = new RegExp(`^- (\\[SUPERSEDED by (${ID})\\] )?(${ID}) · (.*)$`);
const TRAILER = new RegExp(`\\(\\S+ · \\d{4}-\\d{2}-\\d{2} · card #(\\d+)\\)\\r?$`);

export const readDecisionLog = (projectKey: string) =>
  invoke<string>("read_decision_log", { projectKey }).catch(() => "");
export const appendDecisionLog = (projectKey: string, line: string) =>
  invoke<void>("append_decision_log", { projectKey, line });
export const writeDecisionLog = (projectKey: string, base: string, content: string) =>
  invoke<WriteOutcome>("write_decision_log", { projectKey, base, content });
export const decisionLogTravel = (projectKey: string) =>
  invoke<"tracked" | "ignored" | "no_repo">("decision_log_travel", { projectKey }).catch(() => "tracked" as const);

/** One line, no markdown structure, capped. */
export function cleanField(s: string, cap: number): string {
  return s.replace(/`{3,}/g, "").replace(/\s+/g, " ").replace(/^[\s#>-]+/, "").trim().slice(0, cap).trimEnd();
}

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface EntryInput {
  id: string;
  decision: string;
  reason: string;
  revisitIf?: string;
  supersedes?: string;
  agent: string | null;
  date: Date;
  cardId: number;
}

export function formatEntry(e: EntryInput): string {
  const decision = cleanField(e.decision, CAPS.decision);
  const reason = cleanField(e.reason, CAPS.reason);
  const revisit = cleanField(e.revisitIf ?? "", CAPS.revisitIf);
  const parts = [
    sentence(decision),
    sentence(/^because\b/i.test(reason) ? reason.replace(/^because/i, "Because") : `Because ${reason}`),
    revisit && sentence(/^revisit if\b/i.test(revisit) ? revisit.replace(/^revisit if/i, "Revisit if") : `Revisit if ${revisit}`),
    e.supersedes && `Supersedes ${e.supersedes}.`,
  ].filter(Boolean);
  const agent = (e.agent ?? "claude").toLowerCase().replace(/\s+/g, "-");
  return `- ${e.id} · ${parts.join(" ")} (${agent} · ${isoDate(e.date)} · card #${e.cardId})`;
}

export function newId(
  date: Date,
  existing: Iterable<string>,
  rand: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const taken = new Set(existing);
  const day = isoDate(date).replace(/-/g, "");
  for (let i = 0; i < 100; i++) {
    const hex = [...rand(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const id = `D-${day}-${hex}`;
    if (!taken.has(id)) return id;
  }
  throw new Error("could not pick an unused decision id");
}

export interface Entry {
  id: string;
  text: string;
  superseded: boolean;
}

export function currentEntries(file: string): Entry[] {
  return file.split("\n").flatMap((line) => {
    const m = ENTRY.exec(line.replace(/\r$/, ""));
    return m ? [{ id: m[3], text: m[4], superseded: Boolean(m[1]) }] : [];
  });
}

/** card id → entry id, from the end-anchored trailer only. */
export function rememberedCards(file: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of file.split("\n")) {
    const m = ENTRY.exec(line.replace(/\r$/, ""));
    const t = m && TRAILER.exec(m[4]);
    if (m && t) out.set(Number(t[1]), m[3]);
  }
  return out;
}

export function supersede(file: string, oldId: string, newLine: string): string {
  const newIdMatch = ENTRY.exec(newLine);
  if (!newIdMatch) throw new Error("new line is not a decision entry");
  const lines = file.split("\n");
  const hits = lines.flatMap((l, i) => (ENTRY.exec(l.replace(/\r$/, ""))?.[3] === oldId ? [i] : []));
  if (hits.length === 0) throw new Error(`${oldId} is not in DECISIONS.md`);
  if (hits.length > 1) throw new Error(`${oldId} appears more than once in DECISIONS.md`);
  const i = hits[0];
  if (lines[i].startsWith("- [SUPERSEDED")) throw new Error(`${oldId} is already superseded`);
  lines[i] = `- [SUPERSEDED by ${newIdMatch[3]}] ${lines[i].slice(2)}`;
  const joined = lines.join("\n");
  return `${joined}${joined === "" || joined.endsWith("\n") ? "" : "\n"}${newLine}\n`;
}

// Link lines in CLAUDE.md / AGENTS.md: add is idempotent; add then remove
// is byte-identical (no trailing newline is added when the file lacked one).
const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

export const hasLinkLine = (text: string, line: string) => text.split("\n").some((l) => l.trim() === line);

export function addLinkLine(text: string, line: string): string {
  if (hasLinkLine(text, line)) return text;
  const eol = eolOf(text);
  if (text === "") return line + eol;
  return text.endsWith("\n") ? text + line + eol : text + eol + line;
}

export function removeLinkLine(text: string, line: string): string {
  const eol = eolOf(text);
  if (text.trim() === line) return "";
  if (text.endsWith(eol + line)) return text.slice(0, -(eol + line).length);
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim() === line);
  if (i < 0) return text;
  lines.splice(i, 1);
  return lines.join("\n");
}
