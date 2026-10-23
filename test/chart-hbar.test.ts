/**
 * Horizontal bars (chart kind=hbar): rankings with long labels, one row per
 * item in list order, values at the ends of the bars.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { chart, HBAR_LABEL_SHARE, hbarRows, MAX_CHART_ITEMS, MAX_HBAR_HEIGHT, type ChartGeometry } from "../src/components/chart";
import type { PaintContext } from "../src/component";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { monoWidth, render, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const c = lightTheme.colors;
const geo = (ui: Rendered): ChartGeometry => ui.find("chart").box!.data as ChartGeometry;
const texts = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
const rowsOf = (n: number, f: (i: number) => number = (i) => (i + 1) * 10) =>
  `[${Array.from({ length: n }, (_v, i) => `{name: "Item ${i + 1}", v: ${f(i)}}`).join(", ")}]`;
const hbar = (rows: string, extra = "", width = 600) => render(`state rows=${rows}\nchart "Top" kind=hbar items=rows x=name y=v ${extra}\n`, { width });

const ARTISTS = `[{name: "Led Zeppelin", sales: 4200, last: 3900}, {name: "The Rolling Stones and Friends Live at the Garden", sales: 3100, last: 3300}, {name: "Queen", sales: 2600, last: 2000}]`;

describe("hbar props", () => {
  it("accepts the same props as bar, with no problems", () => {
    const r = parse(`state a=${ARTISTS}\nchart "Top" kind=hbar items={take(sort(a, 'sales', 'desc'), 10)} x=name y=sales,last labels="This year,Last year" format=money\n`, registry);
    expect(r.diagnostics).toEqual([]);
  });

  it("checks series and labels like bar", () => {
    const msgs = (spec: string) => parse(`state a=${ARTISTS}\n${spec}\n`, registry).diagnostics.map((d) => d.message);
    expect(msgs(`chart kind=hbar items=a x=name y=a,b,c,d,e,f,g`)[0]).toMatch(/at most 6 series/);
    expect(msgs(`chart kind=hbar items=a x=name y=sales,last labels="One"`)[0]).toMatch(/labels has 1 names for 2 y fields/);
  });

  it("is taught in the model guide", async () => {
    const { languageGuide } = await import("../src/prompt");
    const guide = languageGuide(registry);
    expect(guide).toContain("hbar draws the bars across");
    expect(guide).toContain("kind=<bar|hbar|line|pie|donut>");
  });
});

describe("hbar layout", () => {
  it("draws one row per item, top to bottom in list order, with the value at the end of each bar", () => {
    const ui = hbar(`[{name: "B", v: 5}, {name: "A", v: 20}, {name: "C", v: 10}]`);
    const d = geo(ui);
    expect(d.slots.map((s) => s.label)).toEqual(["B", "A", "C"]);
    const ys = d.slots.map((s) => s.cy!);
    expect(ys[0]!).toBeLessThan(ys[1]!);
    expect(ys[1]!).toBeLessThan(ys[2]!);
    // Bar lengths follow the values, all from the same zero line.
    const ws = d.slots.map((s) => s.bar!.w);
    expect(ws[1]! / ws[0]!).toBeCloseTo(4);
    expect(new Set(d.slots.map((s) => s.bar!.x)).size).toBe(1);
    for (const s of d.slots) {
      const v = s.valueLabels![0]!;
      expect(v.align).toBe("left");
      expect(v.x).toBeGreaterThan(s.bar!.x + s.bar!.w);
    }
    expect(texts(ui)).toEqual(["Top", "B", "A", "C", "5", "20", "10"]);
    ui.destroy();
  });

  it("grows taller with each item, by a row height from the theme", () => {
    const h = (n: number) => { const ui = hbar(rowsOf(n)); const v = ui.find("chart").box!.h; ui.destroy(); return v; };
    const { rowH } = hbarRows(lightTheme, 1);
    expect(h(5) - h(4)).toBe(rowH);
    expect(h(12) - h(4)).toBe(8 * rowH);
  });

  it("keeps labels to about 40% of the width and cuts longer ones with an ellipsis", () => {
    for (const width of [240, 360, 600]) {
      const ui = render(`state a=${ARTISTS}\nchart "Top" kind=hbar items=a x=name y=sales format=money\n`, { width });
      const d = geo(ui);
      expect(d.plot.x).toBeLessThanOrEqual(width * HBAR_LABEL_SHARE + lightTheme.space.sm + 1);
      const long = d.slots[1]!;
      expect(long.shownLabel!.endsWith("…")).toBe(true);
      expect(monoWidth(long.shownLabel!, d.labelFont)).toBeLessThanOrEqual(width * HBAR_LABEL_SHARE + 1);
      // Every bar and value stays inside the box.
      for (const s of d.slots) {
        expect(s.bar!.x + s.bar!.w).toBeLessThanOrEqual(width);
        const v = s.valueLabels![0]!;
        expect(v.x + monoWidth(v.text, d.labelFont)).toBeLessThanOrEqual(width + 0.5);
      }
      expect(ui.diagnostics).toEqual([]);
      ui.destroy();
    }
  });

  it("extends negative values left of a zero line, with their values on the left", () => {
    const ui = hbar(`[{name: "Gain", v: 30}, {name: "Loss", v: -10}]`);
    const d = geo(ui);
    const [gain, loss] = d.slots;
    expect(gain!.bar!.x).toBeCloseTo(d.zeroX!);
    expect(loss!.bar!.x + loss!.bar!.w).toBeCloseTo(d.zeroX!);
    expect(gain!.bar!.w / loss!.bar!.w).toBeCloseTo(3);
    const v = loss!.valueLabels![0]!;
    expect(v.align).toBe("right");
    expect(v.x).toBeLessThan(loss!.bar!.x);
    expect(v.x).toBeGreaterThan(d.plot.x);
    // The zero line is stronger when values go both ways.
    expect(ui.drawOps.some((o) => o.op === "stroke" && o.strokeStyle === c.muted)).toBe(true);
    ui.destroy();
  });

  it("draws grouped series side by side in each row, with a legend", () => {
    const ui = render(`state a=${ARTISTS}\nchart "Top" kind=hbar items=a x=name y=sales,last labels="This year,Last year"\n`);
    const d = geo(ui);
    for (const s of d.slots) {
      const [a, b] = s.bars!;
      expect(b!.y).toBeGreaterThan(a!.y + a!.h);
      expect(s.valueLabels!.filter(Boolean)).toHaveLength(2);
    }
    expect(d.legend.map((l) => l.label)).toEqual(["This year", "Last year"]);
    const fills = ui.drawOps.filter((o) => o.op === "fill").map((o) => o.fillStyle);
    expect(fills).toEqual(expect.arrayContaining([c.series1, c.series2]));
    ui.destroy();
  });

  it("leaves gaps for items without a number, and says so", () => {
    const ui = hbar(`[{name: "A", v: 3}, {name: "B"}, {name: "C", v: 2}]`);
    const d = geo(ui);
    expect(d.slots[1]!.bars).toEqual([null]);
    expect(ui.warnings.some((w) => w.includes("1 of 3 items have no number"))).toBe(true);
    ui.destroy();
  });

  it("shows a message suggesting take() when the rows would be too tall", () => {
    const { rowH } = hbarRows(lightTheme, 1);
    const fits = Math.floor(MAX_HBAR_HEIGHT / rowH);
    const ok = hbar(rowsOf(fits));
    expect(geo(ok).message).toBeUndefined();
    ok.destroy();
    const ui = hbar(rowsOf(fits + 1));
    expect(geo(ui).message).toBe(`Too many rows to chart: at most ${fits}. Show the top ones with take()`);
    expect(ui.warnings.some((w) => w.includes("take(sort("))).toBe(true);
    ui.destroy();
  });

  it("respects MAX_CHART_ITEMS like every chart", () => {
    const ui = hbar(rowsOf(MAX_CHART_ITEMS + 1));
    expect(geo(ui).message).toBe(`Too many items to chart: at most ${MAX_CHART_ITEMS}`);
    ui.destroy();
  });

  it("has fewer rows to fit with more series, since each row is taller", () => {
    expect(hbarRows(lightTheme, 3).rowH).toBeGreaterThan(hbarRows(lightTheme, 1).rowH);
  });

  it("says so when the bars have no room beside their labels and values", () => {
    const ui = render(`state rows=[{name: "A rather long name", v: 123456789012}]\nrow\n  chart "T" kind=hbar items=rows x=name y=v format=money\n`, { width: 120 });
    expect(geo(ui).message).toBe("Too narrow to chart these values");
    ui.destroy();
  });

  it("uses theme colors only, in dark mode too", () => {
    const ui = render(`state a=${ARTISTS}\nchart "Top" kind=hbar items=a x=name y=sales,last\n`, { theme: darkTheme });
    const palette = new Set<string>(Object.values(darkTheme.colors));
    for (const op of ui.drawOps) expect(palette.has(op.fillStyle || op.strokeStyle), op.op).toBe(true);
    ui.destroy();
  });
});

describe("hbar while loading", () => {
  it("draws rows of label pills and bars, then the real chart", () => {
    // As a chat app does it: the names first, then the spec.
    const ui = render("");
    ui.loom.setLoading(["artists"]);
    ui.loom.setSpec(`chart "Top artists" kind=hbar items=artists x=name y=sales\n`);
    ui.loom.renderNow();
    const d = geo(ui);
    expect(d.loading).toEqual({ series: 1 });
    expect(texts(ui)).toEqual(["Top artists"]);
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === c.line)).toBe(true);
    expect(ui.warnings).toEqual([]);
    ui.loom.state.set("artists", [{ name: "Queen", sales: 3 }, { name: "Abba", sales: 2 }]);
    ui.loom.setLoading([]);
    ui.loom.renderNow();
    expect(texts(ui)).toEqual(expect.arrayContaining(["Queen", "Abba", "3", "2"]));
    ui.destroy();
  });

  it("grows the bars from the left in a wave on reveal", () => {
    const ui = hbar(rowsOf(4, () => 10));
    const box = ui.find("chart").box!;
    const widths: number[] = [];
    const engine = ui.loom as unknown as { paintContext(g: CanvasRenderingContext2D): PaintContext };
    const base = engine.paintContext(ui.canvas.getContext("2d")!);
    const at = (reveal: number) => {
      widths.length = 0;
      chart.paint!(box, { ...base, reveal: () => reveal, roundRect: (_x, _y, w) => { widths.push(w); } });
      return [...widths];
    };
    const full = at(1);
    expect(full).toHaveLength(4);
    const mid = at(0.5);
    // Every bar starts at the zero line; earlier rows are further along.
    for (let i = 0; i < mid.length; i++) expect(mid[i]!).toBeLessThanOrEqual(full[i]! + 1e-6);
    expect(mid[0]!).toBeGreaterThan(mid[mid.length - 1]!);
    expect(at(0)).toHaveLength(0);
    ui.destroy();
  });
});

describe("the dashboard answer sample", () => {
  it("uses stat with change and spark, callout and hbar, with no diagnostics or warnings", async () => {
    const { samples } = await import("../playground/samples");
    const spec = samples.dashboardAnswer!.spec;
    for (const width of [360, 600]) {
      const ui = render(spec, { width });
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
      expect(ui.findAll("callout")).toHaveLength(2);
      expect(ui.findAll("chart").map((c) => (c.box!.data as ChartGeometry).message)).toEqual([undefined, undefined]);
      expect(texts(ui)).toEqual(expect.arrayContaining(["▲ +12%", "▼ -6%", "Rock is 47% of revenue", "Iron Maiden"]));
      ui.destroy();
    }
  });
});
