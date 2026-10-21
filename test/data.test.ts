import { describe, expect, it } from "vitest";
import { DataError, isData, looksLikeData, MAX_DATA_DEPTH, MAX_DATA_VALUES, parseData, toData } from "../src/data";
import { evaluate, interpolate } from "../src/expr";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const ok = (src: string): Value => {
  const r = parseData(src);
  if ("error" in r) throw new Error(r.error);
  return r.value;
};
const err = (src: string): string => {
  const r = parseData(src);
  if (!("error" in r)) throw new Error(`expected an error for ${src}`);
  return r.error;
};
/** Compare data as plain JSON, since records have no prototype. */
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

describe("data literals", () => {
  it("reads lists, records and nesting", () => {
    expect(json(ok(`[1, 2.5, -3, 1e3]`))).toEqual([1, 2.5, -3, 1000]);
    expect(json(ok(`{name: "Socks", price: 24, wool: true, note: null}`))).toEqual({ name: "Socks", price: 24, wool: true, note: null });
    expect(json(ok(`[{text:'Pack water', done:false}, {text:"Snacks", done:true}]`))).toEqual([{ text: "Pack water", done: false }, { text: "Snacks", done: true }]);
    expect(json(ok(`{order: {lines: [{qty: 2}]}}`))).toEqual({ order: { lines: [{ qty: 2 }] } });
  });

  it("accepts quoted names, escapes, empty values and trailing commas", () => {
    expect(json(ok(`{"unit price": 3, 'size-eu': 42,}`))).toEqual({ "unit price": 3, "size-eu": 42 });
    expect(ok(`["She said \\"hi\\"", 'it\\'s', "a\\nb"]`)).toEqual([`She said "hi"`, "it's", "a\nb"]);
    expect(json(ok(`[]`))).toEqual([]);
    expect(json(ok(`{}`))).toEqual({});
    expect(json(ok(`[ 1 , 2 , ]`))).toEqual([1, 2]);
  });

  it("makes frozen data with no prototype", () => {
    const v = ok(`{a: [1, {b: 2}]}`) as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBeNull();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.a)).toBe(true);
    expect(isData(v)).toBe(true);
  });

  it("can't pollute prototypes", () => {
    const v = ok(`{__proto__: {polluted: 1}, constructor: {prototype: {polluted: 1}}}`) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(v)).toBeNull();
    expect(Object.keys(v)).toEqual(["__proto__", "constructor"]);
  });

  it("explains mistakes, with where they are", () => {
    expect(err(`[1, 2`)).toMatch(/Missing "\]"/);
    expect(err(`[1 2]`)).toMatch(/Expected "," or "\]" but found "2" at character 4/);
    expect(err(`{name "Ada"}`)).toMatch(/Expected ":" after "name"/);
    expect(err(`{name: "Ada}`)).toMatch(/Unclosed quote/);
    expect(err(`[undefined]`)).toMatch(/Unexpected "u"/);
    expect(err(`[1] x`)).toMatch(/Unexpected "x" after the value/);
    expect(err(`[NaN, Infinity]`)).toMatch(/Unexpected "N"/);
    expect(err(`[x => 1]`)).toMatch(/Unexpected/);
  });

  it("refuses data that's too deep or too big", () => {
    expect(err("[".repeat(MAX_DATA_DEPTH + 1) + "]".repeat(MAX_DATA_DEPTH + 1))).toMatch(/Nested more than 20 levels/);
    expect(ok("[".repeat(MAX_DATA_DEPTH) + "]".repeat(MAX_DATA_DEPTH))).toBeDefined();
    expect(err(`[${Array(MAX_DATA_VALUES + 1).fill(0).join(",")}]`)).toMatch(/More than 10000 values/);
  });

  it("tells literals apart from expressions", () => {
    for (const s of ["[1]", "[]", "{a: 1}", '{"a": 1}', "{ 'a b': 1 }", "{}"]) expect(looksLikeData(s), s).toBe(true);
    for (const s of ["{a + b}", "{x ? 1 : 2}", "{a}", "hello", "{'$' + price}", "{round(a, 2)}"]) expect(looksLikeData(s), s).toBe(false);
  });
});

describe("data from the host", () => {
  it("copies plain objects and arrays into frozen data", () => {
    const rows = [{ name: "Socks", price: 24, tags: ["wool"] }];
    const v = toData(rows) as Array<Record<string, unknown>>;
    expect(json(v)).toEqual(rows);
    expect(v).not.toBe(rows);
    expect(Object.isFrozen(v[0])).toBe(true);
    rows[0]!.price = 99; // the app's own object stays the app's
    expect(v[0]!.price).toBe(24);
  });

  it("leaves out undefined fields and reuses data it already made", () => {
    expect(json(toData({ a: 1, b: undefined }))).toEqual({ a: 1 });
    const made = toData([1, 2]);
    expect(toData(made)).toBe(made);
    const shared = { x: 1 };
    expect(json(toData([shared, shared]))).toEqual([{ x: 1 }, { x: 1 }]);
  });

  it("rejects what can't be data, saying where", () => {
    expect(() => toData({ onClick: () => 1 })).toThrow(/the value\.onClick is a function/);
    expect(() => toData([new Date()])).toThrow(/the value\[0\] is a Date/);
    expect(() => toData({ m: new Map() })).toThrow(/is a Map/);
    class Product { name = "x"; }
    expect(() => toData([new Product()])).toThrow(/is a Product/);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => toData(loop)).toThrow(/refers back to itself/);
    expect(() => toData({ n: NaN })).toThrow(/isn't a usable number/);
    expect(() => toData(Symbol("x") as unknown)).toThrow(DataError);
  });

  it("refuses data that's too deep or too big", () => {
    let deep: unknown = 1;
    for (let i = 0; i < MAX_DATA_DEPTH + 1; i++) deep = [deep];
    expect(() => toData(deep)).toThrow(/nested more than 20 levels/);
    expect(() => toData(Array(MAX_DATA_VALUES + 1).fill(0))).toThrow(/More than 10000 values/);
  });

  it("goes through the store, which copies or refuses", () => {
    const store = new Store();
    store.set("rows", [{ a: 1 }] as unknown as Value);
    expect(isData(store.get("rows"))).toBe(true);
    expect(() => store.set("bad", { f: () => 1 } as unknown as Value)).toThrow(/is a function/);
    expect(store.has("bad")).toBe(false);
  });
});

describe("data in expressions and text", () => {
  const store = new Store();
  store.set("tags", ["wool", "trail"] as unknown as Value);
  store.set("cart", [{ name: "Socks" }] as unknown as Value);
  store.set("n", 2);
  const ev = (src: string) => evaluate(src, store.scope);

  it("shows a list of plain values joined, and records as a dash", () => {
    expect(interpolate("Tags: {tags}", store.scope)).toBe("Tags: wool, trail");
    expect(interpolate("Cart: {cart}", store.scope)).toBe("Cart: —");
    expect(ev("'Tags: ' + tags")).toEqual({ ok: true, value: "Tags: wool, trail" });
  });

  it("never treats lists or records as numbers or orders them", () => {
    store.set("one", [5] as unknown as Value);
    expect(interpolate("{one * 2}", store.scope)).toBe("—");
    expect(ev("one < 10")).toEqual({ ok: true, value: false });
    expect(ev("max(one, 1)")).toEqual({ ok: true, value: NaN });
    expect(ev("tags == tags")).toEqual({ ok: true, value: true });
    expect(ev("n < 3 && 'a' < 'b'")).toEqual({ ok: true, value: true });
  });

  it("still refuses objects a scope didn't get from Loom's data", () => {
    const sneaky = (k: string) => (k === "x" ? ({ a: 1 } as unknown as Value) : undefined);
    expect(evaluate("x", sneaky).ok).toBe(false);
  });
});

describe("data on state lines", () => {
  const reg = new Registry(coreComponents);

  it("declares lists and records, even with spaces and quotes inside", () => {
    const r = parse(`state todos=[{text:"Pack water", done:false}, {text:'Snacks', done:true}] n=2 who={name: "Ada Lovelace"}\n`, reg);
    expect(r.diagnostics).toEqual([]);
    expect(r.state.map((s) => s.key)).toEqual(["todos", "n", "who"]);
    expect(json(r.state[0]!.value)).toEqual([{ text: "Pack water", done: false }, { text: "Snacks", done: true }]);
  });

  it("warns about a broken literal, skips only that value, and says how to write one", () => {
    const r = parse(`state good=1 bad=[1 2] also=3\n`, reg);
    expect(r.state.map((s) => s.key)).toEqual(["good", "also"]);
    expect(r.diagnostics[0]!.message).toMatch(/State "bad" wasn't set: Expected "," or "\]" but found "2" .*Write lists like \[1, 2\]/);
  });

  it("says when a list or record isn't closed on its line", () => {
    const r = parse(`state good=1 bad=[1, 2\n`, reg);
    expect(r.state.map((s) => s.key)).toEqual(["good"]);
    expect(r.diagnostics[0]!.message).toBe(`Unclosed value for "bad": its "[" isn't closed with "]" on this line`);
  });

  it("still refuses expressions as initial state", () => {
    const r = parse(`state total={a + b}\n`, reg);
    expect(r.diagnostics[0]!.message).toMatch(/must be a plain value, list or record, not an expression/);
  });

  it("renders data read from state", () => {
    const ui = render(`state tags=["wool", "trail"]\ntext "Made of {tags}"\n`);
    expect(ui.text()).toContain("Made of wool, trail");
  });

  it("takes data from the host app and redraws", () => {
    const ui = render(`state tags=[]\ntext "Tags: {tags}"\n`);
    ui.set("tags", ["rain", "summit"] as unknown as Value);
    expect(ui.text()).toContain("Tags: rain, summit");
  });
});

describe("state lines over time", () => {
  it("keep the user's changes while the declaration stays the same, and take a new declaration", async () => {
    const { render } = await import("../src/testing");
    const ui = render(`state n=1 todos=[{t: "A"}]\nstepper bind=n\ntext "{len(todos)}"\n`);
    ui.set("n", 5);
    ui.setSpec(`state n=1 todos=[{t: "A"}]\nstepper bind=n\ntext "{len(todos)} items"\n`);
    expect(ui.state.n).toBe(5);
    ui.setSpec(`state n=1 todos=[{t: "A"}, {t: "B"}]\nstepper bind=n\ntext "{len(todos)} items"\n`);
    expect(ui.state.n).toBe(5);
    expect(ui.text()).toContain("2 items");
    ui.setSpec(`state n=2 todos=[{t: "A"}, {t: "B"}]\nstepper bind=n\n`);
    expect(ui.state.n).toBe(2);
  });

  it("never replace data the app supplied itself", async () => {
    const { render } = await import("../src/testing");
    const ui = render(`text "x"\n`);
    ui.set("products", [{ name: "Tent" }] as never);
    ui.setSpec(`state products=[]\ntext "{len(products)} products"\n`);
    expect(ui.text()).toContain("1 products");
  });
});
