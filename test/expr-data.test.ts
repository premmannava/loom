/**
 * Reading lists and records in expressions (lists and data, step 2), and the
 * sandbox around it: property access is where prototype tricks live, so
 * every escape attempt below must fail.
 */
import { describe, expect, it } from "vitest";
import { isData } from "../src/data";
import { checkSyntax, evaluate, interpolate } from "../src/expr";
import { Store } from "../src/state";
import type { Value } from "../src/types";

const store = new Store();
store.set("todos", [{ text: "Pack water", done: false }, { text: "Charge headlamp", done: true }, { text: "Snacks", done: true }] as unknown as Value);
store.set("cart", [{ name: "Socks", price: 24, qty: 2 }, { name: "Shell", price: 129, qty: 1 }] as unknown as Value);
store.set("tags", ["wool", "trail"] as unknown as Value);
store.set("nums", [3, 9, 4] as unknown as Value);
store.set("order", { id: 7, lines: [{ sku: "A", qty: 1 }], "unit price": 5, __proto__: 1 } as unknown as Value);
store.set("word", "summit");
store.set("i", 1);
const ev = (src: string) => evaluate(src, store.scope);
const val = (src: string) => {
  const r = ev(src);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.value;
};
const err = (src: string) => {
  const r = ev(src);
  if (r.ok) throw new Error(`${src} should fail but gave ${JSON.stringify(r.value)}`);
  return r.error;
};

describe("reading fields and items", () => {
  it("reads record fields, list items and length", () => {
    expect(val("todos[0].text")).toBe("Pack water");
    expect(val("todos[i].done")).toBe(true);
    expect(val("order.lines[0].sku")).toBe("A");
    expect(val("order['unit price'] * 2")).toBe(10);
    expect(val("todos.length")).toBe(3);
    expect(val("word.length")).toBe(6);
    expect(val("cart[1].price * cart[1].qty")).toBe(129);
  });

  it("explains reads that don't work", () => {
    expect(err("todos[9]")).toBe("No item 9 in a list of 3");
    expect(err("todos[0].colour")).toBe(`No field "colour"`);
    expect(err("todos.first")).toMatch(/Lists only have items by number and length/);
    expect(err("word[0]")).toMatch(/Text only has a length/);
    expect(err("i.x")).toBe(`number has no "x"`);
    expect(err("todos[0.5]")).toMatch(/No item 0.5/);
  });

  it("shows a failed read as a dash in text, and treats it as false in conditions", () => {
    expect(interpolate("{todos[9].text}", store.scope)).toBe("—");
    expect(interpolate("{todos[0].text} first", store.scope)).toBe("Pack water first");
  });

  it("keeps .5 a number and a.b a field", () => {
    expect(val(".5 + 1")).toBe(1.5);
    expect(val("1.5 * 2")).toBe(3);
  });
});

describe("list and record literals", () => {
  it("makes lists and records that are Loom data", () => {
    const r = val("{text: 'Snacks', done: false, tags: ['a', 'b']}") as Record<string, unknown>;
    expect(isData(r)).toBe(true);
    expect(Object.getPrototypeOf(r)).toBeNull();
    expect(JSON.parse(JSON.stringify(r))).toEqual({ text: "Snacks", done: false, tags: ["a", "b"] });
    expect(JSON.parse(JSON.stringify(val("[1, i + 1, {x: word}]")))).toEqual([1, 2, { x: "summit" }]);
    expect(val("[10, 20, 30][i]")).toBe(20);
    expect(val("{a: {b: 'deep'}}.a.b")).toBe("deep");
  });

  it("tells a record from a ternary", () => {
    expect(val("i > 0 ? 'yes' : 'no'")).toBe("yes");
    expect(checkSyntax("text: 'x', done: true")).toBeNull();
    expect(checkSyntax("'unit price': 3")).toBeNull();
  });

  it("explains broken literals", () => {
    expect(checkSyntax("[1, 2")).toMatch(/Expected "\]"/);
    expect(checkSyntax("{a 1}")).toMatch(/Expected ":"/);
    expect(checkSyntax("{1: 2}")).toMatch(/Expected a field name/);
    expect(checkSyntax("a.")).toMatch(/Expected a field name after "\."/);
    expect(checkSyntax("[".repeat(25) + "]".repeat(25))).toMatch(/nest more than 20 levels/);
  });
});

describe("list functions", () => {
  it("counts, sums and averages", () => {
    expect(val("len(todos)")).toBe(3);
    expect(val("len(word)")).toBe(6);
    expect(val("count(todos, 'done')")).toBe(2);
    expect(val("count([0, 1, '', 'x', null])")).toBe(2);
    expect(val("sum(nums)")).toBe(16);
    expect(val("sum(cart, 'price')")).toBe(153);
    expect(val("sum(cart, 'price', 'qty')")).toBe(177);
    expect(val("avg(nums)")).toBeCloseTo(5.333, 3);
    expect(val("avg(cart, 'qty')")).toBe(1.5);
    expect(val("max(nums)")).toBe(9);
    expect(val("min(nums)")).toBe(3);
    expect(val("max(1, 7, 2)")).toBe(7);
  });

  it("joins items or a field of each", () => {
    expect(val("join(tags)")).toBe("wool, trail");
    expect(val("join(tags, ' / ')")).toBe("wool / trail");
    expect(val("join(cart, 'name')")).toBe("Socks, Shell");
    expect(val("join(cart, 'name', ' + ')")).toBe("Socks + Shell");
  });

  it("checks membership in lists and text", () => {
    expect(val("includes(tags, 'wool')")).toBe(true);
    expect(val("includes(tags, 'silk')")).toBe(false);
    expect(val("includes(word, 'mm')")).toBe(true);
  });

  it("gives NaN (a dash in text) for things that aren't lists, or missing fields", () => {
    expect(interpolate("{sum(word)}", store.scope)).toBe("—");
    expect(interpolate("{sum(cart, 'cost')}", store.scope)).toBe("—");
    expect(interpolate("{avg([])}", store.scope)).toBe("—");
    expect(val("len(i)")).toBeNaN();
  });

  it("works inside text, as a model would write it", () => {
    expect(interpolate("{count(todos, 'done')} of {len(todos)} packed", store.scope)).toBe("2 of 3 packed");
    expect(interpolate("Total \${sum(cart, 'price', 'qty')}", store.scope)).toBe("Total $177");
  });
});

describe("the sandbox around property access", () => {
  const escapes = [
    "todos.constructor",
    "todos['constructor']",
    "todos.constructor.constructor",
    "todos['con' + 'structor']",
    "order.__proto__",
    "order['__proto__']",
    "order.prototype",
    "todos[0].constructor",
    "todos[0].hasOwnProperty",
    "todos[0].toString",
    "todos[0].valueOf",
    "todos.map",
    "todos.push",
    "todos['map']",
    "word.constructor",
    "word.toUpperCase",
    "word['charAt']",
    "word[0]",
    "[].constructor",
    "{}.constructor",
    "{a: 1}.__proto__",
    "{__proto__: 1}.__proto__",
    "(1).constructor",
    "i.toFixed",
    "len.constructor",
    "true.valueOf",
    "null.x",
    "todos[-1]",
    "todos['0']",
  ];

  for (const src of escapes) {
    it(`refuses ${src}`, () => {
      const r = ev(src);
      expect(r.ok).toBe(false);
    });
  }

  it("never returns anything but Loom data", () => {
    for (const src of ["todos", "todos[0]", "order.lines", "{a: [1]}", "[todos[0], order]", "join(cart, 'name')"]) {
      expect(isData(val(src)), src).toBe(true);
    }
  });

  it("leaves Object.prototype alone", () => {
    ev("{__proto__: {polluted: 1}}");
    ev("{constructor: {prototype: {polluted: 1}}}");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("doesn't read fields of data it didn't make, even from a sneaky scope", () => {
    const sneaky = (k: string): Value | undefined => (k === "x" ? ({ secret: 1 } as unknown as Value) : undefined);
    expect(evaluate("x.secret", sneaky).ok).toBe(false);
  });
});

describe("lists and records where a number is expected", () => {
  // Records have no prototype, so Number(record) would throw; everything must use toNumber.
  it("doesn't crash actions or number-reading components", async () => {
    const { render } = await import("../src/testing");
    const ui = render(`state r={a: 1} l=[1, 2]
stepper bind=r
slider bind=l
rating bind=r
pagination bind=l pages=3
button "Inc" on="inc:r;dec:l;inc:r:{l};inc:r:{{}}"
text "{r} {l} {includes('abc', r)}"
`);
    expect(ui.diagnostics).toEqual([]);
    ui.press("button");
    expect(ui.state.r).toBe(1);
    expect(ui.state.l).toBe(0);
    for (let i = 0; i < 8; i++) { ui.tab(); ui.key("Enter"); ui.key("ArrowRight"); }
  });
});

describe("props with several expressions", () => {
  it("treat {a} · {b} as text with two expressions, not one expression", async () => {
    const { wholeExpression } = await import("../src/expr");
    expect(wholeExpression("{a}")).toBe("a");
    expect(wholeExpression("{a ? 'x' : 'y'}")).toBe("a ? 'x' : 'y'");
    expect(wholeExpression("{{x: 1}}")).toBe("{x: 1}");
    expect(wholeExpression("{a} · {b}")).toBeNull();
    expect(wholeExpression("{a}{b}")).toBeNull();
    expect(wholeExpression("{'}'}")).toBe("'}'");
    expect(wholeExpression("a {b}")).toBeNull();

    const { render } = await import("../src/testing");
    const ui = render(`state tx=[{date: "Oct 20", cat: "Gas", amount: -46.5}]
list
  each items=tx as=t
    list-item "Shell" detail="{t.date} · {t.cat}" trailing="{t.amount < 0 ? '-' : '+'}\${abs(t.amount)}"
progress value={1} max=2 label="{len(tx)} of {2}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Oct 20 · Gas", "-$46.5", "1 of 2"]));
  });

  it("fill in text with expressions in action values", async () => {
    const { render } = await import("../src/testing");
    const ui = render(`state name="Ada" msg=""\nbutton "Hi" on="set:msg:'Hi {name}!'"\ntext "{msg}"\n`);
    ui.press("button");
    expect(ui.state.msg).toBe("Hi Ada!");
  });
});
