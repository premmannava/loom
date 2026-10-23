import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { chartData, chartScale, MAX_CHART_ITEMS, niceStep, tickLabels, type ChartGeometry } from "../src/components/chart";
import { toData } from "../src/data";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { monoWidth, render, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const sales = `state sales=[{month: "Jan", revenue: 12000}, {month: "Feb", revenue: 18000}, {month: "Mar", revenue: 15000}]`;
const geo = (ui: Rendered, i = 0): ChartGeometry => ui.findAll("chart")[i]!.box!.data as ChartGeometry;
const list = (rows: unknown[]) => toData(rows);
const chartOf = (rows: string, kind = "bar", width = 600) =>
  render(`state rows=${rows}\nchart "T" kind=${kind} items=rows x=k y=v\n`, { width });
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("chart props", () => {
  it("accepts the documented props with no problems", () => {
    for (const kind of ["bar", "line"]) {
      const r = parse(`${sales}\nchart "Revenue" kind=${kind} items=sales x=month y=revenue format=money\n`, registry);
      expect(r.diagnostics).toEqual([]);
    }
    expect(parse(`${sales}\nchart items={take(sales, 2)} x=month y=revenue\n`, registry).diagnostics).toEqual([]);
  });

  it("explains bad or missing props", () => {
    const msgs = (spec: string) => parse(`${sales}\n${spec}\n`, registry).diagnostics.map((d) => d.message);
    expect(msgs(`chart kind=area items=sales x=month y=revenue`)).toEqual([`kind should be one of bar, hbar, line, pie, donut; got "area"`]);
    expect(msgs(`chart items=sales x=month y=revenue format=euro`)).toEqual([`format should be one of number, money; got "euro"`]);
    expect(msgs(`chart items=sales x="the month" y=revenue`)[0]).toMatch(/x should be a plain name/);
    expect(msgs(`chart items=sales x=month`)).toEqual([`"chart" needs y=`]);
    expect(msgs(`chart x=month y=revenue`)).toEqual([`"chart" needs items=`]);
    expect(msgs(`chart items=sales x=month y=revenue color=red`)[0]).toMatch(/"chart" has no prop "color"/);
    expect(msgs(`chart items=salez x=month y=revenue`)[0]).toMatch(/salez/);
  });

  it("is documented in the model guide, generated from its definition", async () => {
    const { languageGuide } = await import("../src/prompt");
    const g = languageGuide(registry);
    expect(g).toContain(`kind=<bar|hbar|line|pie|donut>`);
    expect(g).toContain(`y=revenue,last_year`);
    expect(g).toMatch(/shown as gaps, not zero/);
    expect(languageGuide(registry, { mode: "compact" })).toMatch(/^- chart \["text"\] kind=bar\|hbar\|line\|pie\|donut items=expr! x=name! y=name,name! labels=text format=number\|money/m);
  });
});

describe("chart data", () => {
  it("keeps every item as a slot, in order, with its label and value", () => {
    const d = chartData(list([{ k: "A", v: 3 }, { k: "B", v: -1 }, { k: 7, v: 0 }]), "k", "v");
    expect(d.slots).toEqual([{ label: "A", value: 3 }, { label: "B", value: -1 }, { label: "7", value: 0 }]);
    expect(d.problem).toBeUndefined();
  });

  it("turns missing, null, text and non-record items into gaps, never zero", () => {
    const d = chartData(list([{ k: "A", v: 1 }, { k: "B" }, { k: "C", v: null }, { k: "D", v: "12" }, "oops", { v: 2 }]), "k", "v");
    expect(d.slots.map((s) => s.value)).toEqual([1, null, null, null, null, 2]);
    expect(d.slots.map((s) => s.label)).toEqual(["A", "B", "C", "D", "—", "—"]);
    expect(d.gaps).toBe(4);
  });

  it("says why there's nothing to draw", () => {
    expect(chartData(undefined, "k", "v").problem).toBe("not-list");
    expect(chartData("text", "k", "v").problem).toBe("not-list");
    expect(chartData(list([]), "k", "v").problem).toBe("empty");
    expect(chartData(list([{ k: "A" }, { k: "B", v: "x" }]), "k", "v").problem).toBe("no-values");
    const many = list(Array.from({ length: MAX_CHART_ITEMS + 1 }, (_, i) => ({ k: `${i}`, v: i })));
    expect(chartData(many, "k", "v").problem).toBe("too-many");
    expect(chartData(list(Array.from({ length: MAX_CHART_ITEMS }, (_, i) => ({ k: `${i}`, v: i }))), "k", "v").problem).toBeUndefined();
  });

  it("never changes the data it reads", () => {
    const rows = list([{ k: "A", v: 1 }, { k: "B" }]);
    const before = JSON.stringify(rows);
    chartData(rows, "k", "v");
    expect(JSON.stringify(rows)).toBe(before);
    expect(Object.isFrozen(rows)).toBe(true);
  });
});

describe("chart scale", () => {
  it("picks steps of 1, 2 or 5 times a power of ten", () => {
    expect([0.13, 0.25, 0.8, 3, 14, 4100].map(niceStep)).toEqual([0.1, 0.2, 1, 5, 10, 5000]);
  });

  it("includes 0 for bars, and covers every value", () => {
    for (const vals of [[5, 9], [-5, -2], [-3, 8], [0, 0], [7, 7], [-4, -4]]) {
      const s = chartScale(vals, "bar", 4);
      expect(s.min, String(vals)).toBeLessThanOrEqual(Math.min(0, ...vals));
      expect(s.max, String(vals)).toBeGreaterThanOrEqual(Math.max(0, ...vals));
      expect(s.max).toBeGreaterThan(s.min);
      expect(s.ticks).toContain(0);
    }
  });

  it("fits lines to their values, with room around a constant one", () => {
    const s = chartScale([98, 101, 99], "line", 4);
    expect(s.min).toBe(98);
    expect(s.max).toBe(101);
    const c = chartScale([3, 3], "line", 4);
    expect(c.min).toBeLessThan(3);
    expect(c.max).toBeGreaterThan(3);
    expect(chartScale([0, 0], "line", 4)).toMatchObject({ min: 0, max: 1 });
  });

  it("formats ticks for the step, compactly when large", () => {
    expect(tickLabels([0, 10000, 20000], 10000, "money")).toEqual(["$0", "$10K", "$20K"]);
    expect(tickLabels([-10000, 0, 10000], 10000, "number")).toEqual(["-10K", "0", "10K"]);
    expect(tickLabels([0, 2500, 5000, 7500, 10000], 2500, "number")).toEqual(["0", "2.5K", "5K", "7.5K", "10K"]);
    expect(tickLabels([0, 2000, 4000, 6000], 2000, "number")).toEqual(["0", "2,000", "4,000", "6,000"]);
    expect(tickLabels([0.2, 0.4, 0.6], 0.2, "number")).toEqual(["0.2", "0.4", "0.6"]);
    expect(tickLabels([0.2, 0.4, 0.6], 0.2, "money")).toEqual(["$0.20", "$0.40", "$0.60"]);
    expect(tickLabels([0, 2, 4], 2, "money")).toEqual(["$0", "$2", "$4"]);
    expect(tickLabels([-0, 1], 1, "number")).toEqual(["0", "1"]);
  });

  /** Labels for values as the chart would scale them. */
  const labelsFor = (values: number[], kind: "bar" | "line", format: "number" | "money" = "number") => {
    const s = chartScale(values, kind, 4);
    return { ...s, labels: tickLabels(s.ticks, s.step, format) };
  };

  it("never shows two ticks with the same label", () => {
    const cases: Array<[number[], "bar" | "line"]> = [
      [[10000, 10001, 10002], "line"],
      [[10000, 10001, 10002], "bar"],
      [[999_999, 1_000_001], "line"],
      [[1.0001, 1.0002], "line"],
      [[1e-101, 3e-101], "line"],
      [[1e-101, 3e-101], "bar"],
      [[-1e308, 1e308], "bar"],
      [[Number.MAX_VALUE, Number.MAX_VALUE], "line"],
      [[Number.MIN_VALUE, Number.MIN_VALUE], "line"],
      [[1e15, 1e15 + 0.25], "line"],
      [[2e21, 3e21], "line"],
    ];
    for (const [values, kind] of cases) {
      for (const format of ["number", "money"] as const) {
        const { labels, ticks, min, max } = labelsFor(values, kind, format);
        const what = `${kind} ${values.join(", ")} ${format}: ${labels.join(" | ")}`;
        expect(new Set(labels).size, what).toBe(labels.length);
        expect(ticks.length, what).toBeGreaterThanOrEqual(2);
        expect(ticks.every(Number.isFinite), what).toBe(true);
        expect(max, what).toBeGreaterThan(min);
        // The scale covers every value.
        expect(min, what).toBeLessThanOrEqual(Math.min(...values));
        expect(max, what).toBeGreaterThanOrEqual(Math.max(...values));
        for (const l of labels) expect(l.length, what).toBeLessThan(30);
      }
    }
  });

  it("keeps the precision that tells close ticks apart", () => {
    expect(labelsFor([10000, 10001, 10002], "line").labels).toEqual(["10,000.0", "10,000.5", "10,001.0", "10,001.5", "10,002.0"]);
    expect(labelsFor([1e-101, 3e-101], "line").labels).toEqual(["1E-101", "1.5E-101", "2E-101", "2.5E-101", "3E-101"]);
    expect(labelsFor([1e-101, 3e-101], "bar").labels).toEqual(["0", "1E-101", "2E-101", "3E-101"]);
  });
});

describe("bar geometry", () => {
  it("maps each category to its value, bars proportional to the values", () => {
    const ui = render(`${sales}\nchart "Revenue" kind=bar items=sales x=month y=revenue format=money\n`);
    const g = geo(ui);
    expect(g.slots.map((s) => [s.label, s.value])).toEqual([["Jan", 12000], ["Feb", 18000], ["Mar", 15000]]);
    const [jan, feb, mar] = g.slots.map((s) => s.bar!);
    // Bars stand on the zero line.
    for (const b of [jan!, feb!, mar!]) near(b.y + b.h, g.zeroY!);
    near(jan!.h / feb!.h, 12000 / 18000);
    near(mar!.h / feb!.h, 15000 / 18000);
    // Left to right in list order, evenly spaced.
    expect(g.slots[1]!.cx - g.slots[0]!.cx).toBeCloseTo(g.slots[2]!.cx - g.slots[1]!.cx, 6);
    expect(g.ticks.map((t) => t.label)).toEqual(["$0", "$5K", "$10K", "$15K", "$20K"]);
    expect(ui.warnings).toEqual([]);
  });

  it("draws negative values below zero and positive above, in a mixed chart", () => {
    const g = geo(chartOf(`[{k: "a", v: 4}, {k: "b", v: -2}]`));
    const [up, down] = g.slots.map((s) => s.bar!);
    near(up!.y + up!.h, g.zeroY!);
    near(down!.y, g.zeroY!);
    expect(down!.h).toBeGreaterThan(0);
    near(up!.h / down!.h, 2);
  });

  it("hangs all-negative bars from a zero line at the top", () => {
    const g = geo(chartOf(`[{k: "a", v: -4}, {k: "b", v: -2}]`));
    expect(g.max).toBe(0);
    for (const s of g.slots) near(s.bar!.y, g.zeroY!);
  });

  it("handles all-zero values without dividing by zero", () => {
    const g = geo(chartOf(`[{k: "a", v: 0}, {k: "b", v: 0}]`));
    expect(g.message).toBeUndefined();
    for (const s of g.slots) {
      expect(s.bar!.h).toBe(0);
      expect(Number.isFinite(s.bar!.y)).toBe(true);
    }
    expect(g.min).toBe(0);
    expect(g.max).toBeGreaterThan(0);
  });

  it("leaves a gap for an item with no number", () => {
    const ui = chartOf(`[{k: "a", v: 4}, {k: "b"}, {k: "c", v: 1}]`);
    const g = geo(ui);
    expect(g.slots[1]).toMatchObject({ label: "b", value: null });
    expect(g.slots[1]!.bar).toBeUndefined();
    expect(g.slots[1]!.shownLabel).toBe("b");
    expect(ui.warnings).toEqual([`chart on line 2: 1 of 3 items have no number in their y field, so they're shown as gaps`]);
  });
});

describe("line geometry", () => {
  it("places points by value on a linear scale, in list order", () => {
    const g = geo(chartOf(`[{k: "a", v: 10}, {k: "b", v: 30}, {k: "c", v: 20}]`, "line"));
    const ys = g.slots.map((s) => s.point!.y);
    // Higher values are higher up.
    expect(ys[1]).toBeLessThan(ys[2]!);
    expect(ys[2]).toBeLessThan(ys[0]!);
    // Equal differences in value make equal differences in height.
    near(ys[0]! - ys[2]!, ys[2]! - ys[1]!);
    expect(g.segments).toEqual([g.slots.map((s) => s.point)]);
    // The ticks use the same scale as the points.
    const at = (v: number) => g.ticks.find((t) => t.value === v)!.y;
    near(at(10), ys[0]!);
    near(at(30), ys[1]!);
  });

  it("breaks the line at a gap instead of joining across it", () => {
    const g = geo(chartOf(`[{k: "a", v: 1}, {k: "b", v: 2}, {k: "c"}, {k: "d", v: 3}]`, "line"));
    expect(g.segments.map((r) => r.length)).toEqual([2, 1]);
  });

  it("shows a single point as a visible dot", () => {
    const ui = chartOf(`[{k: "only", v: 5}]`, "line");
    const g = geo(ui);
    expect(g.segments).toEqual([[g.slots[0]!.point]]);
    const p = g.slots[0]!.point!;
    expect(p.y).toBeGreaterThan(g.plot.y);
    expect(p.y).toBeLessThan(g.plot.y + g.plot.h);
    const accent = lightTheme.colors.accent;
    expect(ui.drawOps.some((o) => o.op === "stroke" && o.strokeStyle === accent)).toBe(true);
  });

  it("draws a constant line flat, inside the plot", () => {
    const g = geo(chartOf(`[{k: "a", v: 7}, {k: "b", v: 7}, {k: "c", v: 7}]`, "line"));
    const ys = new Set(g.slots.map((s) => s.point!.y));
    expect(ys.size).toBe(1);
    const y = [...ys][0]!;
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeGreaterThan(g.plot.y);
    expect(y).toBeLessThan(g.plot.y + g.plot.h);
  });
});

describe("extreme values", () => {
  it.each([
    ["tiny", `[{k: "a", v: 1e-101}, {k: "b", v: 3e-101}, {k: "c", v: 2e-101}]`],
    ["huge", `[{k: "a", v: -1e308}, {k: "b", v: 1e308}]`],
    ["close", `[{k: "a", v: 10000}, {k: "b", v: 10001}, {k: "c", v: 10002}]`],
  ])("draws %s values inside the plot, with distinct axis labels", (_, rows) => {
    for (const kind of ["bar", "line"]) {
      const ui = chartOf(rows, kind);
      const g = geo(ui);
      expect(g.message, kind).toBeUndefined();
      expect(new Set(g.ticks.map((t) => t.label)).size).toBe(g.ticks.length);
      for (const s of g.slots) {
        const ys = s.bar ? [s.bar.y, s.bar.y + s.bar.h] : [s.point!.y];
        for (const y of ys) {
          expect(Number.isFinite(y)).toBe(true);
          expect(y).toBeGreaterThanOrEqual(g.plot.y - 1e-6);
          expect(y).toBeLessThanOrEqual(g.plot.y + g.plot.h + 1e-6);
        }
      }
      // Distinct values stay distinct on screen.
      const ends = g.slots.map((s) => (s.bar ? (s.value! >= 0 ? s.bar.y : s.bar.y + s.bar.h) : s.point!.y));
      expect(new Set(ends.map((y) => y.toFixed(3))).size).toBe(g.slots.length);
    }
  });
});

describe("chart layout", () => {
  const many = (n: number) => `[${Array.from({ length: n }, (_, i) => `{k: "Category ${i + 1}", v: ${(i * 37) % 11}}`).join(", ")}]`;

  it.each([320, 1000])("keeps every mark, tick and label inside its box at %i px", (width) => {
    for (const kind of ["bar", "line"]) {
      const ui = chartOf(many(24), kind, width);
      const { box } = ui.find("chart");
      const g = box!.data as ChartGeometry;
      expect(box!.w).toBeLessThanOrEqual(width);
      const inPlot = (y: number) => y >= g.plot.y - 1e-6 && y <= g.plot.y + g.plot.h + 1e-6;
      for (const t of g.ticks) expect(inPlot(t.y)).toBe(true);
      for (const s of g.slots) {
        expect(s.cx).toBeGreaterThan(g.plot.x);
        expect(s.cx).toBeLessThan(g.plot.x + g.plot.w);
        if (s.bar) { expect(inPlot(s.bar.y)).toBe(true); expect(inPlot(s.bar.y + s.bar.h)).toBe(true); expect(s.bar.x).toBeGreaterThanOrEqual(g.plot.x); }
        if (s.point) expect(inPlot(s.point.y)).toBe(true);
      }
      expect(g.plot.x + g.plot.w).toBeLessThanOrEqual(box!.w + 1e-6);
      // Labels (measured as the test canvas does) stay inside the box.
      for (const s of g.slots.filter((x) => x.shownLabel)) {
        const half = monoWidth(s.shownLabel!, g.labelFont) / 2;
        expect(s.labelX - half).toBeGreaterThanOrEqual(-1e-6);
        expect(s.labelX + half).toBeLessThanOrEqual(box!.w + 1e-6);
      }
      expect(g.labelY).toBeGreaterThan(g.plot.y + g.plot.h);
      expect(g.labelY).toBeLessThan(box!.h);
    }
  });

  it("keeps a long last label inside the box", () => {
    const ui = chartOf(`[{k: "a", v: 1}, {k: "b", v: 3}, {k: "A rather long final label", v: 2}]`, "bar", 320);
    const g = geo(ui);
    const last = g.slots[2]!;
    expect(last.shownLabel).not.toBeNull();
    expect(last.labelX + monoWidth(last.shownLabel!, g.labelFont) / 2).toBeLessThanOrEqual(ui.find("chart").box!.w + 1e-6);
  });

  it("thins labels on a narrow screen but keeps every data point", () => {
    const narrow = geo(chartOf(many(24), "bar", 320));
    const wide = geo(chartOf(many(24), "bar", 2400));
    expect(narrow.slots.every((s) => s.bar)).toBe(true);
    expect(narrow.slots.filter((s) => s.shownLabel).length).toBeLessThan(24);
    expect(narrow.slots[0]!.shownLabel).not.toBeNull();
    expect(wide.slots.filter((s) => s.shownLabel).length).toBe(24);
  });

  it("grows the plot with the width, within limits", () => {
    const h = (w: number) => geo(chartOf(many(3), "bar", w)).plot.h;
    expect(h(320)).toBe(140);
    expect(h(500)).toBeGreaterThan(h(320));
    expect(h(2000)).toBe(260);
  });

  it("says when the screen is too narrow for the data, once", () => {
    const ui = chartOf(many(150), "bar", 320);
    expect(geo(ui).message).toBe("Too narrow to chart 150 items");
    ui.set("other", 1);
    ui.set("other", 2);
    expect(ui.warnings.filter((w) => /don't fit/.test(w))).toHaveLength(1);
  });

  it("says when there are too many items", () => {
    expect(geo(chartOf(many(MAX_CHART_ITEMS + 1))).message).toBe(`Too many items to chart: at most ${MAX_CHART_ITEMS}`);
  });

  it("shows a message for empty, missing or unchartable data", () => {
    expect(geo(chartOf(`[]`)).message).toBe("No data to chart");
    expect(geo(chartOf(`[{k: "a"}, {k: "b", v: "lots"}]`)).message).toBe("No numbers to chart");
    const ui = render(`state n=3\nchart items=n x=k y=v\n`);
    expect(geo(ui).message).toBe("No data to chart");
    expect(ui.warnings[0]).toMatch(/chart on line 2: items is not a list/);
    expect(ui.text()).toContain("No data to chart");
  });

  it("works inside a card and a row, which move it", () => {
    const ui = render(`${sales}\ncard\n  row\n    chart kind=bar items=sales x=month y=revenue\n    chart kind=line items=sales x=month y=revenue\n`, { width: 800 });
    const [a, b] = ui.findAll("chart").map((f) => f.box!);
    expect(b!.x).toBeGreaterThan(a!.x + a!.w - 1);
    // Geometry is relative to the box, so painting at the moved box lines up.
    const g = b!.data as ChartGeometry;
    const labels = ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === "Jan");
    expect(labels.map((o) => o.args[1])).toContain(b!.x + g.slots[0]!.labelX);
  });
});

describe("chart updates", () => {
  it("redraws when the data changes, without a new spec", () => {
    const ui = render(`${sales}\nchart kind=bar items=sales x=month y=revenue\n`);
    const before = geo(ui).slots.map((s) => s.bar!.h);
    ui.set("sales", list([{ month: "Jan", revenue: 12000 }, { month: "Feb", revenue: 36000 }, { month: "Mar", revenue: 15000 }, { month: "Apr", revenue: 1000 }]) as Value);
    const after = geo(ui);
    expect(after.slots.map((s) => s.label)).toEqual(["Jan", "Feb", "Mar", "Apr"]);
    // The scale grew to fit 36K, so Jan's unchanged 12K is now a shorter bar.
    expect(after.max).toBeGreaterThanOrEqual(36000);
    expect(after.slots[0]!.bar!.h).toBeLessThan(before[0]!);
    near(after.slots[0]!.bar!.h / after.slots[1]!.bar!.h, 12000 / 36000);
  });

  it("follows the screen's own controls changing an item", () => {
    const ui = render(`${sales}
card
  chart kind=line items=sales x=month y=revenue
  each items=sales as=s
    button "More {s.month}" on=inc:s.revenue:6000
`);
    const y0 = geo(ui).slots[0]!.point!.y;
    ui.press({ type: "button", text: "More Jan" });
    expect(ui.state.sales).toEqual(list([{ month: "Jan", revenue: 18000 }, { month: "Feb", revenue: 18000 }, { month: "Mar", revenue: 15000 }]));
    const g = geo(ui);
    expect(g.slots[0]!.point!.y).toBeLessThan(y0);
    near(g.slots[0]!.point!.y, g.slots[1]!.point!.y);
  });

  it("follows a filtered list as people type", () => {
    const ui = render(`state q="" rows=[{k: "Apples", v: 3}, {k: "Pears", v: 5}, {k: "Apricots", v: 2}]
input bind=q
chart items={search(rows, 'k', q)} x=k y=v
`);
    expect(geo(ui).slots).toHaveLength(3);
    ui.type("input", "Ap");
    expect(geo(ui).slots.map((s) => s.label)).toEqual(["Apples", "Apricots"]);
  });

  it("renders the same however the spec streams in", () => {
    const spec = `${sales}\ncard\n  chart "Revenue" kind=bar items=sales x=month y=revenue format=money\n  chart "Trend" kind=line items=sales x=month y=revenue\n`;
    const whole = render(spec);
    const streamed = render("");
    const chunks: string[] = [];
    for (let i = 0; i < spec.length; i += 7) chunks.push(spec.slice(i, i + 7));
    streamed.stream(chunks);
    expect(streamed.diagnostics).toEqual([]);
    expect(geo(streamed, 0)).toEqual(geo(whole, 0));
    expect(geo(streamed, 1)).toEqual(geo(whole, 1));
    // Every prefix cut at a line boundary parses cleanly.
    const lines = spec.split("\n");
    for (let n = 1; n < lines.length; n++) expect(parse(lines.slice(0, n).join("\n") + "\n", registry).diagnostics).toEqual([]);
  });
});

describe("chart themes", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("paints only with %s theme colors", (_, theme) => {
    for (const kind of ["bar", "line"]) {
      const ui = render(`${sales}\nchart "Revenue" kind=${kind} items=sales x=month y=revenue\n`, { theme });
      const c = theme.colors;
      const allowed = new Set([c.accent, c.ink, c.muted, c.line, c.surface]);
      const ops = ui.drawOps.filter((o) => o.op !== "fillRect"); // the engine's own background
      for (const o of ops) {
        const used = o.op.startsWith("fill") || o.op === "fill" ? o.fillStyle : o.strokeStyle;
        expect(allowed.has(used), `${o.op} ${used}`).toBe(true);
      }
      const marks = ops.filter((o) => (kind === "bar" ? o.op === "fill" && o.fillStyle === c.accent : o.op === "stroke" && o.strokeStyle === c.accent));
      expect(marks.length).toBeGreaterThan(0);
      expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Revenue")!.fillStyle).toBe(c.ink);
      expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Jan")!.fillStyle).toBe(c.muted);
    }
  });
});

describe("the Charts playground sample", () => {
  it("parses cleanly, and its controls change both charts", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.charts!.spec);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    const [bars, line] = [geo(ui, 0), geo(ui, 1)];
    expect(bars.kind).toBe("bar");
    expect(line.kind).toBe("line");
    expect(line.slots).toHaveLength(6);

    // A stepper's plus raises its department's bar.
    const h0 = bars.slots[3]!.bar!.h;
    const plus = ui.hits.filter((h) => h.box.node.type === "stepper" && h.detail === "inc")[3]!.box;
    ui.click(plus.x + plus.w / 2, plus.y + plus.h / 2);
    expect((ui.state.depts as Array<{ units: number }>)[3]!.units).toBe(280);
    expect(geo(ui, 0).slots[3]!.bar!.h).toBeGreaterThan(h0);

    ui.press({ type: "button", text: "Add November" });
    expect(geo(ui, 1).slots.map((s) => s.label).at(-1)).toBe("Nov");
    ui.press({ type: "button", text: "Drop oldest" });
    expect(geo(ui, 1).slots.map((s) => s.label)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
  });
});
