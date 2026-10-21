import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { Registry } from "../src/registry";
import { cases } from "../eval/cases";
import { report, runEval, summarize } from "../eval/run";

const registry = new Registry([...coreComponents, ...mapComponents]);

/** Replies by request: each request text maps to the model's answers (first, then the fix). */
function fakeModel(byRequest: (request: string, attempt: number) => string) {
  const seen = new Map<string, number>();
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> };
    const request = body.messages.find((m, i) => m.role === "user" && i === 1)!.content;
    const attempt = seen.get(request) ?? 0;
    seen.set(request, attempt + 1);
    const text = byRequest(request, attempt);
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { status: 200 });
  }) as typeof fetch;
}

const config = { url: "http://model.test/v1", model: "fake" };

describe("evaluation set", () => {
  it("has 30 requests with unique ids, expecting only elements that exist", () => {
    expect(cases).toHaveLength(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(30);
    for (const c of cases) for (const e of (c.expect ?? []).flat()) expect(registry.has(e), `${c.id}: ${e}`).toBe(true);
  });
});

describe("scoring", () => {
  const trap = cases.filter((c) => c.id === "trap-red" || c.id === "trap-login" || c.id === "form-booking");

  it("scores valid answers, invented design props and elements, and missing elements", async () => {
    const fetch = fakeModel((req, attempt) => {
      if (req.startsWith("A big red")) return attempt === 0 ? `button "Buy now" color=red\n` : `button "Buy now" variant=danger\n`;
      if (req.startsWith("A login")) return `card\n  input "Email"\n  input "Password"\n  button "Log in"\n`;
      return `card\n  text "Cabin"\n  button "Book"\n`;
    });
    const results = await runEval(trap, { config, registry, fetch });
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by["trap-red"]).toMatchObject({ validFirst: false, validFinal: true, repaired: true, inventedDesign: ["color"], missing: [] });
    expect(by["trap-login"]).toMatchObject({ validFirst: false, inventedElements: ["input"] });
    expect(by["form-booking"]).toMatchObject({ validFirst: true, validFinal: true, missing: ["stepper"], repaired: false });
    expect(by["form-booking"]!.tokensEstimated).toBe(true);

    const s = summarize(results);
    expect(s).toMatchObject({ cases: 3, validFirst: 1, inventedDesign: 1, inventedElements: 1, expectedMet: 2 });
    const md = report(results, { model: "fake", url: config.url, date: "2026-10-20 23:00", guideTokens: 4000, repair: true });
    expect(md).toMatch(/\| Valid on the first try \| 1\/3 \(33%\) \|/);
    expect(md).toMatch(/\| trap-red \| 1 problems \| valid \| — \| color= \|/);
    expect(md).toMatch(/\| form-booking \| valid \| valid \| stepper \|/);
  });

  it("records a failed request and keeps going", async () => {
    let n = 0;
    const flaky = (async (...a: Parameters<typeof fetch>) => {
      if (n++ === 0) return new Response("model not loaded", { status: 404, statusText: "Not Found" });
      return fakeModel(() => `button "Ok"\n`)(...a);
    }) as typeof fetch;
    const results = await runEval(trap.slice(0, 2), { config, registry, fetch: flaky });
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/404/) });
    expect(results[1]!.ok).toBe(true);
    expect(report(results, { model: "fake", url: "u", date: "d", guideTokens: 1, repair: true })).toMatch(/failed: The model server answered 404/);
  });
});
