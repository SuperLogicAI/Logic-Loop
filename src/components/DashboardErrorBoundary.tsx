import { Component, type ReactNode } from "react";

interface Props {
  onReturnToWorkspace: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Plan 048: Home/Project Overview must never take the app down with them —
 * architecture invariant 2 ("fail open") applies to this UI-only surface
 * exactly like it does to the tour overlay. Terminals render in a sibling
 * subtree outside this boundary, so a crash here can't touch them either
 * way; this exists so the human isn't stuck on a blank/broken screen with no
 * way back. */
export class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("[dashboard]", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-zinc-900 p-6 text-center">
          <p className="text-sm text-zinc-300">Something went wrong showing this screen.</p>
          <p className="max-w-md text-xs text-zinc-500">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReturnToWorkspace();
            }}
          >
            Return to workspace
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
