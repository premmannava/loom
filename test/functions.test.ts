/**
 * List functions and formatting: filter, find, search, sort, take, count and
 * min/max with fields, money, number, plural, lower, upper, trim. These came
 * from writing 21 real-world screens and wanting them in most of them.
 */
import { describe, expect, it } from "vitest";
import { isData } from "../src/data";
import { evaluate, interpolate } from "../src/expr";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const store = new Store();
store.set("tx", [
  { name: "Whole Foods", cat: "Groceries", amount: -84.12 },
  { name: "Shell", cat: "Gas", amount: -46.5 },
  { name: "Payroll", cat: "Income", amount: 2400 },
  { name: "Trader Joe's", cat: "Groceries", amount: -38.9 },
] as unknown as Value);
store.set("rooms", [{ id: "q", rate: 189 }, { id: "k", rate: 249 }] as unknown as Value);
store.set("items", [{ name: "Socks", price: 24, ret: true }, { name: "Shell", price: 149, ret: false }, { name: "Boots", price: 129, ret: true }] as unknown as Value);
store.set("nums", [3, 9, 4] as unknown as Value);
store.set("cat", "Groceries");
const val = (src: string) => {
  const r = evaluate(src, store.scope);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.value;
};
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("filtering", () => {
  it("filters by a true field or an equal field, and composes with sum and len", () => {
    expect(json(val("filter(items, 'ret')")).map((i: { name: string }) => i.name)).toEqual(["Socks", "Boots"]);
    expect(val("sum(filter(items, 'ret'), 'price')")).toBe(153);
    expect(val("sum(filter(tx, 'cat', cat), 'amount')")).toBeCloseTo(-123.02);
    expect(val("len(filter(tx, 'cat', 'Gas'))")).toBe(1);
    expect(json(val("filter([0, 1, '', 'x'])"))).toEqual([1, "x"]);
  });

  it("counts items whose field equals a value", () => {
    expect(val("count(tx, 'cat', 'Groceries')")).toBe(2);
    expect(val("count(items, 'ret')")).toBe(2);
  });

  it("finds one item, or null", () => {
    expect(val("find(rooms, 'id', 'k').rate")).toBe(249);
    expect(val("find(rooms, 'id', 'x')")).toBeNull();
    expect(interpolate("{find(rooms, 'id', 'x').rate}", store.scope)).toBe("—");
  });

  it("searches a field for text, ignoring case, with empty text matching all", () => {
    expect(json(val("search(tx, 'name', 'SHE')")).map((t: { name: string }) => t.name)).toEqual(["Shell"]);
    expect(val("len(search(tx, 'name', ''))")).toBe(4);
    expect(val("len(search(tx, 'name', '  joe '))")).toBe(1);
  });
});

describe("sorting and taking", () => {
  it("sorts by a field either way, and plain values", () => {
    expect(json(val("sort(rooms, 'rate', 'desc')")).map((r: { id: string }) => r.id)).toEqual(["k", "q"]);
    expect(json(val("sort(tx, 'name')")).map((t: { name: string }) => t.name)).toEqual(["Payroll", "Shell", "Trader Joe's", "Whole Foods"]);
    expect(json(val("sort(nums)"))).toEqual([3, 4, 9]);
    expect(json(val("sort(nums, 'desc')"))).toEqual([9, 4, 3]);
    expect(json(val("sort([{a: 2}, {b: 1}, {a: 1}], 'a')"))).toEqual([{ a: 1 }, { a: 2 }, { b: 1 }]);
  });

  it("takes the first items, and leaves the original list alone", () => {
    expect(json(val("take(sort(items, 'price', 'desc'), 2)")).map((i: { name: string }) => i.name)).toEqual(["Shell", "Boots"]);
    expect(json(val("take(nums, 0)"))).toEqual([]);
    expect(json(val("nums"))).toEqual([3, 9, 4]);
  });

  it("finds the smallest and largest of a field", () => {
    expect(val("max(tx, 'amount')")).toBe(2400);
    expect(val("min(rooms, 'rate')")).toBe(189);
    expect(val("max(nums)")).toBe(9);
    expect(interpolate("{max([], 'x')}", store.scope)).toBe("—");
  });
});

describe("formatting", () => {
  it("formats money, numbers and plurals", () => {
    expect(val("money(2400)")).toBe("$2,400.00");
    expect(val("money(-84.1)")).toBe("-$84.10");
    expect(val("money(12.5, 'EUR')")).toBe("€12.50");
    expect(interpolate("{money(1, 'nope')}", store.scope)).toBe("—");
    expect(val("number(37000)")).toBe("37,000");
    expect(val("number(1234.567)")).toBe("1,234.57");
    expect(val("number(5, 2)")).toBe("5.00");
    expect(val("plural(1, 'item')")).toBe("1 item");
    expect(val("plural(3, 'item')")).toBe("3 items");
    expect(val("plural(2, 'child', 'children')")).toBe("2 children");
    expect(val("plural(1200, 'runner')")).toBe("1,200 runners");
  });

  it("changes case and trims text", () => {
    expect(val("lower('Sunny')")).toBe("sunny");
    expect(val("upper('ok')")).toBe("OK");
    expect(val("trim('  hi ')")).toBe("hi");
    expect(val("lower(null)")).toBe("");
    expect(val("upper(12)")).toBe("12");
  });
});

describe("the sandbox", () => {
  const attempts = [
    "filter(tx, '__proto__')",
    "filter(tx, 'constructor', 1)",
    "find(rooms, '__proto__', null)",
    "find(rooms, 'constructor')",
    "sort(rooms, 'constructor')",
    "search(rooms, '__proto__', 'o')",
    "max(rooms, '__proto__')",
    "count(rooms, 'toString')",
    "money(1, 'constructor')",
    "take(rooms, '__proto__')",
  ];
  for (const src of attempts) {
    it(`gives only SayShape data for ${src}`, () => {
      const r = evaluate(src, store.scope);
      if (r.ok) expect(isData(r.value) || typeof r.value === "number").toBe(true);
    });
  }

  it("never returns host objects or functions", () => {
    for (const src of ["filter(tx, 'cat', 'Gas')", "sort(tx, 'amount')", "take(tx, 2)", "search(tx, 'name', 'a')", "find(tx, 'cat', 'Gas')"]) {
      expect(isData(val(src)), src).toBe(true);
    }
  });
});

describe("in screens", () => {
  it("make the screens from the use-case run correct", () => {
    const ui = render(`state cat="All" tx=[{name: "Whole Foods", cat: "Groceries", amount: -84.12}, {name: "Payroll", cat: "Income", amount: 2400}, {name: "Shell", cat: "Gas", amount: -46.5}]
card
  tabs bind=cat
    tab "All"
    tab "Groceries"
  each items={cat == 'All' ? tx : filter(tx, 'cat', cat)} as=t
    text "{t.name} {money(t.amount)}"
  text "Spent {money(abs(sum(filter(sort(tx, 'amount'), 'cat', 'Groceries'), 'amount')))}"
  text "{plural(len(tx), 'transaction')}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Payroll $2,400.00", "Spent $84.12", "3 transactions"]));
    ui.set("cat", "Groceries");
    expect(ui.text()).not.toContain("Payroll $2,400.00");
  });
});
