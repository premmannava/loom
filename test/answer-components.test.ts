/** timeline and step, segmented, carousel, compare and compare-row. */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const warnings = (spec: string) => parse(spec, registry).diagnostics.map((d) => d.message);
const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("timeline", () => {
  const SPEC = `timeline
  step "Ordered" time="Oct 18" status=done
  step "Shipped" detail="Phoenix, AZ" status=current icon=truck
  step "Delivered" status=upcoming
`;
  it("draws each step's words to the right of its marker, upcoming ones muted", () => {
    const ui = render(SPEC);
    expect(texts(ui)).toEqual(expect.arrayContaining(["Ordered", "Oct 18", "Shipped", "Phoenix, AZ", "Delivered"]));
    const delivered = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Delivered")!;
    expect(delivered.fillStyle).toBe(lightTheme.colors.muted);
    const ordered = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Ordered")!;
    expect(Number(ordered.args[1])).toBeGreaterThan(ui.find("timeline").box!.x + 22);
    ui.destroy();
  });

  it("joins done steps in the accent and the rest in the line color", () => {
    const ui = render(SPEC);
    const lines = ui.drawOps.filter((o) => o.op === "stroke").map((o) => o.strokeStyle);
    expect(lines).toContain(lightTheme.colors.accent);
    expect(lines).toContain(lightTheme.colors.line);
    ui.destroy();
  });

  it("warns about a bad status or icon", () => {
    expect(warnings(`timeline\n  step "A" status=finished\n`)[0]).toMatch(/status should be one of done, current, upcoming/);
    expect(warnings(`timeline\n  step "A" icon=lorry\n`)[0]).toMatch(/icon="lorry" isn't an icon/);
  });
});

describe("segmented", () => {
  it("shows its options, the chosen one in ink, and switches on press and with the arrow keys", () => {
    const ui = render(`state view="Week"\nsegmented bind=view options="Week,Month,Year"\n`);
    const week = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Week")!;
    expect(week.fillStyle).toBe(lightTheme.colors.ink);
    const year = ui.hits.find((h) => h.detail === "Year")!;
    ui.loom.activate({ node: year.box.node, box: year.box, detail: "Year" });
    ui.loom.renderNow();
    expect(ui.loom.state.get("view")).toBe("Year");
    ui.loom.focus = { node: year.box.node, box: year.box, detail: "Year" };
    ui.key("ArrowLeft");
    expect(ui.loom.state.get("view")).toBe("Month");
    ui.destroy();
  });

  it("needs two to six options", () => {
    expect(warnings(`segmented bind=v options="Only"\n`)[0]).toMatch(/at least two options/);
    expect(warnings(`segmented bind=v options="a,b,c,d,e,f,g"\n`)[0]).toMatch(/at most 6 options/);
    expect(warnings(`segmented bind=v options="Chart,Table"\n`)).toEqual([]);
  });
});

describe("carousel", () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `  card\n    text "Card ${i + 1}"`).join("\n");

  it("shows as many cards as fit, and pages with the arrows", () => {
    const ui = render(`state page=0\ncarousel bind=page\n${cards(5)}\n`, { width: 600 });
    expect(texts(ui).filter((t) => t.startsWith("Card"))).toEqual(["Card 1", "Card 2"]);
    const next = ui.hits.find((h) => String(h.detail).startsWith("next"))!;
    ui.loom.activate({ node: next.box.node, box: next.box, detail: next.detail });
    ui.loom.renderNow();
    expect(ui.loom.state.get("page")).toBe(1);
    expect(texts(ui).filter((t) => t.startsWith("Card"))).toEqual(["Card 3", "Card 4"]);
    ui.destroy();
  });

  it("shows one card on a narrow screen, and no arrows when everything fits", () => {
    const narrow = render(`carousel bind=page\n${cards(3)}\n`, { width: 300 });
    expect(texts(narrow).filter((t) => t.startsWith("Card"))).toEqual(["Card 1"]);
    narrow.destroy();
    const wide = render(`carousel bind=page\n${cards(2)}\n`, { width: 600 });
    expect(wide.hits.some((h) => h.box.node.type === "carousel")).toBe(false);
    wide.destroy();
  });

  it("keeps the page in range when the list shrinks", () => {
    const ui = render(`state page=7\ncarousel bind=page\n${cards(3)}\n`, { width: 300 });
    expect(texts(ui).filter((t) => t.startsWith("Card"))).toEqual(["Card 3"]);
    ui.destroy();
  });
});

describe("compare", () => {
  const PLANS = `state plans=[{name: "Basic", price: 9, storage: 50, backup: false}, {name: "Pro", price: 19, storage: 500, backup: true}, {name: "Team", price: 49, storage: 2000, backup: true}]`;
  const SPEC = `${PLANS}\ncompare items=plans pick="Pro"\n  compare-row "Price" field=price format=money best=low\n  compare-row "Storage" field=storage format=number best=high\n  compare-row "Backup" field=backup\n`;

  it("marks the best value in each row in the good color", () => {
    const ui = render(SPEC);
    const best = ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === lightTheme.colors.good).map((o) => o.args[0]);
    expect(best).toEqual(["$9.00", "2,000"]);
    expect(texts(ui)).toEqual(expect.arrayContaining(["RECOMMENDED", "Basic", "Pro", "Team", "Price"]));
    ui.destroy();
  });

  it("stacks each row's label above its values on a narrow screen", () => {
    const wide = render(SPEC, { width: 600 }), narrow = render(SPEC, { width: 300 });
    const at = (ui: typeof wide, t: string) => ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === t)!;
    // Wide: the label and the values share a line. Narrow: the label is above them.
    expect(Number(at(wide, "Price").args[2])).toBeCloseTo(Number(at(wide, "$19.00").args[2]), 0);
    expect(Number(at(narrow, "Price").args[2])).toBeLessThan(Number(at(narrow, "$19.00").args[2]) - 10);
    wide.destroy();
    narrow.destroy();
  });

  it("says so for too few or too many options", () => {
    const one = render(`state p=[{name: "A"}]\ncompare items=p\n  compare-row "X" field=x\n`);
    expect(texts(one)).toContain("Add at least two options to compare");
    one.destroy();
    const five = render(`state p=[{name: "A"}, {name: "B"}, {name: "C"}, {name: "D"}, {name: "E"}]\ncompare items=p\n  compare-row "X" field=x\n`);
    expect(texts(five)).toContain("Too many options: at most 4");
    expect(five.warnings.some((w) => /5 options is more than the 4/.test(w))).toBe(true);
    five.destroy();
  });
});
