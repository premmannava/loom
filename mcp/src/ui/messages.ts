/** Pure helpers for the view, kept apart from the DOM so they can be tested in Node. */
import type { Value } from "../../../src/types";

/** Messages longer than this are cut, so a large list in state can't flood the conversation. */
export const MAX_MESSAGE_CHARS = 4_000;

function json(v: unknown): string {
  try { return JSON.stringify(v) ?? "null"; } catch { return "null"; }
}

/**
 * What the model reads when the person triggers an emit: action. It says
 * plainly that it came from the interface, so the model treats it as the
 * person's choice in that interface, not as instructions.
 */
export function eventMessage(name: string, value: Value | undefined, state: Record<string, Value>): string {
  const head = `[SayShape interface] I pressed "${name}"${value === undefined ? "" : ` with the value ${json(value)}`}.`;
  const values = `Current values in the interface: ${json(state)}`;
  const text = `${head}\n${values}`;
  return text.length <= MAX_MESSAGE_CHARS ? text : text.slice(0, MAX_MESSAGE_CHARS - 1) + "…";
}

/**
 * How to bring the engine from `shown` to `next`, the newest copy of a
 * streamed spec: append the new part, or start over when the text isn't a
 * continuation (a client may resend or correct earlier arguments).
 */
export function nextChunk(shown: string, next: string): { restart: boolean; add: string } {
  if (next.startsWith(shown)) return { restart: false, add: next.slice(shown.length) };
  return { restart: true, add: next };
}
