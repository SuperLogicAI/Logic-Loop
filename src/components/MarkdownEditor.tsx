import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { OpenInEditor } from "./OpenInEditor";
import {
  AGENT_MEMORY_FILES,
  highlightMarkdown,
  isDirty,
  type MdKind,
  listMarkdown,
  readMarkdown,
  toDisk,
  toTextarea,
  writeMarkdown,
} from "../lib/markdownEditor";

// Unsaved drafts outlive this view — Back, a terminal tab, another file — so
// leaving never silently drops typing. ponytail: in-memory only, so quitting
// the app drops them; persist to the settings table if that ever bites.
const drafts = new Map<string, { base: string; draft: string }>();
const keyOf = (projectKey: string, name: string) => `${projectKey}\0${name}`;

// Both layers must lay text out identically, or the caret drifts off the
// colours. No padding/margin on token spans for the same reason; monospace
// bold keeps glyph widths.
const LAYER =
  "col-start-1 row-start-1 m-0 whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]";
const MD_CLASS: Record<MdKind, string> = {
  text: "",
  h1: "font-bold text-info-300",
  h2: "font-semibold text-setup-300",
  h3: "font-semibold text-zinc-100",
  marker: "text-info-400",
  code: "bg-zinc-800/70 text-attn-200",
  fence: "text-zinc-500",
  strong: "font-semibold text-zinc-50",
  link: "text-info-400 underline decoration-info-700",
  import: "text-ok-300",
  quote: "text-zinc-400",
  rule: "text-zinc-600",
};

/** Plan 062: quick edits to a project's instruction/notes files in a plain
 * textarea — the body of ProjectOverview's Markdown view (its header stays).
 * No preview (content is only ever text), no recursion, and compare-and-swap
 * saves so an agent's edit is never clobbered. Code editing stays out —
 * Open in editor (Plan 061) is the escape hatch. */
export function MarkdownEditor({ projectKey }: { projectKey: string }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null); // exact disk text, never from the textarea
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState<string | null>(null); // disk text that differs from base
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loadSeq = useRef(0);
  const live = useRef({ name, base, draft });
  live.current = { name, base, draft };

  const dirty = base !== null && isDirty(draft, base);
  // ponytail: re-tokenizes the whole file per keystroke; fine at the 1 MB cap's
  // typical sizes (IDEAS.md ~100 KB). Tokenize visible lines only if it lags.
  const highlighted = useMemo(() => highlightMarkdown(draft), [draft]);

  const open = async (file: string) => {
    const seq = ++loadSeq.current;
    setError(null);
    try {
      const disk = await readMarkdown(projectKey, file);
      if (seq !== loadSeq.current) return;
      const stashed = drafts.get(keyOf(projectKey, file));
      setName(file);
      if (stashed) {
        setBase(stashed.base);
        setDraft(stashed.draft);
        setConflict(stashed.base === disk ? null : disk);
      } else {
        setBase(disk);
        setDraft(toTextarea(disk));
        setConflict(null);
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setName(file);
      setBase(null);
      setError(String(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    void listMarkdown(projectKey)
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
        if (list.length > 0) void open(list[0]);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open reads projectKey itself
  }, [projectKey]);

  // Keep the stash in step with the textarea.
  useEffect(() => {
    if (!name || base === null) return;
    const k = keyOf(projectKey, name);
    if (isDirty(draft, base)) drafts.set(k, { base, draft });
    else drafts.delete(k);
  }, [projectKey, name, base, draft]);

  // Re-read on window focus (IdeaBoard does the same): clean → refresh
  // silently; dirty and changed on disk → show the conflict early.
  useEffect(() => {
    const onFocus = () => {
      const n = live.current.name;
      if (!n || live.current.base === null) return;
      void readMarkdown(projectKey, n)
        .then((disk) => {
          const cur = live.current;
          if (cur.name !== n || cur.base === null || disk === cur.base) return;
          if (isDirty(cur.draft, cur.base)) {
            setConflict(disk);
          } else {
            setBase(disk);
            setDraft(toTextarea(disk));
            setConflict(null);
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectKey]);

  // `against` = the conflicting disk text, for an explicit Overwrite.
  const save = async (against?: string) => {
    if (!name || base === null || saving) return;
    if (against === undefined && !dirty) return;
    const expected = against ?? base;
    const content = toDisk(draft, expected);
    setSaving(true);
    setError(null);
    try {
      const out = await writeMarkdown(projectKey, name, expected, content);
      if (out.state === "saved") {
        setBase(content); // not setDraft: keystrokes typed during the save stay
        setConflict(null);
      } else {
        setConflict(out.current);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const reload = () => {
    if (conflict === null) return;
    setBase(conflict);
    setDraft(toTextarea(conflict));
    setConflict(null);
  };

  return (
    <div className="flex flex-col">
        {files === null ? (
          <p className="mt-4 text-xs text-zinc-500">Loading…</p>
        ) : files.length === 0 ? (
          <p className="mt-4 text-xs text-zinc-500">No markdown files in this project&apos;s root or docs/ folder.</p>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 gap-4">
            <ul className="w-52 shrink-0 self-start rounded-md border border-zinc-800 p-1 text-xs">
              {files.map((f) => {
                const unsaved = f === name ? dirty : drafts.has(keyOf(projectKey, f));
                return (
                  <li key={f}>
                    <button
                      type="button"
                      title={f}
                      onClick={() => {
                        if (f !== name) void open(f);
                      }}
                      className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left ${
                        f === name ? "bg-info-950 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      <span className="truncate">{f}</span>
                      {unsaved && (
                        <span aria-label="unsaved" className="text-attn-400">
                          ●
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {name && (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-mono text-sm font-semibold text-zinc-100">
                    {name}
                    {dirty && <span className="text-attn-400"> ●</span>}
                  </h3>
                  <OpenInEditor
                    cwd={projectKey}
                    path={name}
                    buttonClass="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  />
                </div>
                {AGENT_MEMORY_FILES.has(name) && (
                  <p className="text-[11px] text-zinc-500">
                    Running agents keep the version they started with; it loads on{" "}
                    <span className="font-mono">/clear</span>, <span className="font-mono">/compact</span>, or a
                    new session.
                  </p>
                )}
                {conflict !== null && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 rounded border border-attn-800/60 bg-attn-950/20 px-3 py-2 text-xs text-attn-300"
                  >
                    <span>Changed on disk since you opened it.</span>
                    <button type="button" className="underline hover:text-attn-200" onClick={reload}>
                      Reload (drop my edit)
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      className="underline hover:text-attn-200"
                      onClick={() => void save(conflict)}
                    >
                      Overwrite with mine
                    </button>
                  </div>
                )}
                {error && (
                  <p role="alert" className="text-xs text-attn-400">
                    {error}
                  </p>
                )}
                {base !== null && (
                  <>
                    {/* Colour layer under a transparent textarea, stacked in one
                        grid cell: the layer's text sets the height, the
                        textarea stretches to match, the wrapper scrolls both.
                        Agent text only ever becomes React text, never HTML. */}
                    <div className="max-h-[70vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 focus-within:border-info-600">
                      <div className="grid min-h-[60vh]">
                        <pre aria-hidden className={`${LAYER} pointer-events-none text-zinc-300`}>
                          {highlighted.map((tokens, i) => (
                            <Fragment key={i}>
                              {tokens.map((t, j) => (
                                <span key={j} className={MD_CLASS[t.kind]}>
                                  {t.text}
                                </span>
                              ))}
                              {"\n"}
                            </Fragment>
                          ))}
                        </pre>
                        <textarea
                          aria-label={`Edit ${name}`}
                          spellCheck={false}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                              e.preventDefault();
                              void save();
                            }
                          }}
                          className={`${LAYER} resize-none overflow-hidden border-0 bg-transparent text-transparent caret-zinc-200 selection:bg-info-500/30 focus:outline-none`}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 text-xs">
                      <span className="text-zinc-500">
                        {saving ? "Saving…" : dirty ? "Unsaved changes · ⌘S" : "Saved"}
                      </span>
                      <button
                        type="button"
                        disabled={!dirty || saving}
                        className="rounded-md bg-info-600 px-3 py-1.5 font-medium text-white hover:bg-info-500 disabled:opacity-40"
                        onClick={() => void save()}
                      >
                        Save
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
