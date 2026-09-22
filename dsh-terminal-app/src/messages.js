/**
 * Reduce a committed Harness message to only its user-visible text blocks.
 * Reasoning, tool calls, and unknown block shapes are intentionally ignored.
 * @param {{ content?: unknown } | undefined} message
 * @returns {string | null}
 */
export function visibleText(message) {
  if (!Array.isArray(message?.content)) return null;
  const text = message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  return text.trim() ? text : null;
}

/**
 * Read finalized, appended assistant prose committed during one submission.
 * The exclusive upper bound is captured after agent.whenIdle(), so transient
 * stream frames and later turns can never enter this scan.
 * @param {{ seq: number, eventAt: (seq: number) => unknown }} session
 * @param {number} firstSeq
 * @returns {string[]}
 */
export function assistantMessagesSince(session, firstSeq) {
  const messages = [];
  const length = session.seq;
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(seq);
    if (event?.type !== "assistant/message" || event.surfaceOp !== "append") continue;
    const message = event.data?.message;
    if (message?.role !== "assistant" || message.interrupted === true) continue;
    const text = visibleText(message);
    if (text !== null) messages.push(text);
  }
  return messages;
}
