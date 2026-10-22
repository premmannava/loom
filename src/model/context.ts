/**
 * What a model is sent besides the guide, and how usage is added up.
 *
 * Refinement ("make the total bigger") used to replay the whole conversation:
 * every request and every spec the model wrote, failed ones included, so each
 * turn sent more than the one before. A RefineContext sends a fixed shape:
 *
 *   user:      the original request, the app's lasting requirements, and the
 *              changes asked for since (oldest first)
 *   assistant: the current spec, exactly as it is now, hand edits included
 *   user:      the change asked for now, plus any state the app chose to pass
 *
 * Limits, on purpose:
 * - The spec is what carries earlier work forward. Earlier specs and failed
 *   attempts are never sent again.
 * - Earlier change requests are kept as text (they're short) so a later turn
 *   doesn't undo them. Past maxChanges, the oldest are left out, with a note
 *   saying how many; the spec still has their effect, and `requirements`
 *   is never cut, so anything that must survive belongs there.
 * - State is sent only when the app passes it, and only what it passes. SayShape
 *   never serializes the app's state on its own.
 * - Nothing is summarized: there's no second model call.
 */
import type { ChatMessage, Usage } from "./stream";

export interface RefineContext {
  /** What the user first asked for. */
  task: string;
  /** Requirements that must hold through every change, e.g. "Prices in euros". Never left out. */
  requirements?: readonly string[];
  /** Changes asked for after the task, oldest first, not counting the one being made now. */
  changes?: readonly string[];
  /** The current spec, including any edits made by hand since the model wrote it. */
  spec: string;
  /**
   * Values the app chooses to show the model, e.g. { cart: [...] } so it
   * can refer to real items. Sent as JSON. Leave out to send none.
   */
  state?: Readonly<Record<string, unknown>>;
}

export interface ContextPolicy {
  /** The most earlier changes to send as text. Default 20. The newest are kept. */
  maxChanges?: number;
}

export const DEFAULT_MAX_CHANGES = 20;

/** What was sent for context, for reports. */
export interface ContextInfo {
  /** "none" (a new request), "history" (messages the caller passed) or "refine" (a RefineContext). */
  policy: "none" | "history" | "refine";
  /** Context messages sent between the guide and the request. */
  messages: number;
  /** Characters in those messages and the request. */
  chars: number;
  /** For refine: earlier changes sent, and left out because of maxChanges. */
  changesSent?: number;
  changesOmitted?: number;
  /** For refine: the state names sent. */
  stateNames?: readonly string[];
}

/** The messages for a change to an existing spec: the context, then the request. */
export function refineMessages(ctx: RefineContext, request: string, policy: ContextPolicy = {}): { messages: ChatMessage[]; info: ContextInfo } {
  const max = Math.max(0, policy.maxChanges ?? DEFAULT_MAX_CHANGES);
  const all = ctx.changes ?? [];
  const sent = max === 0 ? [] : all.slice(-max);
  const omitted = all.length - sent.length;

  const first: string[] = [ctx.task.trim()];
  if (ctx.requirements?.length) first.push(`Keep these requirements:\n${ctx.requirements.map((r) => `- ${r}`).join("\n")}`);
  if (all.length) {
    const note = omitted ? `(${omitted} earlier change${omitted === 1 ? "" : "s"} not listed; the interface below already includes them)\n` : "";
    first.push(`Changes asked for since:\n${note}${sent.map((c) => `- ${c}`).join("\n")}`);
  }

  const last: string[] = [
    `Change the interface above: ${request.trim()}`,
    "Keep everything else as it is, including any edits made by hand, unless this change says otherwise. Write the whole interface.",
  ];
  const stateNames = ctx.state ? Object.keys(ctx.state).sort() : [];
  if (stateNames.length) {
    // Sorted keys, so the same values always make the same text.
    const sorted = Object.fromEntries(stateNames.map((k) => [k, ctx.state![k]]));
    last.push(`Current values from the app (use these names in state):\n${JSON.stringify(sorted)}`);
  }

  const messages: ChatMessage[] = [
    { role: "user", content: first.join("\n\n") },
    { role: "assistant", content: ctx.spec },
    { role: "user", content: last.join("\n\n") },
  ];
  return {
    messages,
    info: {
      policy: "refine",
      messages: 2,
      chars: messages.reduce((n, m) => n + m.content.length, 0),
      changesSent: sent.length,
      changesOmitted: omitted,
      stateNames,
    },
  };
}

/**
 * The context for the next change, after a generation: the accepted spec
 * becomes current and the request joins the changes. With no accepted spec
 * (an empty answer), nothing changes, so a failed try isn't remembered.
 */
export function nextRefineContext(ctx: RefineContext, request: string, acceptedSpec: string): RefineContext {
  if (!acceptedSpec.trim()) return ctx;
  return { ...ctx, changes: [...(ctx.changes ?? []), request.trim()], spec: acceptedSpec };
}

/** Usage summed over a generation's attempts. A total is undefined (unknown) if any attempt didn't report it. */
export interface UsageTotals {
  promptTokens?: number;
  completionTokens?: number;
  /** Part of completionTokens, when the server reports it. Not added again. */
  reasoningTokens?: number;
  /** How many attempts reported each figure, out of attempts. */
  reported: { promptTokens: number; completionTokens: number; reasoningTokens: number; attempts: number };
}

export function sumUsage(usages: readonly Usage[]): UsageTotals {
  const total = (key: keyof Usage) => {
    let sum = 0, n = 0;
    for (const u of usages) { const v = u[key]; if (typeof v === "number") { sum += v; n++; } }
    return { value: n === usages.length && n > 0 ? sum : undefined, n };
  };
  const p = total("promptTokens"), c = total("completionTokens"), r = total("reasoningTokens");
  return {
    promptTokens: p.value,
    completionTokens: c.value,
    reasoningTokens: r.value,
    reported: { promptTokens: p.n, completionTokens: c.n, reasoningTokens: r.n, attempts: usages.length },
  };
}
