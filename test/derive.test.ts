import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { toData } from "../src/data";
import { evaluate } from "../src/expr";
import { MAX_DERIVED, parse } from "../src/parser";
import { Registry } from "../src/registry";
import { DerivedWriteError, Store } from "../src/state";
import { render, type Rendered } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const order = `state quantity=2 price=350 taxRate=0.08
derive subtotal={quantity * price}
derive tax={subtotal * taxRate}
derive total={subtotal + tax}
stat label="Total" value={total}
`;
const derived = (ui: Rendered) => ui.loom.state.derivedSnapshot();
const messages = (spec: string) => parse(spec, registry).diagnostics.map((d) => `${d.line}: ${d.message}`);

describe("derive lines", () => {
  it("parse into derived values, in order, with the names each reads", () => {
    const r = parse(order, registry);
    expect(r.diagnostics).toEqual([]);
    expect(r.derived.map((d) => [d.name, d.expr, d.line, d.reads])).toEqual([
      ["subtotal", "quantity * price", 2, ["quantity", "price"]],
      ["tax", "subtotal * taxRate", 3, ["subtotal", "taxRate"]],
      ["total", "subtotal + tax", 4, ["subtotal", "tax"]],
    ]);
  });

  it("take several on a line, like state", () => {
    expect(parse(`state a=1\nderive b={a + 1} c={b * 2}\n`, registry).derived.map((d) => d.name)).toEqual(["b", "c"]);
  });

  it("need an expression in braces and a plain name", () => {
    expect(messages(`state a=1\nderive b=5\n`)).toEqual([`2: derive b needs an expression in braces, like derive b={price * qty}. For a fixed starting value, use state b=…`]);
    expect(messages(`state a=1\nderive b={a +}\n`)[0]).toMatch(/^2: derive b: /);
    expect(messages(`derive "Total"\n`)[0]).toMatch(/derive lines take name=\{expression\} pairs, not quoted text/);
    for (const name of ["__proto__", "constructor", "prototype", "screen"]) {
      expect(messages(`derive ${name}={1}\n`), name).toEqual([`1: "${name}" can't be a derived name. Use letters, digits and _, like derive total={…}`]);
    }
    // Names that are only special to JavaScript objects are fine.
    expect(parse(`derive toString={1} valueOf={2}\n`, registry)).toMatchObject({ diagnostics: [], derived: [{ name: "toString" }, { name: "valueOf" }] });
  });

  it("go at the top level only", () => {
    const r = parse(`state a=1\ncard\n  derive b={a}\n  text "{a}"\n`, registry);
    expect(r.derived).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toContain("derive lines go at the top level, unindented, so this one was skipped");
  });

  it("report duplicates and names that are already state, keeping the first", () => {
    const r = parse(`state total=1 a=2\nderive b={a}\nderive b={a * 2}\nderive total={a}\n`, registry);
    expect(r.derived.map((d) => [d.name, d.expr])).toEqual([["b", "a"]]);
    expect(r.diagnostics.map((d) => `${d.line}: ${d.message}`)).toEqual([
      "3: b is already derived on line 2, so this one is ignored. Give it another name",
      "4: total is already state (line 1), so derive total is ignored. A name is either state or derived; rename one",
    ]);
  });

  it("report direct and indirect cycles, and leave those values out", () => {
    const r = parse(`state a=1\nderive x={x + 1}\nderive p={q + 1}\nderive q={r * 2}\nderive r={p}\nderive ok={a + 1}\nderive after={p + ok}\n`, registry);
    expect(r.derived.map((d) => d.name)).toEqual(["ok", "after"]);
    expect(r.diagnostics.map((d) => `${d.line}: ${d.message}`)).toEqual([
      "2: derive x depends on itself (x → x), so it isn't worked out. Compute each from state instead",
      "3: derive p depends on itself (p → q → r → p), so none of these are worked out. Compute each from state instead",
    ]);
    // Something reading a value left out shows nothing, rather than an old result.
    const ui = render(`state a=1\nderive p={q}\nderive q={p}\nderive after={p + a}\ntext "{after}"\n`);
    expect(derived(ui).after).toBeUndefined();
    expect(ui.text()).toContain("—");
  });

  it("report names that aren't state, derived or set by the app", () => {
    expect(messages(`state a=1\nderive b={a + missing}\n`)).toEqual([
      `2: "missing" isn't state or a loop variable, so it shows as nothing. To show it as text, quote it: 'missing'. To use state, declare it: state missing=…`,
    ]);
    expect(parse(`derive b={hostRows}\n`, registry, { knownNames: ["hostRows"] }).diagnostics).toEqual([]);
  });

  it("report writes through bind= and actions", () => {
    expect(messages(`state a=1\nderive b={a * 2}\nstepper bind=b\nbutton "x" on="inc:b;set:a:2"\n`)).toEqual([
      "3: b is derived (line 2), so bind= and actions can't change it. Change the state it's computed from instead",
      "4: b is derived (line 2), so bind= and actions can't change it. Change the state it's computed from instead",
    ]);
  });

  it(`stop at ${MAX_DERIVED}`, () => {
    const lines = Array.from({ length: MAX_DERIVED + 1 }, (_, i) => `derive d${i}={${i}}`).join("\n");
    const r = parse(lines + "\n", registry);
    expect(r.derived).toHaveLength(MAX_DERIVED);
    expect(r.diagnostics.at(-1)!.message).toBe(`A spec can derive at most ${MAX_DERIVED} values, so derive d${MAX_DERIVED} is ignored`);
  });
});

describe("working derived values out", () => {
  it("follows chains and updates when what they read changes", () => {
    const ui = render(order);
    expect(derived(ui)).toEqual({ subtotal: 700, tax: 56, total: 756 });
    expect(ui.text()).toContain("756");
    ui.set("quantity", 3);
    expect(derived(ui)).toEqual({ subtotal: 1050, tax: 84, total: 1134 });
    expect(ui.text()).toContain("1134");
  });

  it("works anything out from what it reads, wherever it's declared", () => {
    // Order doesn't matter: total is declared before what it reads.
    const ui = render(`derive total={subtotal + tax}\ntext "{total}"\nderive tax={subtotal * 0.1}\nstate qty=2 price=5\nderive subtotal={qty * price}\n`);
    expect(ui.diagnostics).toEqual([]);
    expect(derived(ui).total).toBe(11);
  });

  it("works each value out once until what it reads changes, and not for unrelated changes", () => {
    const store = new Store();
    store.set("a", 2);
    store.set("b", 10);
    let runs = 0;
    const reads = (expr: string) => { const names = expr.match(/[a-z]+/g) ?? []; return names; };
    store.derive([
      { name: "x", expr: "a * 2", line: 1, reads: reads("a") },
      { name: "y", expr: "x + 1", line: 2, reads: ["x"] },
      { name: "z", expr: "b * 3", line: 3, reads: ["b"] },
    ]);
    const counting = (name: string) => { const v = store.get(name); runs++; return v; };
    expect([counting("y"), counting("z")]).toEqual([5, 30]);
    // Count evaluations by spying on the cache: reading again doesn't change results or recompute.
    const spy = store as unknown as { computed: Map<string, unknown> };
    expect([...spy.computed.keys()].sort()).toEqual(["x", "y", "z"]);
    store.set("b", 11);
    // Only z is forgotten; x and y are kept.
    expect([...spy.computed.keys()].sort()).toEqual(["x", "y"]);
    expect(store.get("z")).toBe(33);
    store.set("a", 3);
    expect([...spy.computed.keys()].sort()).toEqual(["z"]);
    expect(store.get("y")).toBe(7);
    expect(runs).toBe(2);
  });

  it("evaluates a value once per change, however often a render reads it", () => {
    const store = new Store();
    store.set("n", 1);
    store.derive([{ name: "d", expr: "n + 1", line: 1, reads: ["n"] }]);
    let evals = 0;
    const original = store.get.bind(store);
    const spy = store as unknown as { computed: Map<string, unknown> };
    for (let i = 0; i < 100; i++) { original("d"); if (i === 0) evals = spy.computed.size; }
    expect(evals).toBe(1);
    expect(spy.computed.size).toBe(1);
  });

  it("never keeps an old value once working it out fails, and recovers", () => {
    const warnings: string[] = [];
    const ui = render(`state rows=[{v: 2}, {v: 3}]\nderive first={rows[0].v}\nderive doubled={first * 2}\ntext "{doubled}"\n`);
    expect(derived(ui)).toEqual({ first: 2, doubled: 4 });
    ui.set("rows", toData([]) as Value);
    expect(derived(ui)).toEqual({ first: undefined, doubled: undefined });
    expect(ui.text()).toContain("—");
    expect(ui.warnings[0]).toMatch(/^derive first on line 2 couldn't be worked out, so it shows as nothing: No item 0 in a list of 0/);
    ui.set("rows", toData([{ v: 7 }]) as Value);
    expect(derived(ui)).toEqual({ first: 7, doubled: 14 });
    void warnings;
  });

  it("reads host data, and updates when the host changes it", () => {
    const ui = render(`derive count={len(rows)}\ntext "{count} rows"\n`);
    expect(derived(ui).count).toBeUndefined();
    ui.set("rows", toData([{ a: 1 }, { a: 2 }]) as Value);
    expect(derived(ui).count).toBe(2);
    expect(ui.text()).toContain("2 rows");
  });

  it("keeps state initialization as it was: declarations, app values and edits", () => {
    const ui = render(order);
    ui.set("quantity", 5);
    // Re-parsing the same spec (streaming, small edits) keeps the changed value.
    ui.setSpec(order);
    expect(ui.state.quantity).toBe(5);
    expect(derived(ui).subtotal).toBe(1750);
    // A spec that declares a different starting value wins.
    ui.setSpec(order.replace("quantity=2", "quantity=1"));
    expect(derived(ui).subtotal).toBe(350);
  });

  it("follows the new spec when it's replaced", () => {
    const ui = render(order);
    ui.setSpec(`state quantity=2 price=10\nderive total={quantity * price * 2}\ntext "{total}"\n`);
    expect(derived(ui)).toEqual({ total: 40 });
    // A name that was derived can become state.
    ui.setSpec(`state subtotal=5\ntext "{subtotal}"\n`);
    expect(derived(ui)).toEqual({});
    ui.set("subtotal", 6);
    expect(ui.text()).toContain("6");
  });

  it("gives lists that can't be changed in place, and leaves the source alone", () => {
    const ui = render(`state rows=[{n: "b", v: 2}, {n: "a", v: 1}]\nderive sorted={sort(rows, 'n')}\n`);
    const before = JSON.stringify(ui.state.rows);
    const sorted = derived(ui).sorted as unknown as Array<{ n: string }>;
    expect(sorted.map((r) => r.n)).toEqual(["a", "b"]);
    expect(Object.isFrozen(sorted)).toBe(true);
    expect(Object.isFrozen(sorted[0])).toBe(true);
    expect(JSON.stringify(ui.state.rows)).toBe(before);
  });
});

describe("writing to derived names", () => {
  const spec = `state todos=[{text: "a", done: false}, {text: "b", done: true}] a=1
derive open={filter(todos, 'done', false)}
derive b={a * 2}
stepper bind=b
button "Inc" on=inc:b
button "Clear" on=clear:open
each items=open as=t
  check "{t.text}" bind=t.done
  button "Remove {t.text}" on=remove:t
`;

  it("refuses bind=, actions and list actions, saying why", () => {
    const ui = render(spec);
    const todos = ui.state.todos;
    ui.press({ type: "button", text: "Inc" });
    ui.press({ type: "button", text: "Clear" });
    ui.press({ type: "check", text: "a" });
    ui.press({ type: "button", text: "Remove a" });
    const plus = ui.hits.filter((h) => h.box.node.type === "stepper" && h.detail === "inc")[0]!.box;
    ui.click(plus.x + plus.w / 2, plus.y + plus.h / 2);
    expect(ui.state.todos).toBe(todos);
    expect(ui.state.a).toBe(1);
    expect(derived(ui).b).toBe(2);
    expect(ui.warnings).toEqual([
      "Can't change b: b is derived (derive b on line 3), so it changes only when what it's computed from changes.",
      "Can't change open: open is derived (derive open on line 2), so it changes only when what it's computed from changes.",
      "Can't change t.done: open is derived (derive open on line 2), so it changes only when what it's computed from changes. To change items, loop over the list in state (each items=todos) and hide items with if=",
      "Can't change remove:t: open is derived (derive open on line 2), so it changes only when what it's computed from changes. To change items, loop over the list in state (each items=todos) and hide items with if=",
      "Can't change b: b is derived (derive b on line 3), so it changes only when what it's computed from changes.",
    ]);
  });

  it("refuses the app's own writes through loom.state.set", () => {
    const ui = render(spec);
    expect(() => ui.loom.state.set("b", 5)).toThrow(DerivedWriteError);
    expect(() => ui.loom.state.set("b", 5)).toThrow(/Can't set b: it's derived \(derive b on line 3\)/);
    expect(derived(ui).b).toBe(2);
    // Snapshots of state don't include derived values.
    expect(Object.keys(ui.state).sort()).toEqual(["a", "todos"]);
  });
});

describe("streaming", () => {
  it("parses every line-boundary prefix, with values appearing as what they read arrives", () => {
    const spec = `derive total={subtotal + tax}\nstate qty=2 price=50\nderive subtotal={qty * price}\nderive tax={subtotal * 0.1}\ntext "Total {total}"\n`;
    const lines = spec.split("\n");
    const seen: Array<Value | undefined> = [];
    for (let n = 1; n < lines.length; n++) {
      const ui = render(lines.slice(0, n).join("\n") + "\n");
      // Nothing throws; a value whose inputs haven't arrived is undefined, never a guess.
      seen.push(derived(ui).total);
    }
    expect(seen).toEqual([undefined, undefined, undefined, 110, 110]);
  });

  it("streams in chunks to the same result", () => {
    const whole = render(order);
    const streamed = render("");
    const chunks: string[] = [];
    for (let i = 0; i < order.length; i += 6) chunks.push(order.slice(i, i + 6));
    streamed.stream(chunks);
    expect(streamed.diagnostics).toEqual([]);
    expect(derived(streamed)).toEqual(derived(whole));
    expect(streamed.text()).toEqual(whole.text());
  });
});

describe("the sandbox", () => {
  it("keeps derive expressions inside Loom data", () => {
    for (const expr of ["constructor", "__proto__", "rows.constructor", "rows['constructor']", "rows.__proto__", "toString", "Function", "globalThis", "this", "process", "rows[0].constructor.constructor", "len.constructor"]) {
      const ui = render(`state rows=[{a: 1}]\nderive x={${expr}}\ntext "{x}"\n`);
      const x = derived(ui).x;
      expect(x === undefined || x === null || typeof x !== "function", expr).toBe(true);
      expect(typeof x, expr).not.toBe("function");
      expect(typeof x === "object" && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype, expr).toBe(false);
    }
  });

  it("can't name a derived value after something expressions refuse to read", () => {
    const r = parse(`derive constructor={1}\nderive __proto__={2}\n`, registry);
    expect(r.derived).toEqual([]);
    // And the store reads names only from its own maps.
    expect(evaluate("__proto__", new Store().scope).ok).toBe(false);
  });
});

describe("sums", () => {
  const store = new Store();
  store.set("rows", toData([{ p: 2, q: 3 }, { p: 4, q: 1 }]));
  store.set("mixed", toData([{ p: 2 }, { p: "12" }]));
  store.set("missing", toData([{ p: 2 }, { q: 1 }]));
  store.set("nulls", toData([{ p: 2 }, { p: null }]));
  store.set("flags", toData([{ p: 2 }, { p: true }]));
  store.set("texts", toData(["1", "2"]));
  store.set("empty", toData([]));
  const val = (e: string) => { const r = evaluate(e, store.scope); return r.ok ? r.value : `error: ${r.error}`; };

  it("adds numbers in a field, or two fields multiplied", () => {
    expect(val("sum(rows, 'p')")).toBe(6);
    expect(val("sum(rows, 'p', 'q')")).toBe(10);
  });

  it("is 0 for an empty list", () => {
    expect(val("sum(empty, 'p')")).toBe(0);
  });

  it("is NaN (shown as —) when a value isn't a number, never text joined or read as a number", () => {
    for (const name of ["mixed", "missing", "nulls", "flags"]) expect(val(`sum(${name}, 'p')`), name).toBeNaN();
    expect(val("sum(texts)")).toBeNaN();
    expect(val("avg(mixed, 'p')")).toBeNaN();
    expect(val("max(mixed, 'p')")).toBeNaN();
  });
});

describe("the Order playground sample", () => {
  it("keeps totals, table and chart in step with the controls", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.order!.spec, { width: 375 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(derived(ui)).toMatchObject({ subtotal: 4150, tax: 332, total: 4482 });
    // Raise the first line's quantity: subtotal, table, chart and total follow.
    const plus = ui.hits.filter((h) => h.box.node.type === "stepper" && h.detail === "inc")[0]!.box;
    ui.click(plus.x + plus.w / 2, plus.y + plus.h / 2);
    expect(derived(ui)).toMatchObject({ subtotal: 5350, tax: 428, total: 5778 });
    const table = ui.find("table").box!.data as { rows: Array<{ cells: Array<{ full: string }> }> };
    expect(table.rows[0]!.cells[1]!.full).toBe("3");
    // Filter to accessories with the select: the shared list narrows everywhere.
    ui.press("select");
    const acc = ui.popup!.regions.find((r) => r.detail === "opt:s:accessories")!.box;
    ui.click(acc.x + 5, acc.y + 5);
    expect(derived(ui)).toMatchObject({ subtotal: 700, tax: 56, total: 756 });
    expect((ui.find("chart").box!.data as { slots: Array<{ label: string }> }).slots.map((s) => s.label)).toEqual(["USB-C dock", "Keyboard"]);
    expect(ui.text()).toContain("$756.00");
  });
});
