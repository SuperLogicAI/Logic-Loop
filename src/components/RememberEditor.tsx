import { useState } from "react";
import type { Decision } from "../types";
import {
  appendDecisionLog, CAPS, cleanField, currentEntries, formatEntry, newId, readDecisionLog, supersede,
  writeDecisionLog,
} from "../lib/decisionLog";

// Plan 064: inline Remember editor under a decision card. Only what the human
// confirms here reaches DECISIONS.md — never the question or assumption.

interface Props {
  decision: Decision;
  projectKey: string;
  log: string; // DECISIONS.md as last read, for the Supersedes picker
  onSaved: () => void;
  onCancel: () => void;
}

const field = "w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-zinc-100 outline-none focus:border-info-500";

function Counter({ value, cap }: { value: string; cap: number }) {
  return <span className={value.length > cap ? "text-attn-400" : "text-zinc-600"}>{value.length}/{cap}</span>;
}

export function RememberEditor({ decision: d, projectKey, log, onSaved, onCancel }: Props) {
  const [text, setText] = useState(d.user_answer ?? "");
  const [reason, setReason] = useState("");
  const [revisitIf, setRevisitIf] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = currentEntries(log).filter((e) => !e.superseded);
  const canSave = !saving && cleanField(text, CAPS.decision) !== "" && cleanField(reason, CAPS.reason) !== "";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const date = new Date();
      let base = await readDecisionLog(projectKey);
      const id = newId(date, currentEntries(base).map((e) => e.id));
      const line = formatEntry({
        id, decision: text, reason, revisitIf, supersedes: supersedes || undefined, agent: d.agent, date, cardId: d.id,
      });
      if (!supersedes) {
        await appendDecisionLog(projectKey, line);
      } else {
        // Compare-and-swap; a hand edit in between → recompute once, then give up.
        let out = await writeDecisionLog(projectKey, base, supersede(base, supersedes, line));
        if (out.state === "conflict") {
          base = out.current;
          out = await writeDecisionLog(projectKey, base, supersede(base, supersedes, line));
        }
        if (out.state === "conflict") throw new Error("DECISIONS.md keeps changing on disk. Try again.");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded border border-zinc-700 bg-zinc-900/60 p-2 text-zinc-300">
      <p className="break-words text-zinc-500">Q: {d.question}</p>
      {d.user_answer && <p className="break-words text-zinc-500">A: {d.user_answer}</p>}
      <label className="flex flex-col gap-0.5">
        <span className="flex justify-between">Decision <Counter value={text} cap={CAPS.decision} /></span>
        <textarea rows={2} maxLength={CAPS.decision} className={field} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="flex justify-between">Reason <Counter value={reason} cap={CAPS.reason} /></span>
        <textarea rows={2} maxLength={CAPS.reason} className={field} value={reason} placeholder="Why — a future agent needs this"
          onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="flex justify-between">Revisit if <Counter value={revisitIf} cap={CAPS.revisitIf} /></span>
        <input maxLength={CAPS.revisitIf} className={field} value={revisitIf} placeholder="optional" onChange={(e) => setRevisitIf(e.target.value)} />
      </label>
      {current.length > 0 && (
        <label className="flex flex-col gap-0.5">
          Supersedes
          <select className={field} value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
            <option value="">nothing</option>
            {current.map((e) => (
              <option key={e.id} value={e.id}>{e.id} · {e.text.slice(0, 60)}</option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[10px] text-zinc-600">Saved into the repo for every agent to read. No secrets or client data.</p>
      {error && <p role="alert" className="text-attn-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!canSave} className="text-ok-400 hover:text-ok-300 disabled:text-zinc-600" onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={saving} className="text-zinc-400 hover:text-zinc-200" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
