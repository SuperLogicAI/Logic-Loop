import { useState } from "react";

interface Row {
  cwd: string;
  cmd: string;
}

interface Props {
  parentCwd: string;
  onLaunch: (items: { cwd: string; cmd?: string }[], label?: string) => void;
  onCancel: () => void;
}

/** "Fan out": launch N child tabs from a form, or from a pasted JSON array —
 * what an agent-written partitioning script would emit for the human to
 * review before Launch (invariant #4: the app never spawns these on its
 * own). Paste only fills the editable rows; it never launches by itself. */
export function FanOutModal({ parentCwd, onLaunch, onCancel }: Props) {
  const [label, setLabel] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { cwd: parentCwd, cmd: "" },
    { cwd: parentCwd, cmd: "" },
  ]);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateRow = (i: number, field: keyof Row, value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const addRow = () => setRows((r) => [...r, { cwd: parentCwd, cmd: "" }]);

  const parseJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      const parsedRows = parsed.map((item, i) => {
        if (typeof item !== "object" || item === null) throw new Error(`item ${i} is not an object`);
        const cwd = (item as Record<string, unknown>).cwd;
        const cmd = (item as Record<string, unknown>).cmd;
        if (typeof cwd !== "string" || !cwd) throw new Error(`item ${i} is missing "cwd"`);
        if (cmd !== undefined && typeof cmd !== "string") throw new Error(`item ${i}'s "cmd" must be a string`);
        return { cwd, cmd: cmd ?? "" };
      });
      setRows(parsedRows);
      setJsonText("");
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "invalid JSON");
    }
  };

  const launch = () => {
    const items = rows
      .map((r) => ({ cwd: r.cwd.trim(), cmd: r.cmd.trim() || undefined }))
      .filter((r) => r.cwd);
    if (items.length === 0) return;
    onLaunch(items, label.trim() || undefined);
  };

  return (
    <div className="fixed inset-x-0 top-7 bottom-0 z-40 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="max-h-[85vh] w-[36rem] max-w-[90vw] overflow-y-auto rounded-lg border border-purple-500/30 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 font-semibold text-purple-300">Fan out</h3>
        <input
          className="mb-3 w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="mb-3 flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="min-w-0 flex-[2] rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                placeholder="cwd"
                value={row.cwd}
                onChange={(e) => updateRow(i, "cwd", e.target.value)}
              />
              <input
                className="min-w-0 flex-[2] rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                placeholder="command (optional — e.g. claude)"
                value={row.cmd}
                onChange={(e) => updateRow(i, "cmd", e.target.value)}
              />
              <button
                className="shrink-0 rounded px-2 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                title="Remove row"
                onClick={() => removeRow(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          className="mb-4 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={addRow}
        >
          + row
        </button>

        <details className="mb-4">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
            Paste a JSON array instead
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              className="h-20 w-full resize-none rounded bg-zinc-800 p-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              placeholder='[{"cwd": "/path/a", "cmd": "claude"}, {"cwd": "/path/b"}]'
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            {jsonError && <p className="text-red-400">{jsonError}</p>}
            <button
              className="self-start rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={parseJson}
            >
              Load into rows above
            </button>
          </div>
        </details>

        <div className="flex justify-end gap-2 text-sm">
          <button className="rounded px-3 py-1 text-zinc-400 hover:text-zinc-200" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-purple-500 px-3 py-1 font-medium text-black hover:bg-purple-400"
            onClick={launch}
          >
            Launch
          </button>
        </div>
      </div>
    </div>
  );
}
