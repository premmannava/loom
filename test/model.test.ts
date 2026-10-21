import { render } from "../src/testing";
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { generateSpec, loomLineTest, ModelError, SpecFilter, streamChat, type ChatMessage } from "../src/model";
import { Registry } from "../src/registry";

const registry = new Registry(coreComponents);
const config = { url: "http://model.test/v1", model: "test-model" };

interface Reply {
  /** Content chunks, streamed in order. */
  content: string[];
  /** Reasoning chunks sent in a separate field first, as some servers do. */
  reasoning?: string[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** A fake OpenAI-compatible server: each request gets the next reply, as server-sent events split at odd places. */
function fakeModel(replies: Reply[]) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: { model: string; messages: ChatMessage[]; stream: boolean } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const reply = replies[requests.length - 1];
    if (!reply) return new Response("no more replies", { status: 500 });
    const events = [
      ...(reply.reasoning ?? []).map((t) => ({ choices: [{ delta: { reasoning_content: t } }] })),
      ...reply.content.map((t) => ({ choices: [{ delta: { content: t } }] })),
      ...(reply.usage ? [{ choices: [], usage: reply.usage }] : []),
    ];
    const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    // Deliver in 7-byte pieces so events and lines are split across reads.
    const bytes = new TextEncoder().encode(sse);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

const good = `card\n  text "Cabin" style=title\n  button "Book" on=emit:book\n`;

describe("SpecFilter", () => {
  const isLoom = loomLineTest((n) => registry.has(n));
  const run = (chunks: string[]) => {
    const f = new SpecFilter(isLoom);
    let text = "", resets = 0;
    for (const c of chunks) { const o = f.push(c); if (o.reset) { resets++; text = ""; } text += o.text; }
    const o = f.end();
    if (o.reset) { resets++; text = ""; }
    return { text: text + o.text, resets, thinking: f.thinkingChars };
  };

  it("passes plain Loom through, line by line", () => {
    expect(run([good]).text).toBe(good);
    expect(run(good.split("")).text).toBe(good);
  });

  it("drops thinking blocks, even split across chunks", () => {
    const raw = `<think>\nThe user wants a card.\nI'll add a button.\n</think>\n\n${good}`;
    for (const size of [1, 3, 8, 1000]) {
      const chunks = raw.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
      const r = run(chunks);
      expect(r.text, `chunks of ${size}`).toBe(good);
      expect(r.thinking).toBeGreaterThan(20);
    }
  });

  it("starts over when thinking only closes (no opening tag)", () => {
    const r = run(["text \"maybe this\"\nhmm, better a card\n</think>\n", good]);
    expect(r.text).toBe(good);
    expect(r.resets).toBe(1);
  });

  it("drops code fences and chatter before the spec", () => {
    expect(run([`Here's your interface:\n\n\`\`\`loom\n${good}\`\`\`\n`]).text).toBe(good);
  });

  it("keeps the last line without a newline", () => {
    expect(run(["card\n  text \"Hi\""]).text).toBe(`card\n  text "Hi"\n`);
  });

  it("joins a state value spread over several lines, as models write long lists", () => {
    const raw = `state picked="" trails=[
    {name: "Four Peaks", miles: 12, note: "a ] in text"},

    {name: "Papago", miles: 3}
]
card
  each items=trails as=t
    text "{t.name}"
`;
    const joined = `state picked="" trails=[ {name: "Four Peaks", miles: 12, note: "a ] in text"},  {name: "Papago", miles: 3} ]\ncard\n  each items=trails as=t\n    text "{t.name}"\n`;
    for (const size of [1, 5, 1000]) {
      const chunks = raw.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
      expect(run(chunks).text, `chunks of ${size}`).toBe(joined);
    }
    const ui = render(joined);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["Four Peaks", "Papago"]);
  });

  it("passes an unclosed state value on unchanged when it never closes", () => {
    expect(run(["state xs=[1,\n2,\n"]).text).toBe("state xs=[1,\n2,\n");
  });

  it("recognises how a spec can start", () => {
    expect(["state n=0", "# comment", "card", 'text "Hi"', "screen name=a"].every(isLoom)).toBe(true);
    expect(["Here is", "Card for you:", "stated plainly", "texts", ""].some(isLoom)).toBe(false);
  });
});

describe("streamChat", () => {
  it("posts an OpenAI-style streaming request with the key", async () => {
    const m = fakeModel([{ content: ["hi"] }]);
    const parts = [];
    for await (const p of streamChat({ ...config, apiKey: "sk-test" }, [{ role: "user", content: "x" }], { fetch: m.fetch })) parts.push(p);
    expect(parts).toEqual([{ kind: "content", text: "hi" }]);
    expect(m.requests[0]!.url).toBe("http://model.test/v1/chat/completions");
    expect(m.requests[0]!.headers.Authorization).toBe("Bearer sk-test");
    expect(m.requests[0]!.body).toMatchObject({ model: "test-model", stream: true });
  });

  it("sends no Authorization header without a key", async () => {
    const m = fakeModel([{ content: ["hi"] }]);
    for await (const _ of streamChat(config, [], { fetch: m.fetch })) { /* drain */ }
    expect(m.requests[0]!.headers.Authorization).toBeUndefined();
  });

  it("separates reasoning sent in its own field, and records usage", async () => {
    const m = fakeModel([{ reasoning: ["thinking…"], content: ["card\n"], usage: { prompt_tokens: 900, completion_tokens: 12 } }]);
    const usage = {};
    const parts = [];
    for await (const p of streamChat(config, [], { fetch: m.fetch, usage })) parts.push(p);
    expect(parts).toEqual([{ kind: "reasoning", text: "thinking…" }, { kind: "content", text: "card\n" }]);
    expect(usage).toEqual({ promptTokens: 900, completionTokens: 12 });
  });

  it("explains server errors and unreachable servers", async () => {
    const failing = (async () => new Response("model not loaded", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
    await expect(streamChat(config, [], { fetch: failing }).next()).rejects.toThrow(/answered 404 Not Found: model not loaded/);
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(streamChat(config, [], { fetch: down }).next()).rejects.toThrow(/Couldn't reach the model at http:\/\/model\.test\/v1\/chat\/completions\. Is the server running\?/);
    const err = await streamChat(config, [], { fetch: failing }).next().catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
  });
});

describe("generateSpec", () => {
  it("streams clean lines and returns a valid spec without repairing", async () => {
    const m = fakeModel([{ content: ["<think>plan</think>\n", "card\n  text \"Ca", "bin\" style=title\n", "  button \"Book\" on=emit:book\n"] }]);
    const texts: string[] = [];
    const r = await generateSpec({ config, registry, request: "a cabin booking card", fetch: m.fetch, onText: (t) => texts.push(t) });
    expect(r.spec).toBe(good);
    expect(texts.join("")).toBe(good);
    expect(r.diagnostics).toEqual([]);
    expect(r.repair).toBeUndefined();
    expect(m.requests).toHaveLength(1);
    expect(r.first.thinkingChars).toBeGreaterThan(0);
  });

  it("sends the guide as the system message and the request as the user message", async () => {
    const m = fakeModel([{ content: [good] }]);
    await generateSpec({ config, registry, request: "a card", userSuffix: "/no_think", guide: { notes: "A cabin rental site." }, fetch: m.fetch });
    const [system, user] = m.requests[0]!.body.messages;
    expect(system!.role).toBe("system");
    expect(system!.content).toMatch(/^You write user interfaces in Loom/);
    expect(system!.content).toContain("A cabin rental site.");
    expect(user).toEqual({ role: "user", content: "a card\n\n/no_think" });
  });

  it("asks once for a fix, listing the problems, and uses the fixed spec", async () => {
    const m = fakeModel([
      { content: [`card\n  button "Buy" color=red\n  sparkle "x"\n`] },
      { content: [`card\n  button "Buy" variant=danger\n`] },
    ]);
    const phases: string[] = [];
    const resets: string[] = [];
    const r = await generateSpec({ config, registry, request: "a red buy button", fetch: m.fetch, onPhase: (p) => phases.push(p), onReset: (why) => resets.push(why) });
    expect(r.first.diagnostics.length).toBe(2);
    expect(r.spec).toBe(`card\n  button "Buy" variant=danger\n`);
    expect(r.diagnostics).toEqual([]);
    expect(resets).toEqual(["repair"]);
    expect(phases).toContain("repairing");
    const fixMsg = m.requests[1]!.body.messages.at(-1)!;
    expect(fixMsg.content).toMatch(/Line 2 \(warning\): "button" has no prop "color"/);
    expect(fixMsg.content).toMatch(/Line 3 \(error\): Unknown element "sparkle"/);
    expect(m.requests[1]!.body.messages.at(-2)).toEqual({ role: "assistant", content: `card\n  button "Buy" color=red\n  sparkle "x"\n` });
  });

  it("keeps the first spec if the fix is worse", async () => {
    const m = fakeModel([{ content: [`card\n  button "Buy" color=red\n`] }, { content: [`nonsense\nmore nonsense\n`] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch });
    expect(r.spec).toBe(`card\n  button "Buy" color=red\n`);
    expect(r.repair).toBeDefined();
  });

  it("can repair only on errors, or never", async () => {
    const warnOnly = [{ content: [`button "Buy" color=red\n`] }, { content: [good] }];
    let m = fakeModel(warnOnly);
    await generateSpec({ config, registry, request: "x", fetch: m.fetch, repairOn: "errors" });
    expect(m.requests).toHaveLength(1);
    m = fakeModel([{ content: [`sparkle\n`] }]);
    await generateSpec({ config, registry, request: "x", fetch: m.fetch, repairOn: "never" });
    expect(m.requests).toHaveLength(1);
  });

  it("measures time to the first token and the first Loom line", async () => {
    let t = 0;
    const m = fakeModel([{ reasoning: ["hmm"], content: ["card\n"] }]);
    const r = await generateSpec({ config, registry, request: "x", fetch: m.fetch, now: () => (t += 10) });
    expect(r.timings.firstTokenMs).toBeGreaterThan(0);
    expect(r.timings.firstLineMs).toBeGreaterThan(r.timings.firstTokenMs!);
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.timings.firstLineMs!);
  });

  it("carries history for follow-up requests", async () => {
    const m = fakeModel([{ content: [good] }, { content: [good] }]);
    const first = await generateSpec({ config, registry, request: "a card", fetch: m.fetch });
    await generateSpec({ config, registry, request: "make it shorter", history: first.messages.slice(1), fetch: m.fetch });
    const msgs = m.requests[1]!.body.messages.map((x) => [x.role, x.content.split("\n")[0]]);
    expect(msgs).toEqual([
      ["system", expect.stringMatching(/^You write user interfaces/)],
      ["user", "a card"],
      ["assistant", "card"],
      ["user", "make it shorter"],
    ]);
  });
});
