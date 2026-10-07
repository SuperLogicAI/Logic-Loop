// Plan 054: subtle context-window meter, right-aligned in the Idea Board bar.
import { contextFill, formatTokens, type ContextUsage } from "../lib/contextMeter";

export function ContextMeter({ usage, agent }: { usage: ContextUsage; agent: string }) {
  const fill = contextFill(usage.percent);
  const tokens =
    usage.usedTokens !== null && usage.windowTokens !== null
      ? `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.windowTokens)} tokens · `
      : "";
  return (
    <span
      className="ml-auto flex shrink-0 cursor-default items-center gap-1.5 text-xs text-zinc-500"
      title={`${tokens}${agent} context window`}
      onClick={(e) => e.stopPropagation()}
    >
      ctx
      <span className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
        <span
          className={`block h-full rounded-full ${fill >= 90 ? "bg-danger-500" : fill >= 70 ? "bg-attn-400" : "bg-info-500"}`}
          style={{ width: `${fill}%` }}
        />
      </span>
      <span className="tabular-nums">{Math.round(usage.percent)}%</span>
    </span>
  );
}
