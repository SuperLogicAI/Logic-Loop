import { useCallback, useEffect, useState } from "react";
import {
  antigravityDetect,
  antigravityHooksRemove,
  antigravityHooksSetup,
  antigravityHooksStatus,
  claudeDetect,
  codexDetect,
  codexHooksRemove,
  codexHooksSetup,
  codexHooksStatus,
  hooksRemove,
  hooksSetup,
  hooksStatus,
  opencodeDetect,
  opencodeHooksRemove,
  opencodeHooksSetup,
  opencodeHooksStatus,
} from "../lib/ingest";
import type { LockInMode } from "../lib/lockIn";
import {
  ADAPTERS,
  formatAdapterError,
  ONBOARDING_VERSION,
  type AdapterId,
  type AdapterRuntimeState,
} from "../lib/onboarding";
import * as repo from "../lib/repo";
import type { PanelMode } from "../types";
import { OnboardingModal } from "./OnboardingModal";
import { PanelIcon } from "./PanelIcon";

interface AdapterActions {
  detect: () => Promise<boolean>;
  status: () => Promise<boolean>;
  setup: () => Promise<void>;
  remove: () => Promise<void>;
}

const ADAPTER_ACTIONS: Record<AdapterId, AdapterActions> = {
  claude: { detect: claudeDetect, status: hooksStatus, setup: hooksSetup, remove: hooksRemove },
  codex: { detect: codexDetect, status: codexHooksStatus, setup: codexHooksSetup, remove: codexHooksRemove },
  opencode: { detect: opencodeDetect, status: opencodeHooksStatus, setup: opencodeHooksSetup, remove: opencodeHooksRemove },
  antigravity: { detect: antigravityDetect, status: antigravityHooksStatus, setup: antigravityHooksSetup, remove: antigravityHooksRemove },
};

const initialAdapterStates = Object.fromEntries(
  ADAPTERS.map((adapter) => [adapter.id, { available: null, enabled: null, operation: "checking", error: null }])
) as Record<AdapterId, AdapterRuntimeState>;

interface Props {
  panelMode: PanelMode;
  onTogglePanel: () => void;
  lockInMode: LockInMode;
  onLockIn: () => void;
  onTimedLockIn: () => void;
  onUnlock: () => void;
  observedAdapters: Set<AdapterId>;
  notificationsEnabled: boolean;
  onRequestNotifications: () => Promise<boolean>;
}

export function AgentStatusBar({
  panelMode,
  onTogglePanel,
  lockInMode,
  onLockIn,
  onTimedLockIn,
  onUnlock,
  observedAdapters,
  notificationsEnabled,
  onRequestNotifications,
}: Props) {
  const [adapterStates, setAdapterStates] = useState(initialAdapterStates);
  const [setupOpen, setSetupOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    for (const adapter of ADAPTERS) {
      const actions = ADAPTER_ACTIONS[adapter.id];
      void actions.detect().then(async (available) => ({
        available,
        enabled: available ? await actions.status() : false,
      })).then(({ available, enabled }) => {
        if (cancelled) return;
        setAdapterStates((current) => ({
          ...current,
          [adapter.id]: { available, enabled, operation: null, error: null },
        }));
      }).catch((error: unknown) => {
        if (cancelled) return;
        setAdapterStates((current) => ({
          ...current,
          [adapter.id]: { available: true, enabled: false, operation: null, error: formatAdapterError(error) },
        }));
        setSetupOpen(true);
      });
    }

    void repo.getOnboardingVersion().then((version) => {
      if (!cancelled && version < ONBOARDING_VERSION) setSetupOpen(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setPersistenceError(formatAdapterError(error));
      setSetupOpen(true);
    });

    return () => { cancelled = true; };
  }, []);

  const toggleAdapter = useCallback(async (id: AdapterId) => {
    const before = adapterStates[id];
    if (!before.available || before.operation) return;
    const enabling = !before.enabled;
    setAdapterStates((current) => ({
      ...current,
      [id]: { ...current[id], operation: enabling ? "enabling" : "disabling", error: null },
    }));
    try {
      await (enabling ? ADAPTER_ACTIONS[id].setup() : ADAPTER_ACTIONS[id].remove());
      setAdapterStates((current) => ({
        ...current,
        [id]: { ...current[id], enabled: enabling, operation: null, error: null },
      }));
    } catch (error: unknown) {
      setAdapterStates((current) => ({
        ...current,
        [id]: { ...current[id], enabled: before.enabled, operation: null, error: formatAdapterError(error) },
      }));
      setSetupOpen(true);
    }
  }, [adapterStates]);

  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setPersistenceError(null);
    void repo.setOnboardingVersion(ONBOARDING_VERSION).catch((error: unknown) => {
      setPersistenceError(formatAdapterError(error));
    });
  }, []);

  const hookClass = (enabled: boolean | null, primary = false) =>
    `flex h-6 shrink-0 items-center rounded-full px-3 text-xs ${
      enabled
        ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
        : primary
          ? "animate-pulse bg-amber-900/60 font-semibold text-amber-300 hover:bg-amber-800/60"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
    }`;

  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-1.5">
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-sky-400"
            aria-label={panelMode === "expanded" ? "Fold project panel" : "Expand project panel"}
            title={panelMode === "expanded" ? "Fold project panel" : "Expand project panel"}
            onClick={onTogglePanel}
          >
            <PanelIcon name={panelMode === "expanded" ? "fold" : "expand"} className="h-5 w-5" />
          </button>
          <div
            className="flex h-7 shrink-0 items-center overflow-hidden rounded-full border border-zinc-700 text-zinc-500"
            data-lock-in-control
            role="group"
            aria-label="Lock-in controls"
          >
            {lockInMode === "off" ? (
              <>
                <button type="button" className="flex h-full w-7 items-center justify-center hover:bg-zinc-800 hover:text-zinc-200 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400" aria-label="Enter Lock-in until manually unlocked" title="Lock in — silence notifications and panel emphasis until manually unlocked" onClick={onLockIn}>
                  <PanelIcon name="lock-in" className="h-4 w-4" />
                </button>
                <span aria-hidden="true" className="h-4 border-l border-zinc-700" />
                <button type="button" className="flex h-full w-7 items-center justify-center hover:bg-zinc-800 hover:text-zinc-200 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400" aria-label="Enter Lock-in for 60 minutes" title="Timed Lock-in — silence notifications and panel emphasis for 60 minutes" onClick={onTimedLockIn}>
                  <PanelIcon name="timed-lock" className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="flex h-full w-8 items-center justify-center bg-zinc-800 text-zinc-200 hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400"
                aria-pressed={true}
                aria-label={lockInMode === "timed" ? "Exit 60-minute Lock-in" : "Exit Lock-in"}
                title={lockInMode === "timed" ? "Exit 60-minute Lock-in — restore notifications and panel emphasis" : "Exit Lock-in — restore notifications and panel emphasis"}
                onClick={onUnlock}
              >
                <PanelIcon name="unlock" className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto">
          <button type="button" onClick={() => setSetupOpen(true)} className="flex h-6 shrink-0 items-center rounded-full border border-zinc-700 px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-400">
            Setup
          </button>
          {(["antigravity", "claude", "codex", "opencode"] as const).map((id) => {
            const state = adapterStates[id];
            if (state.available === false) return null;
            const label = ADAPTERS.find((adapter) => adapter.id === id)?.label ?? id;
            return (
              <button key={id} type="button" className={hookClass(state.enabled, id === "claude")} onClick={() => void toggleAdapter(id)} title={`Toggle ${label} structured hooks`}>
                {id} {state.enabled === null ? "?" : state.enabled ? "on" : "off"}
              </button>
            );
          })}
        </div>
      </div>
      {setupOpen && (
        <OnboardingModal
          adapterStates={adapterStates}
          observedAdapters={observedAdapters}
          notificationsEnabled={notificationsEnabled}
          persistenceError={persistenceError}
          onToggleAdapter={toggleAdapter}
          onRequestNotifications={onRequestNotifications}
          onClose={closeSetup}
        />
      )}
    </>
  );
}
