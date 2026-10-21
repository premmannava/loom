/**
 * Asks a model for a Loom spec, streams the clean lines out as they arrive,
 * checks the result with Loom's own parser, and asks once for a fix if it has
 * problems. Used by the playground and the evaluation script; works in
 * browsers and Node.
 */
import { parse } from "../parser";
import { languageGuide, type GuideOptions } from "../prompt";
import type { Registry } from "../registry";
import type { Diagnostic } from "../types";
import { loomLineTest, SpecFilter } from "./clean";
import { streamChat, type ChatMessage, type ModelConfig, type Usage } from "./stream";

export type Phase = "waiting" | "thinking" | "writing" | "repairing" | "done";

export interface Attempt {
  spec: string;
  diagnostics: Diagnostic[];
  /** Raw text the model sent, before thinking and fences were removed. */
  raw: string;
  usage: Usage;
  thinkingChars: number;
  /** Thinking the server sent separately (reasoning_content), kept for diagnosing empty answers. */
  thinking: string;
  /**
   * True when the answer was empty and the spec was recovered from the
   * thinking: some models write the spec inside a thinking block they never close.
   */
  recovered: boolean;
}

export interface GenerateResult {
  /** The final spec: the repaired one if a repair ran, otherwise the first. */
  spec: string;
  diagnostics: Diagnostic[];
  first: Attempt;
  repair?: Attempt;
  timings: {
    /** Until the model sent anything at all (thinking included). */
    firstTokenMs?: number;
    /** Until the first Loom line could be shown: what a user waits for. */
    firstLineMs?: number;
    totalMs: number;
  };
  /** The conversation, for a follow-up request. */
  messages: ChatMessage[];
}

export interface GenerateOptions {
  config: ModelConfig;
  registry: Registry;
  /** What the user asked for. */
  request: string;
  /** The guide, or options to build it from the registry. */
  guide?: string | GuideOptions;
  /** Earlier turns, to refine a previous screen ("make it shorter"). */
  history?: ChatMessage[];
  /** Appended to the user's request, e.g. "/no_think" to turn off Qwen3's thinking. */
  userSuffix?: string;
  /**
   * Names of state the app supplies itself (loom.state.set), so a spec that
   * reads them isn't sent back for repair as using unknown names.
   */
  stateNames?: readonly string[];
  /** Repair when the first spec has: any diagnostic (default), only errors, or never. */
  repairOn?: "any" | "errors" | "never";
  /** Clean Loom text as it streams. */
  onText?: (text: string) => void;
  /** Throw away what onText sent so far (a repair is starting, or it was thinking after all). */
  onReset?: (reason: "repair" | "thinking") => void;
  onPhase?: (phase: Phase) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => number;
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The message asking the model to fix its spec, listing what the parser found. */
export function repairPrompt(diagnostics: Diagnostic[]): string {
  const list = diagnostics.map((d) => `- Line ${d.line} (${d.severity}): ${d.message}`).join("\n");
  return `Your Loom has these problems:\n${list}\n\nWrite the whole interface again with them fixed. Output only Loom.`;
}

export async function generateSpec(o: GenerateOptions): Promise<GenerateResult> {
  const now = o.now ?? clock;
  const start = now();
  const guide = typeof o.guide === "string" ? o.guide : languageGuide(o.registry, o.guide);
  const isLoomLine = loomLineTest((name) => o.registry.has(name));
  const timings: GenerateResult["timings"] = { totalMs: 0 };
  const messages: ChatMessage[] = [
    { role: "system", content: guide },
    ...(o.history ?? []),
    { role: "user", content: o.request + (o.userSuffix ? `\n\n${o.userSuffix}` : "") },
  ];

  const run = async (msgs: ChatMessage[]): Promise<Attempt> => {
    const filter = new SpecFilter(isLoomLine);
    const usage: Usage = {};
    let raw = "", spec = "", thinking = "", phase: Phase = "waiting";
    const setPhase = (p: Phase) => { if (p !== phase) { phase = p; o.onPhase?.(p); } };
    const emit = (out: { text: string; reset: boolean }) => {
      if (out.reset) { spec = ""; o.onReset?.("thinking"); }
      if (!out.text) return;
      if (timings.firstLineMs === undefined) timings.firstLineMs = now() - start;
      spec += out.text;
      setPhase("writing");
      o.onText?.(out.text);
    };
    o.onPhase?.("waiting");
    for await (const part of streamChat(o.config, msgs, { signal: o.signal, fetch: o.fetch, usage })) {
      if (timings.firstTokenMs === undefined) timings.firstTokenMs = now() - start;
      if (part.kind === "reasoning") { thinking += part.text; setPhase("thinking"); continue; }
      raw += part.text;
      const before = filter.thinkingChars;
      emit(filter.push(part.text));
      if (filter.thinkingChars > before && phase === "waiting") setPhase("thinking");
    }
    emit(filter.end());
    // Nothing but thinking: look for the spec inside it before giving up.
    let recovered = false;
    if (!spec.trim()) {
      const again = new SpecFilter(isLoomLine);
      const text = `${thinking}\n${raw}`.replace(/<\/?think>/g, "\n");
      const found = again.push(text).text + again.end().text;
      if (found.trim()) { recovered = true; emit({ text: found.trimEnd() + "\n", reset: false }); }
    }
    const diagnostics = parse(spec, o.registry, { knownNames: o.stateNames }).diagnostics;
    return { spec, diagnostics, raw, usage, thinkingChars: thinking.length + filter.thinkingChars, thinking, recovered };
  };

  const first = await run(messages);
  messages.push({ role: "assistant", content: first.spec });
  const repairOn = o.repairOn ?? "any";
  const needsRepair =
    repairOn === "any" ? first.diagnostics.length > 0 :
    repairOn === "errors" ? first.diagnostics.some((d) => d.severity === "error") : false;

  let repair: Attempt | undefined;
  if (needsRepair && first.spec.trim()) {
    o.onReset?.("repair");
    o.onPhase?.("repairing");
    messages.push({ role: "user", content: repairPrompt(first.diagnostics) });
    repair = await run(messages);
    messages.push({ role: "assistant", content: repair.spec });
  }

  timings.totalMs = now() - start;
  o.onPhase?.("done");
  // Keep the first spec if the repair came back empty or worse.
  const useRepair = repair && repair.spec.trim() && repair.diagnostics.length <= first.diagnostics.length;
  const final = useRepair ? repair! : first;
  return { spec: final.spec, diagnostics: final.diagnostics, first, repair, timings, messages };
}
