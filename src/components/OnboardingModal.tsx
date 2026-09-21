import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import {
  ADAPTERS,
  adapterProgress,
  formatAdapterError,
  type AdapterId,
  type AdapterRuntimeState,
} from "../lib/onboarding";
import { validateProjectDir } from "../lib/pty";

interface Props {
  adapterStates: Record<AdapterId, AdapterRuntimeState>;
  observedAdapters: Set<AdapterId>;
  notificationsEnabled: boolean;
  persistenceError: string | null;
  onToggleAdapter: (id: AdapterId) => Promise<void>;
  onRequestNotifications: () => Promise<boolean>;
  onLaunch: (cwd: string, cmd: string | undefined, name: string) => Promise<string>;
  onClose: () => void;
}

type LaunchChoiceId = AdapterId | "shell";

interface LaunchState {
  tabId: string;
  agentId: AdapterId | null;
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
  onLaunch,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [requestingNotifications, setRequestingNotifications] = useState(false);
  const [notificationAttempted, setNotificationAttempted] = useState(false);

  const [folder, setFolder] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [launchChoice, setLaunchChoice] = useState<LaunchChoiceId>("shell");
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<LaunchState | null>(null);

  const pickFolder = async () => {
    const picked = await openFolderDialog({ directory: true, multiple: false });
    if (!picked || Array.isArray(picked)) return; // cancel is a no-op
    try {
      const resolved = await validateProjectDir(picked);
      setFolder(resolved);
      setFolderError(null);
      // A fresh pick means "start again is fine" — otherwise Start stays
      // disabled forever after the first successful launch (see below).
      setLaunched(null);
    } catch (error) {
      // Keep whatever folder was already selected — an invalid pick must
      // surface as an error, never silently fall back to home (plan033).
      setFolderError(formatAdapterError(error));
    }
  };

  const startSession = async () => {
    if (!folder || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      const chosen = launchChoice === "shell" ? null : ADAPTERS.find((a) => a.id === launchChoice) ?? null;
      const name = folder.split("/").filter(Boolean).pop() ?? folder;
      const tabId = await onLaunch(folder, chosen?.command, name);
      setLaunched({ tabId, agentId: chosen?.id ?? null });
    } catch (error) {
      setStartError(formatAdapterError(error));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

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
            <ul className="mt-2 max-w-2xl list-disc space-y-1 pl-4 text-[11px] leading-5 text-zinc-500">
              <li>
                Shows "Not detected" but you know it's installed? Confirm it's on PATH (e.g.{" "}
                <span className="font-mono">which claude</span>) and fully quit + relaunch Logic Loop —
                a shell config change made after Logic Loop started won't be picked up otherwise.
              </li>
              <li>
                "On" means hooks are installed — it doesn't confirm the CLI actually runs in your shell.
                Verify with <span className="font-mono">&lt;command&gt; --version</span> in a terminal tab.
              </li>
              <li>
                A decision card only appears when the agent asks <em>you</em> something — casual chat
                won't produce one.
              </li>
            </ul>
          </div>
        </header>

        <div className="space-y-3 px-5 py-3">
          <div className="space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-zinc-100">Start a session</div>
              <p className="mt-0.5 text-xs text-zinc-400">
                Pick a project folder and an agent — or a plain shell — to open your first terminal tab.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void pickFolder()}
                className="h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                Choose folder…
              </button>
              <span className="min-w-0 truncate text-xs text-zinc-400" title={folder ?? undefined}>
                {folder ?? "No folder selected"}
              </span>
            </div>
            {folderError && (
              <p className="break-words rounded bg-red-950/40 px-2 py-1.5 text-xs text-red-300">{folderError}</p>
            )}
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Agent to launch">
              {[...ADAPTERS.map((a) => ({ id: a.id as LaunchChoiceId, label: a.label })), { id: "shell" as LaunchChoiceId, label: "Plain shell" }].map(
                (opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={launchChoice === opt.id}
                    onClick={() => setLaunchChoice(opt.id)}
                    className={`h-7 rounded-full px-3 text-xs focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      launchChoice === opt.id
                        ? "bg-sky-950 text-sky-300"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                // `starting` alone only blocks overlapping clicks *during*
                // the in-flight launch — a genuine second click landing
                // after `onLaunch` has already resolved (local IPC is fast
                // enough that this reliably beats human double-click
                // timing) sailed right through it and spawned a second tab
                // (docs/TESTING.md Finding 3). `launched` stays set once a
                // session has actually started, so Start won't fire again
                // for the same pick — pickFolder clears it on a new pick.
                disabled={!folder || starting || launched !== null}
                onClick={() => void startSession()}
                className="h-8 rounded-md bg-sky-500 px-3 text-xs font-semibold text-sky-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                {starting ? "Starting…" : "Start session"}
              </button>
              {startError && <span className="text-xs text-red-300">{startError}</span>}
            </div>
            {launched && (
              <p
                className={`text-xs ${
                  launched.agentId && observedAdapters.has(launched.agentId) ? "text-emerald-300" : "text-zinc-400"
                }`}
              >
                {launched.agentId === null
                  ? "Shell session started — check the new tab."
                  : observedAdapters.has(launched.agentId)
                    ? "Connected — first event received. Check the new tab."
                    : "Waiting for first event…"}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            {ADAPTERS.map((adapter) => {
              const state = adapterStates[adapter.id];
              const progress = adapterProgress(state, observedAdapters.has(adapter.id));
              const busy = state.operation !== null;
              const installUrl = progress === "not-detected" ? adapter.installUrl : undefined;
              const canToggle = (state.available === true || installUrl !== undefined) && !busy;
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
                    {adapter.id === "codex" && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Launch <span className="font-mono">codex</span> from the project directory you want to
                        track — Logic Loop reads the session's reported working directory as-is. First session
                        may also show Codex's own "Hooks need review" trust prompt — choose Trust all and
                        continue.
                      </p>
                    )}
                    {state.error && (
                      <p className="mt-2 break-words rounded bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
                        {state.error}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canToggle}
                    onClick={() => {
                      if (installUrl) void openUrl(installUrl);
                      else void onToggleAdapter(adapter.id);
                    }}
                    title={installUrl ? `Open ${adapter.label} installation instructions` : undefined}
                    className="h-8 min-w-20 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                  >
                    {installUrl
                      ? "Install"
                      : busy
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
