import { beforeEach, describe, expect, it } from "vitest";
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
  it("has 39 requests with unique ids, expecting only elements that exist", () => {
    expect(cases).toHaveLength(39);
    expect(new Set(cases.map((c) => c.id)).size).toBe(39);
    for (const c of cases) for (const e of (c.expect ?? []).flat()) expect(registry.has(e), `${c.id}: ${e}`).toBe(true);
  });
});

describe("scoring", () => {
  const trap = cases.filter((c) => c.id === "trap-red" || c.id === "trap-login" || c.id === "form-booking");

  it("scores valid answers, invented design props and elements, and missing elements", async () => {
    const fetch = fakeModel((req, attempt) => {
      if (req.startsWith("A big red")) return attempt === 0 ? `button "Buy now" color=red\n` : `button "Buy now" variant=danger\n`;
      if (req.startsWith("A login")) return `card\n  textbox "Email"\n  textbox "Password"\n  button "Log in"\n`;
      return `card\n  text "Cabin"\n  button "Book"\n`;
    });
    const results = await runEval(trap, { config, registry, fetch });
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by["trap-red"]).toMatchObject({ validFirst: false, validFinal: true, repaired: true, inventedDesign: ["color"], missing: [] });
    expect(by["trap-login"]).toMatchObject({ validFirst: false, inventedElements: ["textbox"] });
    expect(by["form-booking"]).toMatchObject({ validFirst: true, validFinal: true, missing: ["stepper"], repaired: false });
    expect(by["form-booking"]!.tokensEstimated).toBe(true);

    const s = summarize(results);
    expect(s).toMatchObject({ cases: 3, validFirst: 1, inventedDesign: 1, inventedElements: 1, expectedMet: 2 });
    const md = report(results, { model: "fake", url: config.url, date: "2026-10-20 23:00", guideTokens: 4000, repair: true });
    expect(md).toMatch(/\| Valid on the first try \| 1\/3 \(33%\) \|/);
    expect(md).toMatch(/\| trap-red \| 1 problems \| valid \| — \| — \| color= \|/);
    expect(md).toMatch(/\| form-booking \| valid \| valid \| stepper \| — \|/);
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

describe("behavior checks", () => {
  /** A good and a bad answer per request: the good one must pass every check, the bad one must fail at least one. */
  const answers: Record<string, [good: string, bad: string]> = {
    "data-todo": [
      `state todos=[{text: "A", done: false}, {text: "B", done: true}, {text: "C", done: false}, {text: "D", done: false}, {text: "E", done: false}]
card
  text "{count(todos, 'done')} of 5 done"
  each items=todos as=t
    check "{t.text}" bind=t.done
`,
      `card
  text "1 of 5 done"
  check "A" bind=a
  check "B" bind=b
`,
    ],
    "data-cart": [
      `state cart=[{name: "A", price: 5, qty: 1}, {name: "B", price: 7, qty: 2}, {name: "C", price: 1, qty: 1}]
card
  each items=cart as=i
    row
      text "{i.name}"
      stepper bind=i.qty min=1
  text "Total \${sum(cart, 'price', 'qty')}"
`,
      `state qty=1
card
  each items={[1, 2, 3]} as=i
    text "Item {i}"
  stepper bind=qty
  text "Total $20"
`,
    ],
    "data-orders": [
      `state orders=[{date: "May 1", lines: [{name: "A", price: 2}, {name: "B", price: 3}]}, {date: "May 3", lines: [{name: "C", price: 4}]}, {date: "May 9", lines: [{name: "D", price: 1}, {name: "E", price: 1}]}]
each items=orders as=o
  card
    text "{o.date}"
    each items=o.lines as=l
      text "{l.name}"
    text "Total {sum(o.lines, 'price')}"
`,
      `state orders=[{date: "May 1"}, {date: "May 3"}, {date: "May 9"}]
each items=orders as=o
  text "{o.date}: 2 items"
`,
    ],
    "data-contacts": [
      `state people=[{name: "A", phone: "1"}, {name: "B", phone: "2"}, {name: "C", phone: "3"}, {name: "D", phone: "4"}, {name: "E", phone: "5"}, {name: "F", phone: "6"}]
card
  each items=people as=p
    row
      text "{p.name} {p.phone}"
      button "Remove" variant=secondary on=remove:p
  button "Add contact" on="add:people:{name: 'New', phone: '0'}"
`,
      `card
  text "A"
  text "B"
  button "Add contact" on=emit:add
`,
    ],
    "data-kanban": [
      `state todo=[{t: "A"}, {t: "B"}, {t: "C"}] doing=[{t: "D"}, {t: "E"}, {t: "F"}] done=[{t: "G"}, {t: "H"}]
row
  column
    text "To do"
    each items=todo as=c
      card
        text "{c.t}"
  column
    text "Doing"
    each items=doing as=c
      card
        text "{c.t}"
  column
    text "Done"
    each items=done as=c
      card
        text "{c.t}"
`,
      // Three items with three texts each: nine texts, but only three items.
      `state cols=[{name: "To do"}, {name: "Doing"}, {name: "Done"}]
row
  each items=cols as=c
    column
      text "{c.name}"
      text "Task one"
      text "Task two"
`,
    ],
    "hard-celebrate": [
      `state chores=[{text: "Dishes", done: false}, {text: "Trash", done: true}, {text: "Laundry", done: false}, {text: "Plants", done: false}]
card
  each items=chores as=c
    check "{c.text}" bind=c.done
  text "All done, nice work!" if={count(chores, 'done') == len(chores)}
`,
      `state chores=[{text: "Dishes", done: false}, {text: "Trash", done: false}]
card
  each items=chores as=c
    check "{c.text}" bind=c.done
`,
    ],
  };

  for (const [id, [good, bad]] of Object.entries(answers)) {
    it(`${id}: passes a working answer and catches a broken one`, async () => {
      const c = cases.find((x) => x.id === id)!;
      const [g, b] = await runEval([c, c], { config, registry, fetch: fakeModel(() => { const n = calls++; return n === 0 ? good : bad; }) , repair: false });
      expect(g!.failedChecks, "good answer").toEqual([]);
      expect(g!.validFinal, `good answer problems: ${g!.finalProblems.join("; ")}`).toBe(true);
      expect(b!.failedChecks.length, "bad answer").toBeGreaterThan(0);
    });
  }
  let calls = 0;
  beforeEach(() => { calls = 0; });

  it("counts requests that worked when used, in the summary and report", async () => {
    const c = cases.find((x) => x.id === "data-todo")!;
    const [good] = answers["data-todo"]!;
    const results = await runEval([c], { config, registry, fetch: fakeModel(() => good), repair: false });
    expect(summarize(results)).toMatchObject({ checked: 1, checksMet: 1 });
    expect(report(results, { model: "m", url: "u", date: "d", guideTokens: 1, repair: false })).toMatch(/\| Worked when used \(behavior checks\) \| 1\/1 \(100%\) \|/);
  });
});
