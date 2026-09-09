import { invoke } from "@tauri-apps/api/core";

/** Idea Board (Phase 18): `.logic-loop/board.md`, one per project, git-
 * committed. Human-shaped by construction — a card is one `## ` heading, a
 * `status:` line decides its column. Parse/splice/append never rewrite the
 * whole file from parsed state: a hand-edited card or the file's preamble
 * survives byte-identical outside the range this touches. */

export type BoardStatus = "idea" | "planned" | "building" | "later" | "done";

export const NOW_CAP = 3;

export interface Card {
  title: string;
  status: BoardStatus;
  body: string; // one-liner + any unrecognized lines, verbatim, minus status:/link:/next:/now:
  link: string | null;
  next: string | null;
  now: boolean; // Phase 20: human-selected "do this next", orthogonal to status
  color: string | null; // hex accent, human-chosen, orthogonal to status/now
  start: number; // byte offset of this card's "## " in the source md
  end: number; // byte offset where the next card (or EOF) begins
}

const STATUSES: BoardStatus[] = ["idea", "planned", "building", "later", "done"];

function isStatus(s: string): s is BoardStatus {
  return (STATUSES as string[]).includes(s);
}

/** Preamble is everything before the first `## ` heading — kept untouched. */
export function preambleOf(md: string): string {
  const i = md.search(/^## /m);
  return i === -1 ? md : md.slice(0, i);
}

export function parseBoard(md: string): Card[] {
  const headingRe = /^## /gm;
  const starts: number[] = [];
  for (const m of md.matchAll(headingRe)) starts.push(m.index!);

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : md.length;
    const block = md.slice(start, end);
    const lines = block.split("\n");
    const title = lines[0].replace(/^## /, "").trim();

    let status: BoardStatus = "idea";
    let link: string | null = null;
    let next: string | null = null;
    let now = false;
    let color: string | null = null;
    const bodyLines: string[] = [];
    for (const line of lines.slice(1)) {
      const statusM = /^status:\s*(.+)$/.exec(line);
      const linkM = /^link:\s*(.+)$/.exec(line);
      const nextM = /^next:\s*(.+)$/.exec(line);
      const nowM = /^now:\s*true\s*$/.exec(line);
      const colorM = /^color:\s*(#[0-9a-fA-F]{3,8})\s*$/.exec(line);
      if (statusM && isStatus(statusM[1].trim())) status = statusM[1].trim() as BoardStatus;
      else if (linkM) link = linkM[1].trim();
      else if (nextM) next = nextM[1].trim();
      else if (nowM) now = true;
      else if (colorM) color = colorM[1];
      else bodyLines.push(line);
    }
    // Trim trailing blank lines the block's own end boundary picked up.
    while (bodyLines.length && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();

    return { title, status, body: bodyLines.join("\n").trim(), link, next, now, color, start, end };
  });
}

function serializeCard(c: Omit<Card, "start" | "end">): string {
  const lines = [`## ${c.title}`, `status: ${c.status}`];
  if (c.body) lines.push(c.body);
  if (c.link) lines.push(`link: ${c.link}`);
  if (c.next) lines.push(`next: ${c.next}`);
  if (c.now) lines.push("now: true");
  if (c.color) lines.push(`color: ${c.color}`);
  return lines.join("\n") + "\n";
}

/** Replace exactly one card's byte range (identified by `card.start`/`end`,
 * from a `parseBoard` result) with its edited form. Everything outside that
 * range — preamble, sibling cards, hand-typed content — is untouched. */
export function spliceCard(md: string, card: Card): string {
  const serialized = serializeCard(card);
  return md.slice(0, card.start) + serialized + md.slice(card.end);
}

export function deleteCard(md: string, card: Card): string {
  return md.slice(0, card.start) + md.slice(card.end);
}

/** Convenience wrapper over splice: change only the status line. */
export function moveCard(md: string, card: Card, status: BoardStatus): string {
  return spliceCard(md, { ...card, status });
}

/** Toggle a card's Now flag. Turning one on is capped at `NOW_CAP` — `cards`
 * is the already-parsed board so the cap is checked against live state, not
 * re-derived here. Returns `md` unchanged (not an error) when the cap is
 * hit; the caller tells cap-hit apart from success by comparing the
 * returned string to the input. Turning a card off always succeeds — the
 * cap only ever blocks adding, never removing. */
export function toggleNow(md: string, card: Card, cards: Card[]): string {
  if (!card.now) {
    const nowCount = cards.filter((c) => c.now).length;
    if (nowCount >= NOW_CAP) return md;
  }
  return spliceCard(md, { ...card, now: !card.now });
}

/** Append a new card at EOF. Empty title → first line of `body` becomes the
 * title ("Brain Dump" quick-add) and the remaining body follows below it. */
export function appendCard(
  md: string,
  card: { title: string; body: string; status?: BoardStatus; link?: string | null; next?: string | null }
): string {
  let title = card.title.trim();
  let body = card.body;
  if (!title) {
    const [first, ...rest] = body.split("\n");
    title = first.trim();
    body = rest.join("\n").trim();
  }
  const serialized = serializeCard({
    title,
    status: card.status ?? "idea",
    body,
    link: card.link ?? null,
    next: card.next ?? null,
    now: false,
    color: null,
  });
  const sep = md.length === 0 || md.endsWith("\n\n") ? "" : md.endsWith("\n") ? "\n" : "\n\n";
  return md + sep + serialized;
}

export function readBoard(projectKey: string): Promise<string> {
  return invoke<string>("read_board", { projectKey }).catch(() => "");
}

export function writeBoard(projectKey: string, content: string): Promise<void> {
  return invoke("write_board", { projectKey, content });
}
