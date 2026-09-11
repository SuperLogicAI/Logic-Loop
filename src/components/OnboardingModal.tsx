import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ADAPTERS,
  adapterProgress,
  type AdapterId,
  type AdapterRuntimeState,
} from "../lib/onboarding";

interface Props {
  adapterStates: Record<AdapterId, AdapterRuntimeState>;
  observedAdapters: Set<AdapterId>;
  notificationsEnabled: boolean;
  persistenceError: string | null;
  onToggleAdapter: (id: AdapterId) => Promise<void>;
  onRequestNotifications: () => Promise<boolean>;
  onClose: () => void;
}

const PROGRESS_LABELS = {
  checking: "Checking installation…",
  "not-detected": "Not detected",
  "not-enabled": "Ready to enable",
  enabling: "Enabling…",
  disabling: "Disabling…",
  waiting: "Waiting for first event",
  connected: "Connected — first event received",
  error: "Setup failed",
} as const;

export function OnboardingModal({
  adapterStates,
  observedAdapters,
  notificationsEnabled,
  persistenceError,
  onToggleAdapter,
  onRequestNotifications,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [requestingNotifications, setRequestingNotifications] = useState(false);
  const [notificationAttempted, setNotificationAttempted] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const requestNotifications = async () => {
    setRequestingNotifications(true);
    await onRequestNotifications();
    setNotificationAttempted(true);
    setRequestingNotifications(false);
  };

  const containKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-3"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-setup-title"
        className="w-full max-w-4xl rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onKeyDownCapture={containKeyboard}
      >
        <header className="border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/loop.png" alt="" className="h-11 w-11" />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <div className="text-xl font-semibold tracking-tight text-zinc-100">Logic Loop</div>
                <div className="text-sm text-zinc-500">developed by Super Logic AI</div>
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Skip setup for now"
              className="rounded px-2 py-1 text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              ×
            </button>
          </div>
          <div className="mt-3">
            <h2 id="agent-setup-title" className="text-base font-semibold text-zinc-100">
              Connect your agents
            </h2>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-zinc-400">
              Logic Loop reads structured agent events to activate tab state and panels. It never
              interprets terminal output, and hooks never block your terminal sessions.
            </p>
          </div>
        </header>

        <div className="space-y-3 px-5 py-3">
          <div className="grid gap-2">
            {ADAPTERS.map((adapter) => {
              const state = adapterStates[adapter.id];
              const progress = adapterProgress(state, observedAdapters.has(adapter.id));
              const busy = state.operation !== null;
              const canToggle = state.available === true && !busy;
              return (
                <div
                  key={adapter.id}
                  className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 md:grid-cols-[minmax(9rem,0.8fr)_minmax(18rem,2fr)_auto] md:items-center"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <div className="text-sm font-medium text-zinc-100">{adapter.label}</div>
                    <div className="font-mono text-[11px] text-zinc-500">{adapter.command}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-emerald-300">
                        Activity
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          adapter.capabilities.decisions
                            ? "bg-sky-950 text-sky-300"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        Decisions {adapter.capabilities.decisions ? "included" : "not supported"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          adapter.capabilities.reentry
                            ? "bg-violet-950 text-violet-300"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        Re-entry {adapter.capabilities.reentry ? "included" : "not supported"}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                      <span
                        className={`shrink-0 ${
                          progress === "error"
                            ? "text-red-300"
                            : progress === "connected"
                              ? "text-emerald-300"
                              : "text-zinc-400"
                        }`}
                      >
                        {PROGRESS_LABELS[progress]}
                      </span>
                      <span aria-hidden="true" className="text-zinc-700">
                        •
                      </span>
                      <span className="truncate text-zinc-600" title={adapter.configLocation}>
                        {adapter.configLocation}
                      </span>
                    </div>
                    {state.error && (
                      <p className="mt-2 break-words rounded bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
                        {state.error}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canToggle}
                    onClick={() => void onToggleAdapter(adapter.id)}
                    className="h-8 min-w-20 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                  >
                    {busy
                      ? state.operation === "enabling"
                        ? "Enabling…"
                        : "Disabling…"
                      : state.error
                        ? "Retry"
                        : state.enabled
                          ? "Disable"
                          : "Enable"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-zinc-100">Desktop nudges</div>
              <p className="mt-0.5 text-xs text-zinc-400">
                Get notified when a background tab needs attention. Logic Loop asks only after you
                click the button.
              </p>
              {notificationAttempted && !notificationsEnabled && (
                <p className="mt-2 text-xs text-amber-300">
                  Notifications were not enabled. You can continue setup and change this later in
                  system settings.
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={notificationsEnabled || requestingNotifications}
              onClick={() => void requestNotifications()}
              className="h-8 rounded-md border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-default disabled:text-zinc-500 focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              {notificationsEnabled
                ? "Notifications enabled"
                : requestingNotifications
                  ? "Requesting…"
                  : "Enable notifications"}
            </button>
          </div>

          {persistenceError && (
            <p className="rounded bg-red-950/40 px-3 py-2 text-sm text-red-300">
              Setup preference could not be saved: {persistenceError}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
          <a
            href="https://superlogicai.com"
            onClick={(event) => {
              event.preventDefault();
              void openUrl("https://superlogicai.com");
            }}
            className="text-xs text-zinc-600 transition-colors hover:text-zinc-400 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Explore Super Logic AI ↗
          </a>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              Finish setup
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
