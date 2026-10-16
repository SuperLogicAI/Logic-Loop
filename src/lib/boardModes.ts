import type { BoardStatus, Card } from "./board";

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
