import { describe, expect, it } from "vitest";
import type { Attempt } from "../src/model";
import { attemptTiming, timingLines } from "../playground/connected-order/timings";

const attempt = (patch: Partial<Attempt> = {}): Attempt => ({
  spec: "", diagnostics: [], raw: "", usage: {}, thinkingChars: 0, thinking: "", recovered: false,
  guide: { mode: "compact", profile: "all" }, inputChars: 400, estimatedInputTokens: 100,
  estimatedThinkingTokens: 0, ms: 5000, firstTokenMs: 1000, ...patch,
});
describe("generation timing display", () => {
  it("uses reported output usage and the time after the first chunk", () => {
    expect(attemptTiming(attempt({ usage: { completionTokens: 80 } }), "Initial").observedTokensPerSecond).toBe(20);
  });
  it("never reports missing tokens or zero-duration throughput as zero", () => {
    expect(attemptTiming(attempt(), "Initial").observedTokensPerSecond).toBeUndefined();
    expect(attemptTiming(attempt({ firstTokenMs: 5000, usage: { completionTokens: 80 } }), "Initial").observedTokensPerSecond).toBeUndefined();
    const lines = timingLines({ id: 1, at: "", request: "test", outcome: "failed", elapsedMs: 5000, attempts: [attemptTiming(attempt(), "Initial")] }).join("\n");
    expect(lines).toContain("~100 tokens (estimated)");
    expect(lines).toContain("Output: unavailable");
    expect(lines).toContain("Loom render: unavailable");
  });
});
