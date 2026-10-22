import type { Attempt, GenerateResult } from "../../src/model";

export interface RunTiming {
  id: number;
  at: string;
  request: string;
  model?: string;
  outcome: "success" | "failed" | "canceled";
  elapsedMs: number;
  discoveryMs?: number;
  renderMs?: number;
  generationMs?: number;
  firstLineMs?: number;
  attempts: ReturnType<typeof attemptTiming>[];
  error?: string;
}

export function attemptTiming(a: Attempt, name: string) {
  const outputTokens = a.usage.completionTokens;
  const afterFirst = a.firstTokenMs === undefined ? undefined : a.ms - a.firstTokenMs;
  return {
    name, totalMs: a.ms, firstTokenMs: a.firstTokenMs,
    inputTokens: a.usage.promptTokens, estimatedInputTokens: a.estimatedInputTokens,
    outputTokens, reasoningTokens: a.usage.reasoningTokens,
    // End-to-end observed throughput, not the server's internal decode speed.
    observedTokensPerSecond: outputTokens !== undefined && afterFirst !== undefined && afterFirst > 0 ? outputTokens / (afterFirst / 1000) : undefined,
    diagnostics: a.diagnostics.length,
  };
}

export function resultTimings(result: GenerateResult) {
  return {
    generationMs: result.timings.totalMs,
    firstLineMs: result.timings.firstLineMs,
    attempts: [attemptTiming(result.first, "Initial"), ...(result.repair ? [attemptTiming(result.repair, "Repair")] : [])],
  };
}

const seconds = (n: number | undefined) => n === undefined ? "unavailable" : `${(n / 1000).toFixed(2)}s`;
export function timingLines(run: RunTiming): string[] {
  return [
    `Run ${run.id}: ${run.outcome} · ${seconds(run.elapsedMs)} total`,
    `Request: ${run.request}`,
    `Model lookup: ${seconds(run.discoveryMs)} · Generation + validation: ${seconds(run.generationMs)} · SayShape render: ${run.renderMs === undefined ? "unavailable" : run.renderMs.toFixed(1) + "ms"}`,
    `First usable SayShape line: ${seconds(run.firstLineMs)} after generation started`,
    ...run.attempts.flatMap((a) => [
      `${a.name}: ${seconds(a.totalMs)} · First token/chunk: ${seconds(a.firstTokenMs)} · ${a.diagnostics} diagnostics`,
      `Input: ${a.inputTokens === undefined ? "~" + a.estimatedInputTokens + " tokens (estimated)" : a.inputTokens + " tokens"} · Output: ${a.outputTokens === undefined ? "unavailable" : a.outputTokens + " tokens"} · Observed output speed: ${a.observedTokensPerSecond === undefined ? "unavailable" : a.observedTokensPerSecond.toFixed(1) + " tokens/s"}`,
    ]),
    ...(run.error ? [run.error] : []),
  ];
}
