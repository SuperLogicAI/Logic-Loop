import { useEffect, useState } from "react";
import { getExtractorSettings, getSidebarLmPinned, getTrafficSeen, readSafeRouterTraffic, setTrafficSeen } from "./repo";
import { SIDEBAR_CONTROLS_REFRESH, showSidebarLm, showTraffic, type TrafficKind } from "./sidebarControls";
import type { ExtractorSettings } from "../types";

/** Visibility of the optional header controls (Plan 050 Part B). Re-reads on
 * mount, window focus, and after Sidebar LM settings change. */
export function useSidebarControls() {
  const [kind, setKind] = useState<TrafficKind>(null);
  const [seen, setSeen] = useState(false);
  const [lm, setLm] = useState<ExtractorSettings | "error" | null>(null);
  const [pinned, setPinned] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [snap, wasSeen, settings, pin] = await Promise.all([
        readSafeRouterTraffic(),
        getTrafficSeen().catch(() => false),
        getExtractorSettings().catch(() => "error" as const),
        getSidebarLmPinned().catch(() => null),
      ]);
      if (cancelled) return;
      setKind(snap.kind);
      setSeen(wasSeen);
      setLm(settings);
      setPinned(pin);
      if (!wasSeen && (snap.kind === "v1" || snap.kind === "ready")) {
        setSeen(true);
        void setTrafficSeen().catch(() => undefined);
      }
    };
    void load();
    window.addEventListener("focus", load);
    window.addEventListener(SIDEBAR_CONTROLS_REFRESH, load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
      window.removeEventListener(SIDEBAR_CONTROLS_REFRESH, load);
    };
  }, []);

  return { kind, traffic: showTraffic(kind, seen), lm: showSidebarLm(lm, pinned) };
}
