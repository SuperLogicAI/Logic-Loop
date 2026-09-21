import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import z from "@deepseek-ai/schemastery";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq } from "@deepseek-ai/dsh-session";
import { assertNever } from "@deepseek-ai/dsh-util-values";

/**
 * dsh-terminal-app — a direct core Agent/Session runner over dsh-base, like
 * @deepseek-ai/dsh-headless, but interactive and multi-turn instead of one
 * task and exit: it creates or resumes one Agent, then loops reading a line
 * from stdin, forwarding it as a user message, streaming the assistant's
 * text reply to stdout, and waiting for the next line.
 *
 * Live-tested 2026-09-17 with a real, funded key: multi-turn conversation,
 * a real tool call under the base profile's default workspace-write+ask
 * policy (resolves clean, no approval prompt, no hang), and cross-process
 * session resume by exact id (a real create()-vs-resume() API bug found
 * and fixed along the way — see plans/028). Ingest observer wiring below
 * mirrors src-tauri/src/pi.rs's already-shipped, already-verified wire
 * contract exactly (same POST shape, same headers, same fire-and-forget
 * discipline) rather than inventing a new one — SessionStart/
 * UserPromptSubmit/Stop are emitted at this file's own known lifecycle
 * points, tool/call+tool/result are observed via `session/event` since
 * those happen inside `agent.whenIdle()`'s black box.
 */

// ponytail: plain ANSI SGR, no chalk/kleur dep for two constants.
const USER_BLUE = "\x1b[38;2;77;106;254m"; // #4d6afe
const RESET = "\x1b[0m";

const name = "terminal-runner";
const inject = ["agentDefaultModel", "agents", "sessions"];
// schemastery fields are optional by default; only .required() opts in,
// there is no .optional() method (confirmed against the installed
// @deepseek-ai/schemastery README, which differs from zod here).
const Config = z.object({ resumeSessionId: z.string() });

// Bumped when the POST payload shape changes in a way a reader must know
// about — same role as pi.rs's PI_EXTENSION_VERSION / ingest.rs's
// HOOK_VERSION.
const INGEST_HOOK_VERSION = 1;

const internals = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
};

// ponytail: opt-in stderr diagnostics for the three silent-swallow points
// below. Fail-open (invariant #2) stays intact — this only logs, never
// throws or blocks. Upgrade to a log file/health endpoint/retry if a env
// var stops being enough to debug a "no events landed" report.
const debug = process.env.LOGIC_LOOP_DEBUG === "1";

/**
 * Read the app's ingest server coordinates. Re-read on every POST, never
 * cached — an app restart rotating the port/token needs no signal to this
 * process, same contract as pi.rs's loadIngestEnv().
 * @returns `{ CT_PORT, CT_TOKEN }` or null if absent/malformed.
 */
function loadIngestEnv() {
  try {
    const raw = readFileSync(join(homedir(), ".context-terminal", "ingest.env"), "utf8");
    const env = {};
    for (const line of raw.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    return env.CT_PORT && env.CT_TOKEN ? env : null;
  } catch (e) {
    if (debug) internals.stderr.write(`logic-loop: loadIngestEnv failed: ${e}\n`);
    return null;
  }
}

/**
 * Only these fields ever leave the process as tool_input — never a raw
 * arguments passthrough, and never anything derived from a tool's result.
 * Mirrors pi.rs's normalizeToolArgs() allowlist exactly.
 *
 * Found live (plans/028): a tool/call event's `arguments` is the raw,
 * accumulated JSON-text chunks from the model's tool-call stream — a
 * string, not a parsed object (confirmed against
 * @deepseek-ai/dsh-llm's BlockAssembler, which builds it via
 * `+= chunk.argumentsDelta`). Parse it first; a malformed/partial string
 * yields an empty allowlist result rather than throwing.
 * @param rawArguments - a tool/call event's raw `arguments`.
 */
function normalizeToolArgs(rawArguments) {
  const out = {};
  let args = rawArguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return out;
    }
  }
  const pick = (canonical, aliases) => {
    for (const key of aliases) {
      if (typeof args?.[key] === "string") {
        out[canonical] = args[key];
        return;
      }
    }
  };
  pick("command", ["command"]);
  pick("file_path", ["path", "file_path"]);
  pick("description", ["description"]);
  // dsh's own glob/grep tools (dsh-tool-fs-search) key their argument
  // "pattern" rather than any of Pi's three original fields — found live
  // (plans/028) when a real tool call used it and tool_input came back
  // empty. Still a single bounded string field, same allowlist spirit.
  pick("pattern", ["pattern"]);
  return out;
}

/**
 * Fire-and-forget POST to the app's localhost ingest server. Never awaited
 * from inside the conversation loop — this process runs the user's actual
 * interactive session, unlike Claude's detached curl hook, so an
 * accidental await here is a real stall risk, not just a lost event. A
 * stalled or absent ingest server can never delay the session.
 * @param payload - the hook_event_name row to send.
 */
function postEvent(payload) {
  const ingest = loadIngestEnv();
  if (!ingest) {
    if (debug) internals.stderr.write(`logic-loop: no ingest env, dropping ${payload?.hook_event_name}\n`);
    return;
  }
  const tabId = process.env.LOGIC_LOOP_TAB_ID ?? "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    fetch(`http://127.0.0.1:${ingest.CT_PORT}/event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ingest.CT_TOKEN}`,
        "X-Logic-Loop-Tab": tabId,
        "X-Logic-Loop-Hook": String(INGEST_HOOK_VERSION),
        "X-Logic-Loop-Agent": "deepseek",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).catch((e) => {
      if (debug) internals.stderr.write(`logic-loop: POST failed: ${e}\n`);
    }).finally(() => clearTimeout(timeout));
  } catch (e) {
    // never let a translation/network error touch the user's session
    if (debug) internals.stderr.write(`logic-loop: postEvent threw: ${e}\n`);
  }
}

/**
 * Observe a session's tool/call + tool/result pairs and POST one
 * PostToolUse row per completed call. tool/call already carries
 * `name`/`arguments` directly (unlike Pi, which needs a separate
 * tool_execution_start event for those) — still buffered by callId until
 * the matching tool/result, since that's the only event carrying the
 * error outcome.
 * @param ctx - plugin context carrying the session/event bus.
 * @param session - the exact Session to observe.
 * @param sessionId - this session's id, sent on every row.
 * @returns a disposer.
 */
function observeToolCalls(ctx, session, sessionId) {
  const pendingTools = new Map();
  return ctx.on("session/event", (subject, event) => {
    if (subject !== session) return;
    if (event.type === "tool/call") {
      pendingTools.set(event.data.callId, {
        name: event.data.name,
        input: normalizeToolArgs(event.data.arguments),
      });
      return;
    }
    if (event.type === "tool/result") {
      const block = event.data.message.content[0];
      const callId = block?.toolCallId;
      const pending = pendingTools.get(callId);
      pendingTools.delete(callId);
      postEvent({
        hook_event_name: "PostToolUse",
        session_id: sessionId,
        cwd: process.cwd(),
        tool_use_id: callId,
        tool_name: pending?.name,
        tool_input: pending?.input ?? {},
        tool_response: { is_error: !!block?.isError },
      });
    }
  });
}

/**
 * Stream only the assistant's final text to stdout, mirroring
 * dsh-headless's own streamReasoning shape but targeting text-delta chunks
 * and "text" blocks instead of reasoning ones.
 * @param ctx - plugin context carrying the live Assistant frame feed.
 * @param agent - the exact Agent whose stream belongs to this invocation.
 * @param stdout - output sink.
 * @returns a disposer that also terminates an unterminated output line.
 */
function streamAssistantText(ctx, agent, stdout) {
  let open = false;
  let endsWithNewline = true;
  const close = () => {
    if (!open) return;
    if (!endsWithNewline) stdout.write("\n");
    open = false;
    endsWithNewline = true;
  };
  const dispose = ctx.on("agent/assistant-stream", ({ agent: subject, frame }) => {
    if (subject !== agent) return;
    if (frame.type === "start") {
      close();
      return;
    }
    if (frame.type === "end") {
      close();
      return;
    }
    const chunk = frame.chunk;
    switch (chunk.type) {
      case "text-delta":
        if (chunk.text === "") return;
        open = true;
        stdout.write(chunk.text);
        endsWithNewline = chunk.text.endsWith("\n");
        return;
      case "block-start":
        if (chunk.blockType !== "text") close();
        return;
      case "block-end":
        if (chunk.block.type !== "text") close();
        return;
      case "usage":
        return;
      case "reasoning-delta":
      case "tool-call-delta":
      case "finish":
        close();
        return;
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, "terminal assistant text stream");
    }
  });
  return () => {
    dispose();
    close();
  };
}

/**
 * Report a turn/end error reason to stderr, mirroring dsh-headless's own
 * summarize()+error-print. Found live (plans/028): without this, a real
 * failure (e.g. the provider's QUOTA error) streamed no assistant text and
 * printed nothing at all — the turn just silently completed.
 * @param session - the agent's Session to read events from.
 * @param firstSeq - the sequence number the turn started at.
 * @param stderr - output sink.
 */
function reportTurnError(session, firstSeq, stderr) {
  const length = session.seq;
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq));
    if (event === undefined) continue;
    if (event.type === "turn/end" && event.data.reason?.kind === "error") {
      const { code, message } = event.data.reason.error;
      stderr.write(`dsh: ${code}: ${message}\n`);
    }
  }
}

/**
 * Drive one interactive session: create or resume an Agent, then loop on
 * stdin until `/exit` or EOF (Ctrl-D).
 * @param ctx - plugin context carrying the Agent, default model, and Session services.
 * @param config - validated `{ resumeSessionId? }`.
 * @param io - process-facing effects.
 */
async function run(ctx, config, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return;

  const selection = defaultModel.currentSelection();
  const agentOptions = { provider: selection.provider, model: selection.model };
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  };

  // agents.create() and agents.resume() are distinct methods (confirmed
  // against @deepseek-ai/dsh-agent-loop's own source) — create() rejects
  // outright if the session id already exists, it does not attach to it.
  // resume() takes `resumeSessionId`, not `sessionId`.
  let sessionId;
  let agent;
  if (config.resumeSessionId !== undefined) {
    sessionId = config.resumeSessionId;
    ({ agent } = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup }));
  } else {
    sessionId = `session-${randomUUID()}`;
    ({ agent } = await agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions, setup }));
  }
  await agent.whenIdle();

  postEvent({ hook_event_name: "SessionStart", session_id: sessionId, cwd: process.cwd() });
  const stopObserving = observeToolCalls(ctx, agent.session, sessionId);

  const stopStream = streamAssistantText(ctx, agent, io.stdout);
  const rl = createInterface({ input: io.stdin, output: io.stdout });

  // readline/promises' question() does not reject on its own when stdin
  // simply ends (e.g. a non-TTY EOF) — it can hang forever waiting for a
  // "line" event that will never fire. Abort it explicitly on stdin "end".
  const stdinEnded = new AbortController();
  io.stdin.once("end", () => stdinEnded.abort());

  io.stdout.write(`dsh terminal — session ${sessionId}\n`);
  io.stdout.write("Type a message and press Enter. /exit quits.\n\n");

  try {
    for (;;) {
      let line;
      try {
        // Color left open (no reset) after "> " so the terminal echoes the
        // user's own typed characters in the same blue — belt-and-suspenders
        // distinction from the assistant's default-colored reply below.
        line = await rl.question(`${USER_BLUE}> `, { signal: stdinEnded.signal });
      } catch {
        break; // stdin closed (EOF / Ctrl-D) or aborted above
      }
      io.stdout.write(`${RESET}\n`);
      const text = line.trim();
      if (text === "/exit") break;
      if (text === "") continue;
      const firstSeq = agent.session.seq;
      postEvent({ hook_event_name: "UserPromptSubmit", session_id: sessionId, cwd: process.cwd() });
      agent.followup(createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "user" },
      }));
      await agent.whenIdle();
      reportTurnError(agent.session, firstSeq, io.stderr);
      postEvent({ hook_event_name: "Stop", session_id: sessionId, cwd: process.cwd() });
      await sessions.flush(agent.session);
      io.stdout.write("\n");
    }
  } finally {
    stopObserving();
    stopStream();
    rl.close();
    await sessions.flush(agent.session);
  }

  ctx.get("appExit")?.(0);
}

/**
 * Mount the interactive terminal driver.
 * @param ctx - plugin context carrying core services.
 * @param config - validated `{ resumeSessionId? }`.
 */
function apply(ctx, config) {
  const io = { stdin: internals.stdin, stdout: internals.stdout, stderr: internals.stderr };
  run(ctx, config, io).catch((error) => {
    io.stderr.write(`dsh-terminal-app: ${error instanceof Error ? error.message : String(error)}\n`);
    ctx.get("appExit")?.(1);
  });
}

export { Config, apply, inject, internals, name };
