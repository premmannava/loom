/**
 * The if block: a line holding only if={…} shows the lines indented under it
 * only while its condition holds. Models write conditions this way on their
 * own, so SayShape accepts it.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { cases } from "../eval/cases";
import { allDoneShowsMore } from "../eval/checks";

const registry = new Registry(coreComponents);

/** Qwen3 14B's answer to the hard-celebrate eval request, unchanged. */
const qwen = `state todos=[{text: "Wash dishes", done: false}, {text: "Vacuum living room", done: false}, {text: "Do laundry", done: false}, {text: "Clean bathroom", done: false}]
card
  text "Chores" style=title
  each items=todos as=t
    row
      check "{t.text}" bind=t.done
  if={count(todos, 'done') == len(todos)}
    text "Congratulations! All chores are completed!" tone=good
`;

describe("if blocks", () => {
  it("show what's under them only while the condition holds", () => {
    const ui = render(qwen);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).not.toContain("Congratulations! All chores are completed!");
    for (const t of ["Wash dishes", "Vacuum living room", "Do laundry", "Clean bathroom"]) ui.press({ type: "check", text: t });
    expect(ui.text()).toContain("Congratulations! All chores are completed!");
    ui.press({ type: "check", text: "Do laundry" });
    expect(ui.text()).not.toContain("Congratulations! All chores are completed!");
  });

  it("make Qwen's answer pass the eval's celebration check", () => {
    expect(cases.find((c) => c.id === "hard-celebrate")!.checks).toContain(allDoneShowsMore);
    expect(allDoneShowsMore.test(qwen, render(qwen))).toBe(true);
  });

  it("lay out their lines in the container around them", () => {
    const ui = render(`state on=true
row
  text "A"
  if=on
    text "B"
    text "C"
`);
    const xs = ui.findAll("text").map((f) => f.box!.x);
    expect(new Set(xs).size).toBe(3);
  });

  it("work inside each, reading the item, and can nest", () => {
    const ui = render(`state xs=[{n: "A", on: true, deep: true}, {n: "B", on: false, deep: true}, {n: "C", on: true, deep: false}]
each items=xs as=x
  if={x.on}
    text "{x.n}"
    if={x.deep}
      text "{x.n} deep"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["A", "A deep", "C"]);
  });

  it("are checked like each: their lines must suit the container around them", () => {
    const diags = (spec: string) => parse(spec, registry).diagnostics;
    expect(diags(`state t="a" on=true\ntabs bind=t\n  if=on\n    tab "A" value=a\n      text "x"\n`)).toEqual([]);
    expect(diags(`state t="a" on=true\ntabs bind=t\n  if=on\n    text "x"\n`)).toEqual([{ line: 4, severity: "error", message: `"tabs" (line 2) can't contain "text"` }]);
    expect(diags(`text "a"\n  if=on\n`)[0]!.message).toMatch(/can't contain anything/);
  });

  it("check their condition's names, including loop variables used outside their each", () => {
    expect(parse(`state xs=[1]\neach items=xs as=t\n  text "{t}"\nif={t > 0}\n  text "x"\n`, registry).diagnostics.map((d) => d.message)).toEqual([
      `"t" only exists inside the each on line 2 (as=t). Indent this line under it, or use a state name`,
    ]);
  });

  it("only count as a block when if= is alone on the line", () => {
    const d = parse(`state on=true\nif=on tone=good\n  text "x"\n`, registry).diagnostics;
    expect(d[0]!.message).toMatch(/A line can't start with if=/);
    expect(parse(`state on=true\nif={on && true}\n  text "x"\n`, registry).diagnostics).toEqual([]);
  });

  it("parse at every prefix", () => {
    const lines = qwen.split("\n");
    for (let n = 0; n <= lines.length; n++) {
      const ui = render(lines.slice(0, n).join("\n") + "\n");
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
  });
});
