import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { MAX_SELECT_OPTIONS, optionKey, selectOptions, VISIBLE_OPTIONS } from "../src/components/select";
import { toData } from "../src/data";
import { parse } from "../src/parser";
import { placePopup, POPUP_GAP } from "../src/popup";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const depts = `state departments=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}, {id: "legal", name: "Legal", closed: true}, {id: "design", name: "Design"}] department=""`;
const basic = `${depts}\nselect "Department" items=departments value=id label=name unavailable=closed bind=department placeholder="Choose a department" on="emit:picked:{department}"\nbutton "Below" on=inc:clicks\n`;
const many = (n: number) => `[${Array.from({ length: n }, (_, i) => `{id: ${i}, name: "Option ${i}"}`).join(", ")}]`;

/** Press an option or strip in the open popup, through the pointer. */
const pressPopup = (ui: Rendered, detail: string) => {
  const r = ui.popup?.regions.find((h) => h.detail === detail);
  expect(r, `the popup has ${detail}`).toBeDefined();
  ui.click(r!.box.x + r!.box.w / 2, r!.box.y + r!.box.h / 2);
};
const shownOptions = (ui: Rendered) => ui.popup!.regions.map((r) => String(r.detail)).filter((d) => d.startsWith("opt:"));

describe("placing a popup", () => {
  const anchor = { x: 20, y: 100, w: 300, h: 42 };
  const size = { w: 300, h: 200, minH: 120 };

  it("goes below when it fits there", () => {
    const p = placePopup(anchor, size, { top: 0, bottom: 1000 }, 400);
    expect(p).toMatchObject({ side: "below", x: 20, w: 300, h: 200, y: 142 + POPUP_GAP });
  });

  it("goes above when only that fits", () => {
    const p = placePopup({ ...anchor, y: 500 }, size, { top: 0, bottom: 600 }, 400);
    expect(p.side).toBe("above");
    expect(p.y + p.h).toBe(500 - POPUP_GAP);
  });

  it("shrinks to the roomier side, in whole rows, never below its least", () => {
    const p = placePopup({ ...anchor, y: 150 }, { ...size, h: 400, snap: { base: 8, step: 40 } }, { top: 0, bottom: 380 }, 400);
    expect(p.side).toBe("below");
    expect((p.h - 8) % 40).toBe(0);
    expect(p.h).toBeLessThanOrEqual(380 - 192 - POPUP_GAP);
    const tight = placePopup({ ...anchor, y: 10 }, size, { top: 0, bottom: 80 }, 400);
    expect(tight.h).toBe(120);
  });

  it("never goes above the canvas, even when the window is scrolled past it", () => {
    const p = placePopup({ ...anchor, y: 60 }, size, { top: 0, bottom: 120 }, 400);
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThan(0);
  });

  it("stays inside the canvas width", () => {
    const p = placePopup({ x: 300, y: 0, w: 80, h: 40 }, { w: 180, h: 100, minH: 100 }, { top: 0, bottom: 999 }, 400);
    expect(p.w).toBe(180);
    expect(p.x + p.w).toBe(400);
    expect(placePopup(anchor, { w: 900, h: 50, minH: 50 }, { top: 0, bottom: 999 }, 400).w).toBe(400);
  });
});

describe("select specs and options", () => {
  it("parses its example and explains bad props", () => {
    expect(parse(basic, registry).diagnostics).toEqual([]);
    const msgs = (spec: string) => parse(`${depts}\n${spec}\n`, registry).diagnostics.map((d) => d.message);
    expect(msgs(`select items=departments value=id`)).toEqual([`"select" needs bind=`]);
    expect(msgs(`select bind=department`)).toEqual([`"select" needs items=`]);
    expect(msgs(`select items=departments bind=department value="the id"`)[0]).toMatch(/value should be a plain name/);
    expect(msgs(`select items=departments bind=department multiple=true`)[0]).toMatch(/"select" has no prop "multiple"/);
  });

  it("reads records, text and numbers, keeping 0 and telling 0 from \"0\"", () => {
    const o = selectOptions(toData([{ id: 0, name: "Zero" }, { id: "0", name: "Text zero" }, { id: 2.5 }]), "id", "name", "");
    expect(o.options.map((x) => [x.value, x.label, x.key])).toEqual([[0, "Zero", "n:0"], ["0", "Text zero", "s:0"], [2.5, "2.5", "n:2.5"]]);
    const plain = selectOptions(toData(["Open", "Closed", 3]), "", "", "");
    expect(plain.options.map((x) => [x.value, x.label])).toEqual([["Open", "Open"], ["Closed", "Closed"], [3, "3"]]);
  });

  it("leaves out items with no usable value and repeats of an earlier one", () => {
    const o = selectOptions(toData([{ id: "a" }, { name: "no id" }, { id: "a" }, { id: true }, { id: null }, "b", ["x"]]), "id", "", "");
    expect(o.options.map((x) => x.value)).toEqual(["a", "b"]);
    expect(o).toMatchObject({ missing: 4, duplicates: 1 });
    const ui = render(`state xs=[{id: "a"}, {id: "a"}, {name: "none"}] x=""\nselect items=xs value=id bind=x\n`);
    expect(ui.warnings).toEqual([
      `select on line 2: 1 items have no text or number in "id", so they aren't offered`,
      `select on line 2: 1 items repeat an earlier option's value, so only the first is offered. Values should be unique`,
    ]);
  });

  it("marks options unavailable only when their field is true", () => {
    const o = selectOptions(toData([{ id: 1, off: true }, { id: 2, off: "yes" }, { id: 3, off: false }, { id: 4 }]), "id", "", "off");
    expect(o.options.map((x) => x.available)).toEqual([false, true, true, true]);
  });

  it("shows the chosen label, the placeholder, or why it can't open", () => {
    const text = (spec: string) => render(spec).text();
    expect(text(basic)).toContain("Choose a department");
    expect(text(basic.replace('department=""', 'department="sales"'))).toContain("Sales");
    expect(text(`state xs=[] x=""\nselect items=xs bind=x\n`)).toContain("No options");
    expect(text(`state n=3 x=""\nselect items=n bind=x\n`)).toContain("No options");
    const big = render(`state xs=${many(MAX_SELECT_OPTIONS + 1)} x=""\nselect items=xs value=id label=name bind=x\n`);
    expect(big.text()).toContain("Too many options");
    expect(big.hits).toEqual([]);
    expect(big.warnings[0]).toMatch(/201 options is more than the 200 a select offers. Narrow the list with filter\(\) or search\(\)/);
    expect(render(`state xs=${many(MAX_SELECT_OPTIONS)} x=""\nselect items=xs value=id label=name bind=x\n`).hits).toHaveLength(1);
  });

  it("shows the placeholder for a value no option has, and says so unless it's empty", () => {
    const ui = render(basic.replace('department=""', 'department="marketing"'));
    expect(ui.text()).toContain("Choose a department");
    expect(ui.warnings).toEqual([`select on line 2: bind= holds "marketing", which none of its options has, so it shows the placeholder`]);
    expect(ui.state.department).toBe("marketing");
    expect(render(basic).warnings).toEqual([]);
  });

  it("cuts a long label to fit the field", () => {
    const ui = render(`state xs=["A very long option label that will never fit in a narrow field"] x="A very long option label that will never fit in a narrow field"\nselect items=xs bind=x\n`, { width: 240 });
    const shown = ui.text().find((t) => t.startsWith("A very"))!;
    expect(shown.endsWith("…")).toBe(true);
  });
});

describe("choosing with the pointer", () => {
  it("opens below the field, chooses, closes, restores focus and then runs on=", () => {
    const ui = render(basic);
    ui.press("select");
    const field = ui.hits.find((h) => h.box.node.type === "select")!.box;
    expect(ui.popup?.owner.type).toBe("select");
    expect(ui.popup!.area!.y).toBeGreaterThan(field.y + field.h);
    // Unavailable Legal has no region; the others do.
    expect(shownOptions(ui)).toEqual(["opt:s:eng", "opt:s:sales", "opt:s:design"]);
    pressPopup(ui, "opt:s:sales");
    expect(ui.state.department).toBe("sales");
    expect(ui.popup).toBeNull();
    expect(ui.focused?.type).toBe("select");
    expect(ui.emitted).toEqual([{ name: "picked", value: "sales" }]);
    expect(ui.text()).toContain("Sales");
  });

  it("stores a number value, 0 included", () => {
    const ui = render(`state xs=[{id: 0, name: "Zero"}, {id: "0", name: "Text"}] x=-1\nselect items=xs value=id label=name bind=x\n`);
    ui.press("select");
    pressPopup(ui, "opt:n:0");
    expect(ui.state.x).toBe(0);
    ui.press("select");
    pressPopup(ui, "opt:s:0");
    expect(ui.state.x).toBe("0");
  });

  it("keeps clicks from reaching what's under the list", () => {
    // The button sits right under the select, so the open list covers it.
    const ui = render(basic);
    const button = ui.hits.find((h) => h.box.node.type === "button")!.box;
    ui.press("select");
    const a = ui.popup!.area!;
    expect(button.y).toBeGreaterThan(a.y);
    expect(button.y).toBeLessThan(a.y + a.h);
    ui.click(button.x + 10, button.y + button.h / 2);
    expect(ui.state.clicks).toBeUndefined();
    expect(ui.state.department).not.toBe("");
  });

  it("closes on a click outside without pressing what was clicked", () => {
    const ui = render(`${depts} clicks=0\nbutton "Above" on=inc:clicks\nselect items=departments value=id label=name bind=department\n`);
    const above = ui.hits.find((h) => h.box.node.type === "button")!.box;
    ui.press("select");
    expect(ui.popup).not.toBeNull();
    // Nothing underneath is hovered while it's open.
    ui.canvas.dispatch("pointermove", { clientX: above.x + 5, clientY: above.y + 5 });
    expect(ui.loom.hover).toBeNull();
    ui.click(above.x + 5, above.y + 5);
    expect(ui.popup).toBeNull();
    expect(ui.state.clicks).toBe(0);
    expect(ui.focused?.type).toBe("select");
    ui.click(above.x + 5, above.y + 5);
    expect(ui.state.clicks).toBe(1);
  });

  it("closes when the canvas loses focus to something else on the page", () => {
    const ui = render(basic);
    ui.press("select");
    ui.canvas.dispatch("blur");
    expect(ui.popup).toBeNull();
    expect(ui.state.department).toBe("");
  });

  it("closes when its own field is pressed again", () => {
    const ui = render(basic);
    ui.press("select");
    const field = ui.hits.find((h) => h.box.node.type === "select")!.box;
    ui.click(field.x + 10, field.y + 10);
    expect(ui.popup).toBeNull();
    expect(ui.state.department).toBe("");
  });

  it("ignores presses on unavailable options and stays open", () => {
    const ui = render(basic);
    ui.press("select");
    const a = ui.popup!.area!;
    const sales = ui.popup!.regions.find((r) => r.detail === "opt:s:sales")!.box;
    // Legal is the row after Sales.
    ui.click(a.x + 20, sales.y + sales.h * 1.5);
    expect(ui.popup).not.toBeNull();
    expect(ui.state.department).toBe("");
  });
});

describe("the keyboard", () => {
  it("opens with arrows, starts on the chosen option, skips unavailable ones and chooses with Enter", () => {
    const ui = render(basic.replace('department=""', 'department="sales"'));
    ui.tab();
    expect(ui.focused?.type).toBe("select");
    ui.key("ArrowDown");
    expect(ui.popup?.state.highlight).toBe("s:sales");
    ui.key("ArrowDown");
    expect(ui.popup?.state.highlight).toBe("s:design");
    ui.key("ArrowUp");
    expect(ui.popup?.state.highlight).toBe("s:sales");
    ui.key("Home");
    expect(ui.popup?.state.highlight).toBe("s:eng");
    ui.key("End");
    expect(ui.popup?.state.highlight).toBe("s:design");
    ui.key("ArrowDown");
    expect(ui.popup?.state.highlight).toBe("s:design");
    ui.key("Enter");
    expect(ui.state.department).toBe("design");
    expect(ui.popup).toBeNull();
    expect(ui.focused?.type).toBe("select");
  });

  it("opens with Enter and chooses with Space", () => {
    const ui = render(basic);
    ui.tab();
    ui.key("Enter");
    expect(ui.popup?.state.highlight).toBe("s:eng");
    ui.key(" ");
    expect(ui.state.department).toBe("eng");
  });

  it("closes with Escape, changing nothing and keeping focus", () => {
    const ui = render(basic);
    ui.tab();
    ui.key("ArrowDown");
    ui.key("ArrowDown");
    ui.key("Escape");
    expect(ui.popup).toBeNull();
    expect(ui.state.department).toBe("");
    expect(ui.focused?.type).toBe("select");
    // The highlight wasn't kept anywhere: opening again starts afresh.
    ui.key("ArrowDown");
    expect(ui.popup?.state.highlight).toBe("s:eng");
  });

  it("closes with Tab and moves on", () => {
    const ui = render(basic);
    ui.tab();
    ui.key("ArrowDown");
    ui.tab();
    expect(ui.popup).toBeNull();
    expect(ui.focused?.type).toBe("button");
    expect(ui.state.department).toBe("");
  });

  it("keeps keys from reaching anything else while open", () => {
    const ui = render(`state v=5 xs=["a", "b"] x=""\nslider bind=v min=0 max=10\nselect items=xs bind=x\n`);
    ui.tab();
    ui.tab();
    ui.key("ArrowDown");
    ui.key("ArrowDown");
    expect(ui.state.v).toBe(5);
  });
});

describe("long lists", () => {
  const long = `state xs=${many(30)} x=3\nselect "Pick" items=xs value=id label=name bind=x\n`;

  it(`shows ${VISIBLE_OPTIONS} rows at a time, with the chosen one in view`, () => {
    const ui = render(long);
    ui.press("select");
    expect(shownOptions(ui)).toHaveLength(VISIBLE_OPTIONS);
    expect(shownOptions(ui)).toContain("opt:n:3");
    expect(ui.popup!.regions.map((r) => r.detail)).toContain("more:down");
  });

  it("reaches every option by keyboard, scrolling to keep the highlight in view", () => {
    const ui = render(long);
    ui.tab();
    ui.key("Home");
    ui.key("ArrowDown");
    ui.key("Home");
    for (let i = 0; i < 30; i++) {
      expect(shownOptions(ui), `option ${i} is shown`).toContain(`opt:n:${i}`);
      expect(ui.popup!.state.highlight).toBe(`n:${i}`);
      ui.key("ArrowDown");
    }
    ui.key("PageUp");
    expect(ui.popup!.state.highlight).toBe(`n:${29 - (VISIBLE_OPTIONS - 1)}`);
    ui.key("End");
    expect(shownOptions(ui)).toContain("opt:n:29");
  });

  it("scrolls with the strips and the wheel, so every option can be pressed", () => {
    const ui = render(long);
    ui.press("select");
    const seen = new Set(shownOptions(ui));
    for (let i = 0; i < 10 && ui.popup!.regions.some((r) => r.detail === "more:down"); i++) {
      pressPopup(ui, "more:down");
      shownOptions(ui).forEach((d) => seen.add(d));
    }
    expect(seen.size).toBe(30);
    expect(ui.popup!.regions.some((r) => r.detail === "more:down")).toBe(false);
    const a = ui.popup!.area!;
    ui.wheel(a.x + 20, a.y + 60, -400);
    expect(ui.popup!.state.scroll).toBe(30 - VISIBLE_OPTIONS - 10);
    expect(ui.popup).not.toBeNull();
  });
});

describe("placement on screen", () => {
  it("opens above the field near the bottom of the visible area", () => {
    const ui = render(`state xs=${many(6)} x=""\nspacer size=400\nselect items=xs value=id label=name bind=x\n`, { viewport: { top: 0, bottom: 500 } });
    ui.press("select");
    const field = ui.hits.find((h) => h.box.node.type === "select")!.box;
    const a = ui.popup!.area!;
    expect(a.y + a.h).toBeLessThanOrEqual(field.y);
    expect(a.y).toBeGreaterThanOrEqual(0);
  });

  it("makes the canvas taller while a list needs it, and gives it back", () => {
    const ui = render(`state xs=${many(6)} x=""\nselect items=xs value=id label=name bind=x\n`);
    const before = ui.loom.metrics.height;
    ui.press("select");
    const a = ui.popup!.area!;
    expect(ui.loom.metrics.height).toBeGreaterThanOrEqual(a.y + a.h);
    expect(ui.loom.metrics.height).toBeGreaterThan(before);
    ui.key("Escape");
    expect(ui.loom.metrics.height).toBe(before);
  });
});

describe("changes while open", () => {
  it("keeps the highlight on the same option when the options change", () => {
    const ui = render(basic);
    ui.tab();
    ui.key("ArrowDown");
    ui.key("ArrowDown");
    expect(ui.popup!.state.highlight).toBe("s:sales");
    ui.set("departments", toData([{ id: "sales", name: "Sales" }, { id: "eng", name: "Engineering" }]) as Value);
    expect(ui.popup).not.toBeNull();
    expect(shownOptions(ui)).toEqual(["opt:s:sales", "opt:s:eng"]);
    ui.key("Enter");
    expect(ui.state.department).toBe("sales");
  });

  it("moves the highlight to the first option when its option goes away", () => {
    const ui = render(basic);
    ui.tab();
    ui.key("ArrowDown");
    ui.key("End");
    expect(ui.popup!.state.highlight).toBe("s:design");
    ui.set("departments", toData([{ id: "x", name: "X" }, { id: "y", name: "Y" }]) as Value);
    ui.key("Enter");
    expect(ui.state.department).toBe("x");
  });

  it("closes when there's nothing left to choose, it's disabled, or it's hidden", () => {
    for (const change of [
      (ui: Rendered) => ui.set("departments", toData([]) as Value),
      (ui: Rendered) => ui.set("off", true),
      (ui: Rendered) => ui.set("show", false),
    ]) {
      const ui = render(`${depts} off=false show=true\nselect items=departments value=id label=name bind=department disabled=off if=show\n`);
      ui.press("select");
      expect(ui.popup).not.toBeNull();
      change(ui);
      expect(ui.popup).toBeNull();
      expect(ui.state.department).toBe("");
    }
  });

  it("closes, with no regions left, when the spec is replaced or a new stream starts", () => {
    const ui = render(basic);
    ui.press("select");
    ui.setSpec(`button "Other" on=inc:n\n`);
    expect(ui.popup).toBeNull();
    ui.press("button");
    expect(ui.state.n).toBe(1);
    ui.setSpec(basic);
    ui.press("select");
    ui.loom.beginStream({ keepState: true });
    ui.loom.renderNow();
    expect(ui.popup).toBeNull();
  });

  it("can't be opened while disabled", () => {
    const ui = render(`${depts}\nselect items=departments value=id label=name bind=department disabled=true\n`);
    expect(ui.hits).toEqual([]);
    expect(() => ui.press("select")).toThrow(/isn't pressable/);
  });
});

describe("inside each", () => {
  it("each copy writes its own item, and its list belongs to it", () => {
    const ui = render(`state levels=["Low", "High"] rows=[{name: "A", level: ""}, {name: "B", level: ""}]
each items=rows as=r
  select "{r.name}" items=levels bind=r.level
`);
    expect(ui.diagnostics).toEqual([]);
    const second = ui.findAll("select")[1]!.node.id;
    const field = ui.hits.find((h) => h.box.node.id === second)!.box;
    ui.click(field.x + 10, field.y + 10);
    expect(ui.popup?.owner.id).toBe(second);
    pressPopup(ui, "opt:s:High");
    expect(JSON.parse(JSON.stringify(ui.state.rows))).toEqual([{ name: "A", level: "" }, { name: "B", level: "High" }]);
  });
});

describe("themes", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("paints the field and its list with %s theme colors", (_, theme) => {
    const ui = render(basic.replace('department=""', 'department="sales"'), { theme });
    ui.tab();
    ui.key("ArrowDown");
    const c = theme.colors;
    const allowed = new Set(Object.values(c));
    for (const o of ui.drawOps) expect(allowed.has(o.op.startsWith("fill") ? o.fillStyle : o.strokeStyle), `${o.op}`).toBe(true);
    // The panel, the highlight and the chosen option's check mark.
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === c.surface)).toBe(true);
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === c.accent && o.globalAlpha < 1)).toBe(true);
    expect(ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === c.accent).length).toBeGreaterThan(0);
    expect(ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Legal")!.fillStyle).toBe(c.muted);
  });
});

describe("the Directory playground sample", () => {
  it("filters the people shown by the chosen department", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.directory!.spec, { width: 375 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toContain("6 people");
    ui.press("select");
    pressPopup(ui, `opt:${optionKey("eng")}`);
    expect(ui.text()).toContain("2 people");
    const rows = (ui.find("table").box!.data as { rows: Array<{ key: Value }> }).rows.map((r) => r.key);
    expect(rows).toEqual(["Ada Park", "Dev Rao"]);
    expect(ui.emitted).toEqual([{ name: "filter", value: "eng" }]);
  });
});
