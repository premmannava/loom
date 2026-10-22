import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { generateSpec, nextRefineContext, refineMessages, streamChat, sumUsage, type RefineContext } from "../src/model";
import { Registry } from "../src/registry";
import { fakeModel } from "./fake-model";

const registry = new Registry(coreComponents);
const config = { url: "http://model.test/v1", model: "test-model" };
const good = `card\n  text "Cabin" style=title\n  button "Book" on=emit:book\n`;
const fixed = `card\n  button "Buy" variant=danger\n`;
const broken = `card\n  button "Buy" color=red\n`;

describe("the conversation generateSpec returns", () => {
  it("ends with the repaired spec, without the failed one, when the repair is kept", async () => {
    const m = fakeModel([{ content: [broken] }, { content: [fixed] }]);
    const r = await generateSpec({ config, registry, request: "a buy button", fetch: m.fetch });
    expect(r.spec).toBe(fixed);
    expect(r.messages.map((x) => x.role)).toEqual(["system", "user", "assistant"]);
    expect(r.messages.at(-1)).toEqual({ role: "assistant", content: fixed });
    expect(r.messages.some((x) => x.content === broken)).toBe(false);
    // The full exchange is still there for debugging.
    expect(r.transcript.map((x) => x.role)).toEqual(["system", "user", "assistant", "user", "assistant"]);
  });

  it("ends with the first spec, without the rejected repair, when the repair is worse", async () => {
    const m = fakeModel([{ content: [broken] }, { content: [`nonsense\n`] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch });
    expect(r.spec).toBe(broken);
    expect(r.messages.at(-1)).toEqual({ role: "assistant", content: broken });
    expect(r.messages).toHaveLength(3);
    expect(r.messages.some((x) => /Your Loom has these problems/.test(x.content))).toBe(false);
  });
});

describe("repair with the full guide", () => {
  it("switches a compact guide to the full one for the repair, keeping the profile, and reports each", async () => {
    const m = fakeModel([{ content: [broken] }, { content: [fixed] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, guide: { mode: "compact", profile: "forms" }, repairGuide: "full" });
    const [first, second] = m.requests.map((q) => q.body.messages[0]!.content);
    expect(first).toContain("ELEMENTS (prop=type");
    expect(second).toContain("ELEMENTS AT A GLANCE");
    expect(second).not.toMatch(/^  (stat|image|map)\b/m); // still only the profile's elements
    expect(r.first.guide).toEqual({ mode: "compact", profile: "forms" });
    expect(r.repair!.guide).toEqual({ mode: "full", profile: "forms" });
    // The returned conversation is the one the accepted spec came from, starting with the first guide.
    expect(r.messages[0]!.content).toBe(first);
    expect(r.messages.at(-1)!.content).toBe(fixed);
    expect(r.transcript[0]!.content).toBe(second);
  });

  it("keeps the first spec and the first guide's conversation when the full-guide repair is worse", async () => {
    const m = fakeModel([{ content: [broken] }, { content: [`nonsense\n`] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, guide: { mode: "compact" }, repairGuide: "full" });
    expect(r.spec).toBe(broken);
    expect(r.repair!.guide.mode).toBe("full");
    expect(r.messages[0]!.content).toContain("ELEMENTS (prop=type");
    expect(r.messages.at(-1)!.content).toBe(broken);
  });

  it("uses the same guide by default", async () => {
    const m = fakeModel([{ content: [broken] }, { content: [fixed] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, guide: { mode: "compact" } });
    expect(m.requests[1]!.body.messages[0]!.content).toBe(m.requests[0]!.body.messages[0]!.content);
    expect(r.repair!.guide.mode).toBe("compact");
  });

  it("reports a guide passed as text as custom", async () => {
    const m = fakeModel([{ content: [good] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, guide: "My guide" });
    expect(r.first.guide).toEqual({ mode: "custom", profile: "all" });
  });
});

describe("enforceProfile", () => {
  const withStat = `card\n  stat label="Nights" value=3\n`;

  it("checks against the renderer by default, so any registered element is fine", async () => {
    const m = fakeModel([{ content: [withStat] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, guide: { mode: "compact", profile: "forms" } });
    expect(r.diagnostics).toEqual([]);
    expect(r.validatedAgainst).toBe("renderer");
  });

  it("sends an element outside the profile back for repair when on", async () => {
    const m = fakeModel([{ content: [withStat] }, { content: [`card\n  text "3 nights"\n`] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, guide: { mode: "compact", profile: "forms" }, enforceProfile: true });
    expect(r.first.diagnostics[0]!.message).toMatch(/Unknown element "stat"/);
    expect(r.spec).toBe(`card\n  text "3 nights"\n`);
    expect(r.validatedAgainst).toBe("profile");
  });
});

describe("usage", () => {
  it("adds up usage over the first try and the repair", async () => {
    const m = fakeModel([
      { content: [broken], usage: { prompt_tokens: 1000, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 } } },
      { content: [fixed], usage: { prompt_tokens: 1100, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 5 } } },
    ]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch });
    expect(r.first.usage).toEqual({ promptTokens: 1000, completionTokens: 50, reasoningTokens: 20 });
    expect(r.usage).toMatchObject({ promptTokens: 2100, completionTokens: 80, reasoningTokens: 25 });
    expect(r.usage.reported).toEqual({ promptTokens: 2, completionTokens: 2, reasoningTokens: 2, attempts: 2 });
  });

  it("leaves a total unknown, not zero, when any attempt didn't report it", async () => {
    const m = fakeModel([{ content: [broken], usage: { prompt_tokens: 1000, completion_tokens: 50 } }, { content: [fixed] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch });
    expect(r.usage.promptTokens).toBeUndefined();
    expect(r.usage.completionTokens).toBeUndefined();
    expect(r.usage.reasoningTokens).toBeUndefined();
    expect(r.usage.reported).toEqual({ promptTokens: 1, completionTokens: 1, reasoningTokens: 0, attempts: 2 });
    expect(r.repair!.usage).toEqual({});
  });

  it("keeps estimates apart from reported numbers", async () => {
    const m = fakeModel([{ reasoning: ["x".repeat(400)], content: [good] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch });
    expect(r.first.inputChars).toBe(m.requests[0]!.body.messages.reduce((n, x) => n + x.content.length, 0));
    expect(r.first.estimatedInputTokens).toBe(Math.round(r.first.inputChars / 4));
    expect(r.first.estimatedThinkingTokens).toBe(100);
    expect(r.first.usage.reasoningTokens).toBeUndefined();
  });

  it("asks for stream usage only when configured", async () => {
    let m = fakeModel([{ content: [good] }]);
    for await (const _ of streamChat(config, [], { fetch: m.fetch })) void _;
    expect(m.requests[0]!.body.stream_options).toBeUndefined();
    m = fakeModel([{ content: [good] }]);
    for await (const _ of streamChat({ ...config, streamUsage: true }, [], { fetch: m.fetch })) void _;
    expect(m.requests[0]!.body.stream_options).toEqual({ include_usage: true });
  });

  it("sums only when every part is known", () => {
    expect(sumUsage([]).promptTokens).toBeUndefined();
    expect(sumUsage([{ promptTokens: 0 }]).promptTokens).toBe(0);
  });
});

describe("bounded refinement", () => {
  const ctx: RefineContext = {
    task: "A packing list for a 3-day hike",
    requirements: ["Prices in euros", "Keep the Remove buttons"],
    changes: ["Add a progress bar", "Group by category"],
    spec: `card\n  text "Hike packing (edited by hand)" style=title\n`,
    state: { todos: [{ text: "Water", done: true }], budget: 40 },
  };

  it("sends the task, requirements, earlier changes, the current spec and the change", async () => {
    const m = fakeModel([{ content: [good] }]);
    const r = await generateSpec({ config, registry, request: "Make the title shorter", refine: ctx, fetch: m.fetch });
    const msgs = m.requests[0]!.body.messages;
    expect(msgs.map((x) => x.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[1]!.content).toContain("A packing list for a 3-day hike");
    expect(msgs[1]!.content).toContain("Keep these requirements:\n- Prices in euros\n- Keep the Remove buttons");
    expect(msgs[1]!.content).toContain("Changes asked for since:\n- Add a progress bar\n- Group by category");
    // The current spec as it is now, hand edits included.
    expect(msgs[2]).toEqual({ role: "assistant", content: ctx.spec });
    expect(msgs[3]!.content).toMatch(/^Change the interface above: Make the title shorter/);
    expect(msgs[3]!.content).toMatch(/including any edits made by hand/);
    expect(r.context).toMatchObject({ policy: "refine", messages: 2, changesSent: 2, changesOmitted: 0, stateNames: ["budget", "todos"] });
  });

  it("sends only the state the app passed, as JSON with sorted names", () => {
    const { messages } = refineMessages(ctx, "x");
    expect(messages.at(-1)!.content).toContain(`Current values from the app (use these names in state):\n{"budget":40,"todos":[{"text":"Water","done":true}]}`);
    const none = refineMessages({ ...ctx, state: undefined }, "x");
    expect(none.messages.at(-1)!.content).not.toContain("Current values");
    expect(none.info.stateNames).toEqual([]);
  });

  it("stays the same size however many turns came before, keeping requirements and the newest changes", () => {
    const changes = Array.from({ length: 50 }, (_, i) => `change ${i + 1}`);
    const { messages, info } = refineMessages({ ...ctx, changes }, "one more", { maxChanges: 5 });
    const first = messages[0]!.content;
    expect(first).toContain("Prices in euros");
    expect(first).toContain("A packing list for a 3-day hike");
    expect(first).toContain("(45 earlier changes not listed; the interface below already includes them)");
    expect(first).toContain("- change 46\n- change 47\n- change 48\n- change 49\n- change 50");
    expect(first).not.toContain("change 45\n");
    expect(info).toMatchObject({ changesSent: 5, changesOmitted: 45 });
    // No earlier specs: one assistant message, the current spec.
    expect(messages.filter((x) => x.role === "assistant")).toEqual([{ role: "assistant", content: ctx.spec }]);
  });

  it("moves on to the accepted spec, and forgets a failed try", async () => {
    const m = fakeModel([{ content: [broken] }, { content: [`nonsense\n`] }]);
    const r = await generateSpec({ config, registry, request: "Red button", refine: ctx, fetch: m.fetch });
    const next = nextRefineContext(ctx, "Red button", r.spec);
    expect(next.spec).toBe(broken); // the repair was rejected; the first spec was accepted
    expect(next.changes).toEqual([...ctx.changes!, "Red button"]);
    expect(next.requirements).toBe(ctx.requirements);
    expect(nextRefineContext(ctx, "Nothing came back", "  \n")).toBe(ctx);
    // The next request carries none of the failed attempts.
    const { messages } = refineMessages(next, "Bigger");
    expect(messages.some((x) => x.content.includes("nonsense"))).toBe(false);
    expect(messages.some((x) => x.content.includes("Your Loom has these problems"))).toBe(false);
  });

  it("can't be mixed with history", async () => {
    await expect(generateSpec({ config, registry, request: "x", refine: ctx, history: [{ role: "user", content: "y" }] })).rejects.toThrow(/history or refine, not both/);
  });

  it("puts the guide first, so requests share it as a prefix", async () => {
    const m = fakeModel([{ content: [good] }, { content: [good] }]);
    await generateSpec({ config, registry, request: "a", fetch: m.fetch, guide: { mode: "compact" } });
    await generateSpec({ config, registry, request: "b", refine: ctx, fetch: m.fetch, guide: { mode: "compact" } });
    expect(m.requests[0]!.body.messages[0]).toEqual(m.requests[1]!.body.messages[0]);
  });
});

describe("existing callers", () => {
  it("get the full guide, no context policy, and the same request shape as before", async () => {
    const m = fakeModel([{ content: [good] }]);
    const r = await generateSpec({ config, registry, request: "a card", fetch: m.fetch });
    const sent = m.requests[0]!.body;
    expect(sent.messages[0]!.content).toContain("ELEMENTS AT A GLANCE");
    expect(sent.messages.slice(1)).toEqual([{ role: "user", content: "a card" }]);
    expect(Object.keys(sent).sort()).toEqual(["max_tokens", "messages", "model", "stream", "temperature"]);
    expect(r.first.guide).toEqual({ mode: "full", profile: "all" });
    expect(r.context.policy).toBe("none");
    expect(r.validatedAgainst).toBe("renderer");
  });
});
