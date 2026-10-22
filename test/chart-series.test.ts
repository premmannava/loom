/**
 * Multi-series bar and line charts, pie and donut charts, and the series
 * colors they draw with. Single-series behaviour is covered in chart.test.ts.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { fieldsOf, MAX_SERIES, MAX_SLICES, pieData, shareText, valueText, type ChartGeometry } from "../src/components/chart";
import { toData } from "../src/data";
import { walkBoxes } from "../src/layout";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";
import { cssVarOf, darkTheme, extendTheme, lightTheme, seriesColors, type Theme } from "../src/theme";
import type { Box } from "../src/types";
import { textOverflows } from "./overflow";

const registry = new Registry(coreComponents);
const WIDTHS = [240, 360, 600];
const geo = (ui: Rendered, i = 0): ChartGeometry => ui.findAll("chart")[i]!.box!.data as ChartGeometry;
const boxOf = (ui: Rendered, i = 0): Box => ui.findAll("chart")[i]!.box!;

const sales = `state sales=[{month: "Jan", revenue: 12000, last_year: 10000, target: 11000}, {month: "Feb", revenue: 18000, last_year: 14000, target: 15000}, {month: "Mar", revenue: 15000, last_year: 16000, target: 17000}, {month: "Apr", revenue: 21000, last_year: 15500, target: 19000}]`;
const regions = (n: number) =>
  `state regions=[${Array.from({ length: n }, (_, i) => `{name: "Region number ${i + 1}", total: ${(i + 1) * 1000}}`).join(", ")}]`;

const SPECS: Record<string, string> = {
  "2-series bar": `${sales}\nchart "Revenue vs last year" kind=bar items=sales x=month y=revenue,last_year labels="This year,Last year" format=money\n`,
  "3-series line": `${sales}\nchart "Revenue, last year and target" kind=line items=sales x=month y=revenue,last_year,target format=money\n`,
  "pie with 9 items": `${regions(9)}\nchart "Sales by region" kind=pie items=regions x=name y=total format=money\n`,
  donut: `${regions(4)}\nchart "Sales by region" kind=donut items=regions x=name y=total format=money\n`,
  "pie with a negative value": `state rows=[{k: "A", v: 3}, {k: "B", v: -1}]\nchart "Mixed" kind=pie items=rows x=k y=v\n`,
};

/** Every legend entry and slice sits inside the chart's box. */
function expectInside(ui: Rendered) {
  const b = boxOf(ui), g = geo(ui);
  for (const it of g.legend) {
    expect(it.swatch.x).toBeGreaterThanOrEqual(0);
    expect(it.swatch.y + it.swatch.h).toBeLessThanOrEqual(b.h + 0.01);
    expect(it.y).toBeLessThanOrEqual(b.h);
    if (it.detailX !== undefined) expect(it.detailX).toBeLessThanOrEqual(b.w + 0.01);
  }
  if (g.pie) {
    expect(g.pie.cx - g.pie.r).toBeGreaterThanOrEqual(-0.01);
    expect(g.pie.cx + g.pie.r).toBeLessThanOrEqual(b.w + 0.01);
    expect(g.pie.cy + g.pie.r).toBeLessThanOrEqual(b.h + 0.01);
  }
  for (const s of g.slots) for (const bar of s.bars ?? []) if (bar) {
    expect(bar.x).toBeGreaterThanOrEqual(g.plot.x - 0.01);
    expect(bar.x + bar.w).toBeLessThanOrEqual(b.w + 0.01);
  }
}

describe("chart y with several fields", () => {
  const diags = (y: string, extra = "") => parse(`${sales}\nchart items=sales x=month y=${y}${extra}\n`, registry).diagnostics.map((d) => d.message);

  it("reads one field exactly as before, and a comma list as several", () => {
    expect(diags("revenue")).toEqual([]);
    expect(diags("revenue,last_year")).toEqual([]);
    expect(fieldsOf("revenue")).toEqual(["revenue"]);
    expect(fieldsOf("revenue,last_year")).toEqual(["revenue", "last_year"]);
  });

  it("warns at more than 6 fields and says how to fix it", () => {
    const seven = "a,b,c,d,e,f,g";
    expect(diags(seven)).toEqual([`chart draws at most ${MAX_SERIES} series, and y lists 7. Keep ${MAX_SERIES} fields or fewer, or make two charts`]);
  });

  it("explains a malformed list", () => {
    expect(diags("revenue,,cost")[0]).toMatch(/one or more plain names .* separated by commas with no spaces, like y=revenue,cost/);
    expect(diags("revenue,1st")[0]).toMatch(/plain names/);
  });

  it("checks labels= against the fields", () => {
    expect(diags("revenue,last_year", ` labels="This year,Last year"`)).toEqual([]);
    expect(diags("revenue,last_year", ` labels="This year"`)).toEqual([`labels has 1 names for 2 y fields; give one per field, in the same order, like labels="This year,Last year"`]);
  });

  it("shows a message past 6 series, the way it does past 200 items", () => {
    const ui = render(`state rows=[{k: "A", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7}]\nchart "T" kind=bar items=rows x=k y=a,b,c,d,e,f,g\n`);
    expect(geo(ui).message).toBe(`Too many series to chart: at most ${MAX_SERIES}`);
    expect(ui.warnings.some((w) => /at most 6/.test(w))).toBe(true);
  });

  it("keeps an unknown kind a warning, as before", () => {
    expect(parse(`${sales}\nchart kind=area items=sales x=month y=revenue\n`, registry).diagnostics.map((d) => d.message))
      .toEqual([`kind should be one of bar, line, pie, donut; got "area"`]);
  });
});

describe("pie and donut props", () => {
  const diags = (spec: string) => parse(`${regions(3)}\n${spec}\n`, registry).diagnostics;

  it("take one field with no problems", () => {
    for (const kind of ["pie", "donut"]) expect(diags(`chart kind=${kind} items=regions x=name y=total format=money`)).toEqual([]);
  });

  it("warn about a comma list in y, keep the element, and say how to fix it", () => {
    const d = diags(`chart kind=pie items=regions x=name y=total,count`);
    expect(d).toEqual([{ line: 2, severity: "warning", message: `chart kind=pie shows one field, so only y=total is used. Write y=total, or use kind=bar or kind=line to compare total, count` }]);
    const ui = render(`${regions(3)}\nchart kind=donut items=regions x=name y=total,count\n`);
    expect(geo(ui).pie!.slices.map((s) => s.value)).toEqual([1000, 2000, 3000]);
  });

  it("say labels= doesn't apply", () => {
    expect(diags(`chart kind=pie items=regions x=name y=total labels="A,B"`)[0]!.message).toMatch(/slices are named by x=/);
  });
});

describe("multi-series bar", () => {
  it("groups bars side by side in each slot, on one shared scale from 0", () => {
    const g = geo(render(SPECS["2-series bar"]!));
    expect(g.series.map((s) => s.label)).toEqual(["This year", "Last year"]);
    expect(g.min).toBe(0);
    for (const s of g.slots) {
      const [a, b] = s.bars!;
      expect(a!.x + a!.w).toBeLessThan(b!.x);
      expect(b!.x - (a!.x + a!.w)).toBeCloseTo(2);
      // Both halves of a group straddle the slot's centre.
      expect(a!.x).toBeLessThan(s.cx);
      expect(b!.x + b!.w).toBeGreaterThan(s.cx);
    }
    // Same scale: Mar's 16,000 last year is taller than its 15,000 this year.
    const mar = g.slots[2]!.bars!;
    expect(mar[1]!.h).toBeGreaterThan(mar[0]!.h);
  });

  it("leaves a gap only in the series that has no number", () => {
    const g = geo(render(`state rows=[{k: "A", a: 1, b: 2}, {k: "B", a: 3}]\nchart kind=bar items=rows x=k y=a,b\n`));
    expect(g.slots[1]!.bars![1]).toBeNull();
    expect(g.slots[1]!.bars![0]).not.toBeNull();
  });

  it("says it's too narrow rather than squeezing groups", () => {
    const rows = `[${Array.from({ length: 30 }, (_, i) => `{k: "${i}", a: ${i}, b: ${i}, c: ${i}, d: ${i}, e: ${i}, f: ${i}}`).join(", ")}]`;
    const ui = render(`state rows=${rows}\nchart kind=bar items=rows x=k y=a,b,c,d,e,f\n`, { width: 240 });
    expect(geo(ui).message).toBe("Too narrow to chart 30 items");
    expect(ui.warnings.some((w) => /with 6 series don't fit/.test(w))).toBe(true);
    const wide = render(`state rows=${rows}\nchart kind=bar items=rows x=k y=a,b\n`, { width: 1200 });
    expect(geo(wide).message).toBeUndefined();
  });
});

describe("multi-series line", () => {
  it("draws one line per field, each broken at its own gaps", () => {
    const g = geo(render(`state rows=[{k: "A", a: 1, b: 5}, {k: "B", b: 6}, {k: "C", a: 3, b: 7}]\nchart kind=line items=rows x=k y=a,b\n`));
    expect(g.seriesSegments.map((runs) => runs.map((r) => r.length))).toEqual([[1, 1], [3]]);
    expect(g.segments).toBe(g.seriesSegments[0]);
  });

  it("paints each series in its theme color, and one series in the accent", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const multi = render(SPECS["3-series line"]!, { theme });
      const strokes = new Set(multi.drawOps.filter((o) => o.op === "stroke").map((o) => o.strokeStyle));
      for (const c of seriesColors(theme).slice(0, 3)) expect(strokes.has(c)).toBe(true);
      expect(strokes.has(seriesColors(theme)[3]!)).toBe(false);
      const one = render(`${sales}\nchart kind=line items=sales x=month y=revenue\n`, { theme: extendTheme(theme, { colors: { series1: "#123456" } }) });
      const used = new Set(one.drawOps.map((o) => o.strokeStyle));
      expect(used.has(theme.colors.accent)).toBe(true);
      expect(used.has("#123456")).toBe(false);
    }
  });
});

describe("legend", () => {
  it("only shows with 2 or more series", () => {
    expect(geo(render(`${sales}\nchart kind=bar items=sales x=month y=revenue\n`)).legend).toEqual([]);
    expect(geo(render(SPECS["2-series bar"]!)).legend.map((l) => l.label)).toEqual(["This year", "Last year"]);
    expect(geo(render(`${sales}\nchart kind=bar items=sales x=month y=revenue,last_year\n`)).legend.map((l) => l.label)).toEqual(["revenue", "last_year"]);
  });

  it("wraps onto more lines at narrow widths", () => {
    const spec = `${sales}\nchart kind=line items=sales x=month y=revenue,last_year,target labels="Revenue this year,Revenue last year,Monthly target"\n`;
    const rows = (w: number) => new Set(geo(render(spec, { width: w })).legend.map((l) => l.y)).size;
    expect(rows(600)).toBe(1);
    expect(rows(240)).toBeGreaterThan(1);
  });

  it("puts the label, value and share of each slice in a pie's legend", () => {
    const g = geo(render(`state rows=[{k: "Rent", v: 1500}, {k: "Food", v: 500}]\nchart kind=pie items=rows x=k y=v format=money\n`));
    expect(g.legend.map((l) => [l.shownLabel, l.detail])).toEqual([["Rent", "$1,500 · 75%"], ["Food", "$500 · 25%"]]);
  });

  it("uses columns when there's room and one column when there isn't", () => {
    const cols = (w: number) => new Set(geo(render(SPECS["pie with 9 items"]!, { width: w })).legend.map((l) => l.swatch.x)).size;
    expect(cols(240)).toBe(1);
    expect(cols(600)).toBeGreaterThan(1);
  });
});

describe("pie data", () => {
  const rows = (vals: unknown[]) => toData(vals.map((v, i) => ({ k: `${i}`, v })));

  it("skips zeros and gaps and keeps list order", () => {
    const d = pieData(rows([3, 0, null, 1, "2"]), "k", "v");
    expect(d.slices).toEqual([{ label: "0", value: 3 }, { label: "3", value: 1 }]);
    expect(d.total).toBe(4);
    expect(d.gaps).toBe(2);
  });

  it(`keeps the ${MAX_SLICES - 1} largest and sums the rest into Other`, () => {
    const d = pieData(rows([5, 1, 9, 2, 8, 3, 7, 4, 6]), "k", "v");
    expect(d.slices.map((s) => s.value)).toEqual([5, 9, 8, 7, 6, 10]);
    expect(d.slices.at(-1)).toEqual({ label: "Other", value: 10, other: true });
    expect(d.folded).toBe(4);
    expect(d.slices.reduce((t, s) => t + s.value, 0)).toBe(d.total);
    expect(pieData(rows([1, 2, 3, 4, 5, 6]), "k", "v").slices).toHaveLength(6);
  });

  it("refuses negative values and nothing above zero", () => {
    expect(pieData(rows([3, -1]), "k", "v").problem).toBe("negative");
    expect(pieData(rows([0, 0]), "k", "v").problem).toBe("zero");
    expect(pieData(rows(["a", null]), "k", "v").problem).toBe("no-values");
    expect(pieData(rows([Number.MAX_VALUE, Number.MAX_VALUE]), "k", "v").problem).toBe("overflow");
    expect(pieData(toData([]), "k", "v").problem).toBe("empty");
  });

  it("formats values and shares for reading", () => {
    expect(valueText(12000, "money")).toBe("$12,000");
    expect(valueText(12.5, "money")).toBe("$12.50");
    expect(valueText(1_250_000, "number")).toBe("1.3M");
    expect(valueText(318_000, "money")).toBe("$318K");
    expect(shareText(0.004)).toBe("<1%");
    expect(shareText(0.335)).toBe("34%");
    expect(shareText(0)).toBe("0%");
  });
});

describe("pie and donut geometry", () => {
  it("covers the whole circle, clockwise from the top, in proportion to the values", () => {
    const g = geo(render(`state rows=[{k: "A", v: 1}, {k: "B", v: 3}]\nchart kind=pie items=rows x=k y=v\n`));
    const [a, b] = g.pie!.slices;
    expect(a!.start).toBe(0);
    expect(a!.end).toBeCloseTo(Math.PI / 2);
    expect(b!.end).toBe(Math.PI * 2);
    expect(g.pie!.inner).toBe(0);
  });

  it("puts the formatted total in a donut's middle", () => {
    const g = geo(render(SPECS.donut!));
    expect(g.pie!.inner).toBeGreaterThan(0);
    expect(g.pie!.center!.text).toBe("$10,000");
    expect(g.pie!.center!.caption).toBe("Total");
  });

  it("shows a plain message for a negative value or a zero total", () => {
    const neg = render(SPECS["pie with a negative value"]!);
    expect(geo(neg).message).toBe("Pie charts can't show negative values");
    expect(neg.warnings.some((w) => /use kind=bar/i.test(w))).toBe(true);
    expect(geo(render(`state rows=[{k: "A", v: 0}]\nchart kind=donut items=rows x=k y=v\n`)).message).toBe("Every value is 0, so there's nothing to chart");
  });

  it("draws one full slice for a single item, with no separator", () => {
    const ui = render(`state rows=[{k: "A", v: 5}]\nchart kind=donut items=rows x=k y=v\n`);
    expect(geo(ui).pie!.slices).toHaveLength(1);
    expect(ui.drawOps.some((o) => o.op === "stroke" && o.strokeStyle === lightTheme.colors.surface)).toBe(false);
  });
});

describe.each(Object.entries(SPECS))("%s", (_name, spec) => {
  it.each(WIDTHS)("fits its box at %ipx, with no text outside it", (width) => {
    const ui = render(spec, { width });
    expect(ui.diagnostics).toEqual([]);
    expectInside(ui);
    expect(textOverflows(ui.loom.boxes!, ui.drawOps)).toEqual([]);
    walkBoxes(ui.loom.boxes!, (b) => { for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v)).toBe(true); });
    ui.destroy();
  });

  it.each([lightTheme, darkTheme].map((t) => [t.name, t] as const))("paints only theme colors in %s", (_n, theme: Theme) => {
    const ui = render(spec, { theme });
    const palette = new Set<string>(Object.values(theme.colors));
    for (const op of ui.drawOps) expect(palette.has(op.fillStyle || op.strokeStyle)).toBe(true);
    ui.destroy();
  });

  it("parses at every line-boundary prefix", () => {
    const lines = spec.split("\n");
    for (let k = 0; k <= lines.length; k++) {
      const prefix = lines.slice(0, k).join("\n") + (k ? "\n" : "");
      expect(() => parse(prefix, registry)).not.toThrow();
      expect(parse(prefix, registry).diagnostics).toEqual([]);
      render(prefix).destroy();
    }
  });
});

describe("series colors in the theme", () => {
  it("has 6 per mode, with the accent first", () => {
    for (const t of [lightTheme, darkTheme]) {
      const s = seriesColors(t);
      expect(s).toHaveLength(6);
      expect(new Set(s).size).toBe(6);
      expect(s[0]).toBe(t.colors.accent);
    }
  });

  it("can be overridden from CSS as --loom-series-N", () => {
    expect(cssVarOf("series1")).toBe("--loom-series-1");
    expect(cssVarOf("series6")).toBe("--loom-series-6");
    expect(cssVarOf("landHover")).toBe("--loom-land-hover");
    expect(cssVarOf("accent")).toBe("--loom-accent");
  });

  it("keeps series 1 on the accent when only the accent changes", () => {
    expect(extendTheme(lightTheme, { colors: { accent: "#6D28D9" } }).colors.series1).toBe("#6D28D9");
    expect(extendTheme(lightTheme, { colors: { accent: "#6D28D9", series1: "#111111" } }).colors.series1).toBe("#111111");
  });
});
