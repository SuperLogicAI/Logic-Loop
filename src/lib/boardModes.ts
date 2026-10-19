import { moveCard, parseBoard, placeCard, type BoardStatus, type Card } from "./board";

export type BoardMode = "workflow" | "list" | "kanban";
export type KanbanLane = "todo" | "progress" | "done";
export const WORKFLOW_COLUMNS: { key: BoardStatus; label: string }[] = [
  { key: "idea", label: "Idea" }, { key: "planned", label: "Planned" },
  { key: "building", label: "Building" }, { key: "later", label: "Later" },
  { key: "done", label: "Done" },
];
export const KANBAN_COLUMNS: { key: KanbanLane; label: string }[] = [
  { key: "todo", label: "To do" }, { key: "progress", label: "In progress" },
  { key: "done", label: "Done" },
];
export function parseBoardMode(value: string | null): BoardMode {
  return value === "list" || value === "kanban" ? value : "workflow";
}
export function kanbanLane(status: BoardStatus): KanbanLane {
  return status === "building" ? "progress" : status === "done" ? "done" : "todo";
}
export function kanbanStatus(status: BoardStatus, lane: KanbanLane): BoardStatus {
  if (kanbanLane(status) === lane) return status;
  return lane === "todo" ? "planned" : lane === "progress" ? "building" : "done";
}
export function boardColumns(mode: BoardMode, cards: Card[]) {
  if (mode === "list") return [{ key: "list", label: "All cards", cards: [...cards] }];
  const columns = mode === "workflow" ? WORKFLOW_COLUMNS : KANBAN_COLUMNS;
  return columns.map((col) => ({ ...col, cards: cards.filter((card) =>
    (mode === "workflow" ? card.status : kanbanLane(card.status)) === col.key) }));
}
/** Plan 067 drag-and-drop write: place `card` before `anchor` (null = after
 * the last card of column `key`), then give it that column's status; List
 * keeps status. Both cards come from `parseBoard(md)` via `freshBoardCard`,
 * so the moved card's title is unique. */
export function dropCard(md: string, mode: BoardMode, card: Card, key: string, anchor: Card | null): string {
  const status = mode === "list" ? card.status
    : mode === "kanban" ? kanbanStatus(card.status, key as KanbanLane) : key as BoardStatus;
  const column = boardColumns(mode, parseBoard(md)).find((col) => col.key === key)?.cards ?? [];
  const others = column.filter((c) => c.start !== card.start);
  const slot = anchor ? others.findIndex((c) => c.start === anchor.start) : others.length;
  // Same visible slot = no file move, even when file order has other cards between.
  const stays = anchor?.start === card.start || column.findIndex((c) => c.start === card.start) === slot;
  const placed = stays ? md : placeCard(md, card, anchor?.start ?? others[others.length - 1]?.end ?? card.start);
  if (status === card.status) return placed;
  return moveCard(placed, parseBoard(placed).find((c) => c.title === card.title)!, status);
}
export function freshBoardCard(card: Card, displayed: Card[], fresh: Card[]): Card {
  const before = displayed.filter((c) => c.title === card.title);
  const after = fresh.filter((c) => c.title === card.title);
  if (before.length > 1 || after.length > 1) {
    throw new Error("Duplicate card titles: rename them in Markdown before editing this card.");
  }
  if (before.length !== 1 || after.length !== 1) {
    throw new Error("Card removed or renamed. Reload the board before editing.");
  }
  return after[0];
}
