/**
 * `each` (lists and data, step 3): repeating elements once per item, with
 * each copy reading its own item.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { MAX_EACH_ELEMENTS, MAX_EACH_ITEMS } from "../src/each";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry([...coreComponents, ...mapComponents]);
const diags = (spec: string) => parse(spec, registry).diagnostics;
const todos = `state todos=[{id: 1, text: "Pack water", done: false}, {id: 2, text: "Charge headlamp", done: true}, {id: 3, text: "Snacks", done: false}]`;
const data = (v: unknown) => v as Value;

describe("repeating", () => {
  it("repeats its children once per item, in order, reading each item", () => {
    const ui = render(`${todos}
card
  text "Before"
  each items=todos as=t
    text "{t.text}"
    text "{t.done ? 'packed' : 'to pack'}" tone=muted
  text "After"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["Before", "Pack water", "to pack", "Charge headlamp", "packed", "Snacks", "to pack", "After"]);
  });

  it("calls the item `item` by default and gives the position with index=", () => {
    const ui = render(`state tags=["wool", "trail"]
each items={tags} index=n
  text "{n + 1}: {item}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["1: wool", "2: trail"]);
  });

  it("lets loop variables hide state of the same name, only inside the each", () => {
    const ui = render(`state t="outside" items=[1, 2]
each items=items as=t
  text "in {t}"
text "out {t}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["in 1", "in 2", "out outside"]);
  });

  it("shows nothing for an empty list, a missing one or null, without warnings", () => {
    const ui = render(`state empty=[] none=null
each items=empty
  text "x"
each items=none
  text "y"
each items=missing
  text "z"
text "end"
`);
    expect(ui.text()).toEqual(["end"]);
    expect(ui.warnings).toEqual([]);
  });

  it("warns once when items isn't a list", () => {
    const ui = render(`state n=3
each items=n
  text "x"
`);
    expect(ui.text()).toEqual([]);
    ui.set("n", 4);
    expect(ui.warnings).toEqual(["each on line 2: items is a number, not a list, so nothing was repeated"]);
  });

  it("follows the list when it changes", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.id}
  text "{t.text}"
button "Clear" on="set:todos:{[]}"
button "One" on="set:todos:{[{id: 9, text: 'Map'}]}"
`);
    expect(ui.text()).toHaveLength(5);
    ui.press({ type: "button", text: "One" });
    expect(ui.text()).toEqual(["Map", "Clear", "One"]);
    ui.press({ type: "button", text: "Clear" });
    expect(ui.text()).toEqual(["Clear", "One"]);
    ui.set("todos", data([{ id: 1, text: "From the host" }]));
    expect(ui.text()[0]).toBe("From the host");
  });

  it("works in every kind of container", () => {
    const ui = render(`state xs=[{n: "A"}, {n: "B"}, {n: "C"}] tab="A"
row
  each items=xs as=x
    stat label="{x.n}" value=1
grid
  each items=xs as=x
    badge "{x.n}"
list
  each items=xs as=x
    list-item "Item {x.n}"
tabs bind=tab
  each items=xs as=x
    tab "{x.n}" value={x.n}
      text "Panel {x.n}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.findAll("stat").filter((f) => f.box)).toHaveLength(3);
    expect(ui.findAll("badge").filter((f) => f.box)).toHaveLength(3);
    expect(ui.findAll("list-item").filter((f) => f.box)).toHaveLength(3);
    expect(ui.text()).toContain("Panel A");
    ui.press({ type: "tabs" });
    // Row children split the width equally, so three stats sit side by side.
    const xs = ui.findAll("stat").map((f) => f.box!.x);
    expect(new Set(xs).size).toBe(3);
  });

  it("puts map pins from a list on the map", () => {
    const ui = render(`state places=[{name: "Tokyo", lat: 35.68, lon: 139.69}, {name: "Nairobi", lat: -1.29, lon: 36.82}]
map
  each items=places as=p
    pin "{p.name}" lat={p.lat} lon={p.lon}
`, { components: [...coreComponents, ...mapComponents] });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Tokyo", "Nairobi"]));
  });
});

describe("nesting and conditions", () => {
  it("nests, with inner items seeing outer ones", () => {
    const ui = render(`state groups=[{name: "Shelter", items: ["Tent", "Pad"]}, {name: "Kitchen", items: ["Stove"]}]
each items=groups as=g index=gi
  text "{g.name}" weight=semibold
  each items={g.items} as=it index=ii
    text "{gi}.{ii} {it} ({g.name})"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["Shelter", "0.0 Tent (Shelter)", "0.1 Pad (Shelter)", "Kitchen", "1.0 Stove (Kitchen)"]);
  });

  it("allows an each directly inside an each", () => {
    const ui = render(`state rows=[[1, 2], [3]]
each items=rows as=r
  each items=r as=c
    text "{c}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["1", "2", "3"]);
  });

  it("hides copies with if= on their item, and the whole each with if=", () => {
    const ui = render(`${todos} show=true
each items=todos as=t if=show
  text "{t.text}" if={!t.done}
button "Hide" on=toggle:show
`);
    expect(ui.text()).toEqual(["Pack water", "Snacks", "Hide"]);
    ui.press("button");
    expect(ui.text()).toEqual(["Hide"]);
    expect(ui.findAll("text")).toEqual([]);
  });
});

describe("keys and identity", () => {
  it("gives copies ids from their key, or their position", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.id}
  text "{t.text}"
each items=todos as=t
  badge "{t.id}"
`);
    expect(ui.findAll("text").map((f) => f.node.id)).toEqual(["3:text#1", "3:text#2", "3:text#3"]);
    expect(ui.findAll("badge").map((f) => f.node.id)).toEqual(["5:badge#0", "5:badge#1", "5:badge#2"]);
  });

  it("keeps nested ids apart", () => {
    const ui = render(`state g=[{k: "a", xs: [1, 2]}, {k: "b", xs: [1]}]
each items=g as=o key={o.k}
  each items={o.xs} as=x key={x}
    text "{x}"
`);
    expect(ui.findAll("text").map((f) => f.node.id)).toEqual(["4:text#a#1", "4:text#a#2", "4:text#b#1"]);
  });

  it("warns about repeated keys and still shows every item", () => {
    const ui = render(`state xs=[{id: 1}, {id: 1}]
each items=xs as=x key={x.id}
  text "{x.id}"
`);
    expect(ui.text()).toEqual(["1", "1"]);
    expect(new Set(ui.findAll("text").map((f) => f.node.id)).size).toBe(2);
    expect(ui.warnings).toEqual([`each on line 2: key "1" is used by more than one item. Keys should be unique, like key={x.id}`]);
  });

  it("keeps keyboard focus on the same item when the list changes", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.id}
  button "{t.text}" on="emit:pick:{t.id}"
`);
    ui.tab();
    ui.tab();
    expect(ui.focused?.id).toBe("3:button#2");
    ui.set("todos", data([{ id: 0, text: "New first" }, { id: 1, text: "Pack water" }, { id: 2, text: "Charge headlamp" }]));
    expect(ui.focused?.id).toBe("3:button#2");
    ui.key("Enter");
    expect(ui.emitted).toEqual([{ name: "pick", value: 2 }]);
  });

  it("drops focus when its item goes away", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.id}
  button "{t.text}"
`);
    ui.tab();
    expect(ui.focused?.id).toBe("3:button#1");
    ui.set("todos", data([{ id: 2, text: "Charge headlamp" }]));
    expect(ui.focused).toBeNull();
  });

  it("reaches every copy with Tab", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.id}
  button "{t.text}"
`);
    const reached: string[] = [];
    for (let i = 0; i < 3; i++) { ui.tab(); reached.push(ui.focused!.id); }
    expect(reached).toEqual(["3:button#1", "3:button#2", "3:button#3"]);
  });
});

describe("actions inside each", () => {
  it("read the item in arguments and messages", () => {
    const ui = render(`${todos} picked=""
each items=todos as=t index=i key={t.id}
  button "{t.text}" on="set:picked:{t.text};emit:pick:{t.id};notify:'Picked {t.text} (#{i + 1})'"
text "Picked: {picked}"
`);
    ui.press({ type: "button", text: "Snacks" });
    expect(ui.state.picked).toBe("Snacks");
    expect(ui.emitted).toEqual([{ name: "pick", value: 3 }]);
    expect(ui.text()).toContain("Picked: Snacks");
    expect(ui.text()).toContain("Picked Snacks (#3)");
  });

  it("make pressable cards per item", () => {
    const ui = render(`${todos}
each items=todos as=t key={t.id}
  card on="emit:open:{t.id}"
    text "{t.text}"
`);
    expect(ui.findAll("card").map((f) => f.node.id)).toEqual(["3:card#1", "3:card#2", "3:card#3"]);
    ui.press({ id: "3:card#2" });
    expect(ui.emitted).toEqual([{ name: "open", value: 2 }]);
  });
});

describe("the limit", () => {
  it(`shows at most ${MAX_EACH_ITEMS} items, with a warning`, () => {
    const ui = render(`each items=big
  text "{item}"
`);
    ui.set("big", data(Array.from({ length: 1200 }, (_, i) => i)));
    expect(ui.text()).toHaveLength(MAX_EACH_ITEMS);
    expect(ui.text().at(-1)).toBe(String(MAX_EACH_ITEMS - 1));
    expect(ui.warnings).toEqual([`each on line 1: showing the first ${MAX_EACH_ITEMS} of 1200 items`]);
  });

  it(`copies at most ${MAX_EACH_ELEMENTS} elements per layout, however lists nest`, () => {
    const ui = render(`each items=big as=a
  each items=big as=b
    each items=big as=c
      text "{a}{b}{c}"
`);
    const t = performance.now();
    ui.set("big", data(Array.from({ length: 500 }, (_, i) => i)));
    expect(performance.now() - t).toBeLessThan(5000);
    // The budget counts every copy, the inner each lines included.
    expect(ui.text().length).toBeGreaterThan(MAX_EACH_ELEMENTS / 2);
    expect(ui.text().length).toBeLessThanOrEqual(MAX_EACH_ELEMENTS);
    expect(ui.warnings.some((w) => w.includes(`more than ${MAX_EACH_ELEMENTS} elements`))).toBe(true);
  });
});

describe("parsing", () => {
  it("checks what's inside an each against the container around it", () => {
    expect(diags(`state xs=[1]
tabs bind=t
  each items=xs
    tab "{item}" value={item}
`)).toEqual([]);
    expect(diags(`state xs=[1]
tabs bind=t
  each items=xs
    text "{item}"
`)).toEqual([{ line: 4, severity: "error", message: `"tabs" (line 2) can't contain "text"` }]);
    expect(diags(`state xs=[1]
list
  each items=xs
    each items=xs
      button "x"
`)).toEqual([{ line: 5, severity: "error", message: `"list" (line 2) can't contain "button"` }]);
    expect(diags(`state xs=[1]
column
  each items=xs
    tab "x" value=1
`)).toEqual([{ line: 4, severity: "error", message: `"tab" only goes inside tabs` }]);
  });

  it("can't go inside something that holds nothing", () => {
    expect(diags(`text "a"
  each items=xs
`)[0]!.message).toMatch(/can't contain anything/);
  });

  it("explains a list spread over several lines once, not on every line", () => {
    const d = diags(`state trails=[
  {name: "A"},
  {name: "B"}
]
card
  text "Trails"
`);
    expect(d.map((x) => x.line)).toEqual([1, 2]);
    expect(d[1]!.message).toMatch(/more of the state value on line 1.*Write the whole value on line 1/);
  });

  it("needs items=", () => {
    expect(diags(`each\n  text "x"\n`)).toEqual([{ line: 1, severity: "warning", message: `"each" needs items=` }]);
  });

  it("warns when a loop variable is used outside its each", () => {
    expect(diags(`${todos}
each items=todos as=t
  text "{t.text}"
text "Last: {t.text}"
button "x" on="emit:pick:{t.id}" disabled={t.done}
`)).toEqual([
      { line: 4, severity: "warning", message: `"t" only exists inside the each on line 2 (as=t). Indent this line under it, or use a state name` },
      { line: 5, severity: "warning", message: `"t" only exists inside the each on line 2 (as=t). Indent this line under it, or use a state name` },
    ]);
    expect(diags(`state xs=[1]
each items=xs index=i
  text "{item}"
text "{item} {i}"
`).map((d) => d.message)).toEqual([
      `"item" only exists inside the each on line 2 (as=item, the default). Indent this line under it, or use a state name`,
      `"i" only exists inside the each on line 2 (index=i). Indent this line under it, or use a state name`,
    ]);
  });

  it("doesn't warn when state has the loop variable's name, or in an each's own items", () => {
    expect(diags(`state t=1 xs=[1]
each items=xs as=t
  text "{t}"
text "{t}"
`)).toEqual([]);
    expect(diags(`state xs=[[1]]
each items=xs as=x
  each items=x as=y
    text "{y} {x}"
`)).toEqual([]);
  });

  it("warns when as= and index= are the same", () => {
    expect(diags(`state xs=[1]\neach items=xs as=a index=a\n  text "{a}"\n`)[0]!.message).toBe(`each uses "a" for both as= and index=; give them different names`);
  });

  it("parses every prefix of a spec with each into a smaller valid tree", () => {
    const spec = `${todos}
card
  each items=todos as=t key={t.id}
    row
      check "{t.text}" bind=done
      badge "{t.id}"
  text "{count(todos, 'done')} done"
`;
    const lines = spec.split("\n");
    for (let n = 0; n <= lines.length; n++) {
      const prefix = lines.slice(0, n).join("\n") + "\n";
      const ui = render(prefix);
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
  });
});

describe("the sandbox", () => {
  it("treats odd loop variable names as plain names", () => {
    const ui = render(`state xs=[{a: 1}]
each items=xs as=constructor index=__proto__
  text "{constructor.a} {__proto__}"
`);
    expect(ui.text()).toEqual(["1 0"]);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it("can't reach anything through items or key", () => {
    for (const items of ["xs.constructor", "xs['__proto__']", "len.constructor", "{}"]) {
      const ui = render(`state xs=[1]\neach items={${items}} key={item.constructor}\n  text "x"\n`);
      expect(ui.text(), items).toEqual([]);
    }
  });
});
