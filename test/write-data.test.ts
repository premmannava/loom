/**
 * Changing data (lists and data, step 4): bind= and actions with paths like
 * t.done, the list actions add/remove/clear, and updates that never change
 * data in place.
 */
import { describe, expect, it } from "vitest";
import { parseActions } from "../src/actions";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { makeList, makeRecord, toData } from "../src/data";
import { parse } from "../src/parser";
import { getIn, placeOf, setIn, stateLocate } from "../src/paths";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";
import type { Value } from "../src/types";

const ALL = [...coreComponents, ...mapComponents];
const registry = new Registry(ALL);
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const todos = `state todos=[{text: "Pack water", done: false}, {text: "Charge headlamp", done: true}, {text: "Snacks", done: false}]`;

describe("paths", () => {
  const root = toData({ a: [{ b: 1, c: 2 }, { b: 3 }], d: "x" });

  it("finds where a path points", () => {
    expect(placeOf("todos", stateLocate)).toEqual({ key: "todos", steps: [] });
    expect(placeOf("settings.theme.mode", stateLocate)).toEqual({ key: "settings", steps: ["theme", "mode"] });
    expect(placeOf("a b", stateLocate)).toBeNull();
    expect(placeOf("a[0]", stateLocate)).toBeNull();
  });

  it("builds a new root and leaves the old one alone", () => {
    const r = setIn(root, ["a", 0, "b"], 9);
    expect("value" in r && json(r.value)).toEqual({ a: [{ b: 9, c: 2 }, { b: 3 }], d: "x" });
    expect(json(root)).toEqual({ a: [{ b: 1, c: 2 }, { b: 3 }], d: "x" });
    // Untouched parts are shared, not copied.
    expect("value" in r && getIn(r.value, ["a", 1])).toBe(getIn(root, ["a", 1]));
  });

  it("keeps field order and can add a field", () => {
    const r = setIn(root, ["a", 1, "e"], true);
    expect("value" in r && Object.keys(getIn(r.value, ["a", 1]) as object)).toEqual(["b", "e"]);
    const s = setIn(root, ["a", 0, "b"], 0);
    expect("value" in s && Object.keys(getIn(s.value, ["a", 0]) as object)).toEqual(["b", "c"]);
  });

  it("explains paths that don't lead anywhere", () => {
    expect(setIn(root, ["a", 5, "b"], 1)).toEqual({ error: "there's no item 5" });
    expect(setIn(root, ["x", "y"], 1)).toEqual({ error: `there's no field "x"` });
    expect(setIn(root, ["d", "y"], 1)).toEqual({ error: `there's no record to hold "y"` });
    expect(setIn(makeRecord([]), ["__proto__"], 1)).toEqual({ error: `"__proto__" can't be written` });
    expect(setIn(makeList([]), ["constructor"], 1)).toEqual({ error: `"constructor" can't be written` });
  });
});

describe("bind= inside each, for every component that binds", () => {
  /** [component, line inside each, field, start value, how to act on the first copy] */
  const cases: Array<[string, string, string, Value, "press" | "last" | "key" | "country"]> = [
    ["check", `check "{r.name}" bind=r.v`, "v", false, "press"],
    ["switch", `switch "{r.name}" bind=r.v`, "v", false, "press"],
    ["radio", `radio "Small" value=S bind=r.v`, "v", "M", "press"],
    ["stepper", `stepper bind=r.v min=0 max=9`, "v", 2, "last"],
    ["slider", `slider bind=r.v min=0 max=100`, "v", 50, "key"],
    ["rating", `rating bind=r.v`, "v", 2, "last"],
    ["tabs", `tabs bind=r.v\n      tab "A" value=A\n        text "a"\n      tab "B" value=B\n        text "b"`, "v", "A", "last"],
    ["accordion", `accordion "{r.name}" bind=r.v\n      text "Inside"`, "v", false, "press"],
    ["breadcrumb", `breadcrumb "Shop / Shoes / Socks" bind=r.v`, "v", "Socks", "press"],
    ["pagination", `pagination bind=r.v pages=3`, "v", 1, "last"],
    ["map", `map bind=r.v`, "v", "", "country"],
  ];

  it("covers all of them", () => {
    const binders = ALL.filter((c) => c.props.bind).map((c) => c.type).sort();
    expect(cases.map(([t]) => t).sort()).toEqual(binders);
  });

  const act = (ui: Rendered, id: string, how: (typeof cases)[number][4]) => {
    const regions = ui.hits.filter((h) => h.box.node.id === id);
    expect(regions.length, `${id} should be pressable`).toBeGreaterThan(0);
    const region = how === "last" ? regions.at(-1)! : regions[0]!;
    const target = { node: region.box.node, box: region.box, detail: how === "country" ? "Japan" : region.detail };
    if (how === "key") {
      ui.loom.focus = target;
      ui.key("ArrowRight");
    } else {
      ui.loom.activate(target);
      ui.loom.renderNow();
    }
  };

  for (const [type, line, field, start, how] of cases) {
    it(`${type}: changes only its own item`, () => {
      const rows = JSON.stringify([{ name: "One", [field]: start }, { name: "Two", [field]: start }]).replace(/"(\w+)":/g, "$1: ");
      const ui = render(`state rows=${rows}\neach items=rows as=r\n  column\n    ${line}\n`, { components: ALL });
      expect(ui.diagnostics).toEqual([]);
      const first = ui.findAll(type)[0]!.node.id;
      expect(first).toMatch(/#0$/);
      act(ui, first, how);
      const after = json(ui.state.rows) as Array<Record<string, Value>>;
      expect(after[0]![field], "the first item changed").not.toEqual(start);
      expect(after[1]![field], "the second item didn't").toEqual(start);
      expect(after.map((r) => r.name)).toEqual(["One", "Two"]);
    });
  }

  it("shows each item's own value", () => {
    const ui = render(`state rows=[{n: 1}, {n: 7}]
each items=rows as=r
  stepper bind=r.n
`);
    expect(ui.text().filter((t) => /^\d$/.test(t))).toEqual(["1", "7"]);
  });

  it("still binds plain state names, and record fields outside each", () => {
    const ui = render(`state on=false settings={theme: "light", sound: false}
check "Plain" bind=on
switch "Sound" bind=settings.sound
`);
    ui.press("check");
    ui.press("switch");
    expect(ui.state.on).toBe(true);
    expect(json(ui.state.settings)).toEqual({ theme: "light", sound: true });
  });
});

describe("actions on items", () => {
  it("toggles, sets, increments and decrements fields of the current item", () => {
    const ui = render(`state cart=[{name: "Socks", qty: 2, gift: false}, {name: "Shell", qty: 1, gift: false}]
each items=cart as=c
  row
    button "More {c.name}" on=inc:c.qty
    button "Fewer {c.name}" on="dec:c.qty:5"
    button "Gift {c.name}" on=toggle:c.gift
    button "Rename {c.name}" on="set:c.name:{c.name + '!'}"
`);
    ui.press({ type: "button", text: "More Socks" });
    ui.press({ type: "button", text: "Fewer Shell" });
    ui.press({ type: "button", text: "Gift Shell" });
    ui.press({ type: "button", text: "Rename Socks" });
    expect(json(ui.state.cart)).toEqual([{ name: "Socks!", qty: 3, gift: false }, { name: "Shell", qty: 0, gift: true }]);
  });

  it("replaces a whole item with set:t", () => {
    const ui = render(`state xs=["a", "b"]
each items=xs as=x
  button "{x}" on="set:x:{x + x}"
`);
    ui.press({ type: "button", text: "b" });
    expect(ui.state.xs).toEqual(["a", "bb"]);
  });

  it("adds, removes and clears", () => {
    const ui = render(`${todos}
each items=todos as=t index=i
  row
    text "{t.text}"
    button "Remove {t.text}" on=remove:t
button "Add" on="add:todos:{text: 'Map', done: false}"
button "Drop first" on="remove:todos:0"
button "Clear" on=clear:todos
`);
    ui.press({ type: "button", text: "Remove Charge headlamp" });
    expect(json(ui.state.todos).map((t: { text: string }) => t.text)).toEqual(["Pack water", "Snacks"]);
    ui.press({ type: "button", text: "Add" });
    expect(json(ui.state.todos).at(-1)).toEqual({ text: "Map", done: false });
    ui.press({ type: "button", text: "Drop first" });
    expect(json(ui.state.todos).map((t: { text: string }) => t.text)).toEqual(["Snacks", "Map"]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Snacks", "Map"]));
    ui.press({ type: "button", text: "Clear" });
    expect(ui.state.todos).toEqual([]);
    expect(ui.warnings).toEqual([]);
  });

  it("adds to a list that doesn't exist yet", () => {
    const ui = render(`button "Add" on="add:notes:'first';add:notes:'second'"\n`);
    ui.press("button");
    expect(ui.state.notes).toEqual(["first", "second"]);
  });

  it("works in nested lists", () => {
    const ui = render(`state days=[{title: "Fri", acts: ["Hike", "Swim"]}, {title: "Sat", acts: ["Drive"]}]
each items=days as=d
  text "{d.title}"
  each items=d.acts as=a
    button "Drop {a}" on=remove:a
  button "Add to {d.title}" on="add:d.acts:'Nap'"
`);
    ui.press({ type: "button", text: "Drop Swim" });
    ui.press({ type: "button", text: "Add to Sat" });
    expect(json(ui.state.days)).toEqual([{ title: "Fri", acts: ["Hike"] }, { title: "Sat", acts: ["Drive", "Nap"] }]);
  });

  it("removes the right item after the list changed under it", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.text}
  button "Remove {t.text}" on=remove:t
`);
    ui.set("todos", toData([{ text: "New" }, ...(json(ui.state.todos) as object[])]));
    ui.press({ type: "button", text: "Remove Snacks" });
    expect(json(ui.state.todos).map((t: { text: string }) => t.text)).toEqual(["New", "Pack water", "Charge headlamp"]);
  });
});

describe("change events", () => {
  it("report the whole list, as a new value each time", () => {
    const ui = render(`${todos}
each items=todos as=t
  check "{t.text}" bind=t.done
`);
    const changes: Array<{ key: string; value: Value }> = [];
    ui.loom.on("change", (e) => changes.push(e));
    const before = ui.state.todos;
    ui.press({ type: "check", text: "Snacks" });
    expect(changes.map((c) => c.key)).toEqual(["todos"]);
    expect(changes[0]!.value).not.toBe(before);
    expect(json(changes[0]!.value)[2]).toEqual({ text: "Snacks", done: true });
    expect(Object.isFrozen(changes[0]!.value)).toBe(true);
  });
});

describe("writes that can't happen", () => {
  it("explains writing to an item of a computed list", () => {
    const ui = render(`state xs=[{on: false}]
each items={[{on: false}]} as=x
  check "x" bind=x.on
`);
    ui.press("check");
    expect(ui.warnings[0]).toMatch(/Can't change x.on: it isn't in state. Inside each, items= must name a list in state/);
  });

  it("won't write to an index, or remove something that isn't an item", () => {
    const ui = render(`state xs=[1] n=1
each items=xs index=i
  button "a" on=set:i:3
button "b" on=remove:n
`);
    ui.press({ type: "button", text: "a" });
    ui.press({ type: "button", text: "b" });
    expect(ui.state.n).toBe(1);
    expect(ui.warnings).toHaveLength(2);
    expect(ui.warnings[1]).toMatch(/remove:n needs n to be an item of a list in state/);
  });

  it("explains add on something that isn't a list, and ignores a position that isn't there", () => {
    const ui = render(`state n=1 xs=[1]
button "a" on="add:n:2;remove:xs:5;remove:xs:{'x'}"
`);
    ui.press("button");
    expect(ui.state.n).toBe(1);
    expect(ui.state.xs).toEqual([1]);
    expect(ui.warnings).toEqual(["add:n needs a list, but n isn't one"]);
  });

  it("never writes to prototypes", () => {
    const ui = render(`state xs=[{a: 1}]
each items=xs as=x
  button "p" on="set:x.__proto__:{{polluted: 1}};set:x.constructor:1;add:x.prototype:1"
`);
    ui.press("button");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(json(ui.state.xs)).toEqual([{ a: 1 }]);
  });
});

describe("parsing", () => {
  const diags = (spec: string) => parse(spec, registry).diagnostics;

  it("accepts paths in bind= and action targets", () => {
    expect(diags(`${todos}
each items=todos as=t
  check "{t.text}" bind=t.done
  button "x" on="toggle:t.done;inc:t.n;remove:t;add:todos:{t};clear:todos"
`)).toEqual([]);
  });

  it("explains targets that aren't names or paths", () => {
    expect(diags(`check "x" bind=a[0]\n`)[0]!.message).toBe(`bind should be a state name or a path like t.done, got "a[0]"`);
    expect(parseActions("toggle:t..done")).toEqual({ error: `"t..done" is not a valid state name or path, like count or t.done, in action "toggle:t..done"` });
    expect(parseActions("emit:a.b")).toEqual({ error: `"a.b" is not a valid name in action "emit:a.b"` });
    expect(parseActions("add:todos")).toEqual({ error: `add needs a value, like add:todos:{text: 'New', done: false}` });
    expect(parseActions("clear:todos:1")).toEqual({ error: `clear takes just the list, like clear:todos` });
  });

  it("warns when bind= or an action uses a loop variable outside its each", () => {
    expect(diags(`${todos}
each items=todos as=t
  text "{t.text}"
check "x" bind=t.done
button "y" on=remove:t
`).map((d) => d.line)).toEqual([4, 5]);
  });
});
