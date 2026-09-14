import type { TrafficSnapshot } from "./repo";

export function trafficStateMessage(snapshot: TrafficSnapshot): string | null {
  if (snapshot.kind === "missing") return "Safe Router log not found on this Mac.";
  if (snapshot.kind === "v1") return "Older Safe Router log; this view requires v2.";
  if (snapshot.kind === "error") return "Traffic unavailable — could not read the router log.";
  if (snapshot.rows.length === 0) return "Log opened; no routed requests recorded.";
  return null;
}

export function trafficToken(value: number | null): string {
  return value === null ? "unknown" : value.toLocaleString();
}

export function trafficTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
