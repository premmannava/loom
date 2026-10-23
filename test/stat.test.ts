/**
 * stat's change, trend and sparkline: how a figure moved, colored by whether
 * that's good news, and a small line of its recent values.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { changeDirection, SPARK_H, stat } from "../src/components/content";
import type { PaintContext } from "../src/component";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import type { Box } from "../src/types";

const registry = new Registry(coreComponents);
const c = lightTheme.colors;

const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
const textOp = (ui: ReturnType<typeof render>, t: string) => ui.drawOps.find((o) => o.op === "fillText" && String(o.args[0]) === t);

describe("stat props", () => {
  it("parses change, trend, good and spark with no diagnostics", () => {
    const r = parse(`state w=[1, 2, 3]\nstat label="Revenue" value="$12K" change="+12%" trend=up good=up spark=w\nstat label="Costs" value=3 change={"-" + 2} good=down spark={[3, 2, 1]}\n`, registry);
    expect(r.diagnostics).toEqual([]);
  });

  it("warns about trend and good values it doesn't know, and keeps the element", () => {
    const r = parse(`stat label="A" value=1 trend=sideways good=left\n`, registry);
    expect(r.diagnostics.length).toBe(2);
    expect(r.diagnostics.every((d) => d.severity === "warning")).toBe(true);
    expect(r.diagnostics[0]!.message).toContain("up, down");
    expect(r.root.children).toHaveLength(1);
  });
});

describe("changeDirection", () => {
  it("reads the sign of the first number", () => {
    expect(changeDirection("+12%")).toBe("up");
    expect(changeDirection("12%")).toBe("up");
    expect(changeDirection("-8%")).toBe("down");
    expect(changeDirection("−8%")).toBe("down");
    expect(changeDirection("-$1,200")).toBe("down");
    expect(changeDirection("0%")).toBe("flat");
    expect(changeDirection("same as last week")).toBe(null);
  });
});

describe("stat layout", () => {
  const heights = (spec: string) => [240, 360, 600].map((width) => {
    const ui = render(spec, { width });
    const h = ui.find("stat").box!.h;
    ui.destroy();
    return h;
  });

  it("keeps its old size when none of the new props are used", () => {
    // 54 px: a one-line label and a value at full size (see statLayout).
    expect(heights(`stat label="Revenue" value="$12,400"\n`)).toEqual([54, 54, 54]);
  });

  it("puts a short change beside the value, so it's no taller", () => {
    expect(heights(`stat label="Revenue" value="$12,400" change="+12%"\n`)).toEqual([54, 54, 54]);
    const ui = render(`stat label="Revenue" value="$12,400" change="+12%"\n`);
    expect(texts(ui)).toContain("▲ +12%");
    const value = textOp(ui, "$12,400")!, change = textOp(ui, "▲ +12%")!;
    expect(change.args[2]).toBe(value.args[2]);
    expect(Number(change.args[1])).toBeGreaterThan(Number(value.args[1]));
    ui.destroy();
  });

  it("wraps a change below the value when there isn't room, and cuts it to fit", () => {
    const spec = `stat label="Revenue" value="$1,234,567.89" change="+12% on last quarter, the best since records began"\n`;
    for (const width of [240, 360]) {
      const ui = render(spec, { width });
      const box = ui.find("stat").box!;
      expect(box.h).toBeGreaterThan(54);
      const change = ui.drawOps.find((o) => o.op === "fillText" && String(o.args[0]).startsWith("▲"))!;
      expect(Number(change.args[2])).toBeGreaterThan(Number(textOp(ui, "$1,234,567.89")!.args[2]));
      ui.destroy();
    }
  });

  it("makes room for a sparkline under the value", () => {
    const [a, b, w] = heights(`stat label="Revenue" value="$12,400" spark={[3, 5, 4, 8]}\n`);
    expect(a).toBe(54 + lightTheme.space.sm + SPARK_H);
    expect(b).toBe(a);
    expect(w).toBe(a);
  });

  it("fits every part inside its box at 240, 360 and 600 px", () => {
    const spec = `stat label="Monthly recurring revenue" value="$1,234,567.89" change="-3.2% on last month" good=down spark={[5, 4, 6, 3, 2]}\n`;
    for (const width of [240, 360, 600]) {
      const ui = render(spec, { width });
      const box = ui.find("stat").box!;
      for (const o of ui.drawOps.filter((d) => d.op === "fillText")) {
        const ty = Number(o.args[2]);
        expect(ty).toBeLessThanOrEqual(box.y + box.h);
        expect(ty).toBeGreaterThan(box.y);
      }
      ui.destroy();
    }
  });
});

describe("stat colors", () => {
  it("colors a rise good and a fall bad", () => {
    const ui = render(`stat label="A" value=1 change="+4%"\nstat label="B" value=1 change="-4%"\n`);
    expect(textOp(ui, "▲ +4%")!.fillStyle).toBe(c.good);
    expect(textOp(ui, "▼ -4%")!.fillStyle).toBe(c.bad);
    ui.destroy();
  });

  it("flips them with good=down, for costs and churn", () => {
    const ui = render(`stat label="Costs" value=1 change="-4%" good=down\nstat label="Churn" value=1 change="+1%" good=down\n`);
    expect(textOp(ui, "▼ -4%")!.fillStyle).toBe(c.good);
    expect(textOp(ui, "▲ +1%")!.fillStyle).toBe(c.bad);
    ui.destroy();
  });

  it("takes the direction from trend= when it's given, and draws flat with no arrow in muted", () => {
    const ui = render(`stat label="A" value=1 change="4 days" trend=down\nstat label="B" value=1 change="no change" trend=flat\nstat label="C" value=1 change="0%"\n`);
    expect(textOp(ui, "▼ 4 days")!.fillStyle).toBe(c.bad);
    expect(textOp(ui, "no change")!.fillStyle).toBe(c.muted);
    expect(textOp(ui, "0%")!.fillStyle).toBe(c.muted);
    ui.destroy();
  });

  it("draws the sparkline in the trend's color, or the accent without one", () => {
    const ui = render(`stat label="A" value=1 change="+4%" spark={[1, 2, 3]}\nstat label="B" value=1 spark={[1, 2, 3]}\n`);
    const strokes = ui.drawOps.filter((o) => o.op === "stroke").map((o) => o.strokeStyle);
    expect(strokes).toEqual([c.good, c.accent]);
    ui.destroy();
  });

  it("uses theme colors only, in dark mode too", () => {
    const ui = render(`stat label="A" value=1 change="+4%" spark={[1, 2, 3]}\n`, { theme: darkTheme });
    const palette = new Set<string>(Object.values(darkTheme.colors));
    for (const op of ui.drawOps) expect(palette.has(op.fillStyle || op.strokeStyle), op.op).toBe(true);
    ui.destroy();
  });
});

describe("stat sparkline data", () => {
  it("draws nothing, and warns, when spark isn't a list of numbers", () => {
    const ui = render(`stat label="A" value=1 spark=5\nstat label="B" value=1 spark={[1, "x", 3]}\n`);
    expect(ui.warnings.some((w) => w.includes("spark should be a list of numbers"))).toBe(true);
    expect(ui.warnings.some((w) => w.includes("1 entries that aren't numbers"))).toBe(true);
    // B still has two numbers to join.
    expect(ui.drawOps.filter((o) => o.op === "stroke")).toHaveLength(1);
    ui.destroy();
  });

  it("draws a flat line in the middle for constant values", () => {
    const ui = render(`stat label="A" value=1 spark={[5, 5, 5]}\n`);
    const box = ui.find("stat").box!;
    const d = box.data as { spark: { points: Array<{ y: number }>; y: number; h: number } };
    expect(new Set(d.spark.points.map((p) => p.y)).size).toBe(1);
    expect(d.spark.points[0]!.y).toBeCloseTo(d.spark.y + d.spark.h / 2);
    ui.destroy();
  });
});

describe("stat while loading", () => {
  const SPEC = `stat label="Revenue" value={money(sum(sales, 'revenue'))} change="{growth}%" spark={weekly}\n`;

  it("draws placeholders for the value, the change and the sparkline", () => {
    const plain = render(`stat label="Revenue" value={money(sum(sales, 'revenue'))}\n`);
    plain.loom.setLoading(["sales"]);
    plain.loom.renderNow();
    const plainFills = plain.drawOps.filter((o) => o.op === "fill").length;
    plain.destroy();

    const ui = render(SPEC);
    ui.loom.setLoading(["sales", "growth", "weekly"]);
    ui.loom.renderNow();
    expect(texts(ui)).toEqual(["REVENUE"]);
    // One placeholder path, holding the value, the change and the line's area.
    expect(ui.drawOps.filter((o) => o.op === "fill").length).toBe(plainFills);
    expect(ui.drawOps.filter((o) => o.op === "stroke")).toHaveLength(0);
    expect(ui.warnings).toEqual([]);
    const loadingH = ui.find("stat").box!.h;
    ui.loom.state.set("sales", [{ revenue: 10 }]);
    ui.loom.state.set("growth", 4);
    ui.loom.state.set("weekly", [1, 3, 2]);
    ui.loom.setLoading([]);
    ui.loom.renderNow();
    expect(texts(ui)).toEqual(expect.arrayContaining(["$10.00", "▲ 4%"]));
    expect(ui.find("stat").box!.h).toBe(loadingH);
    ui.destroy();
  });

  it("runs the sparkline in from the left as the data arrives", () => {
    const ui = render(`stat label="A" value=1 spark={[1, 3, 2]}\n`);
    const box = ui.find("stat").box!;
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const g = new Proxy(ui.canvas.getContext("2d")!, {
      get(target, prop) {
        const v = Reflect.get(target, prop) as unknown;
        if (typeof v !== "function" || typeof prop !== "string") return v;
        return (...args: unknown[]) => { calls.push({ name: prop, args }); return (v as (...a: unknown[]) => unknown)(...args); };
      },
      set(target, prop, value) { return Reflect.set(target, prop, value); },
    });
    const engine = ui.loom as unknown as { paintContext(g: CanvasRenderingContext2D): PaintContext };
    const ctx = { ...engine.paintContext(g), reveal: () => 0.3 };
    stat.paint!(box as Box, ctx);
    const clip = calls.find((k) => k.name === "rect");
    expect(clip).toBeDefined();
    const d = box.data as { spark: { w: number } };
    const clipW = Number(clip!.args[2]);
    expect(clipW).toBeGreaterThan(0);
    expect(clipW).toBeLessThan(d.spark.w);
    expect(calls.some((k) => k.name === "clip")).toBe(true);
    // Fully revealed: no clip.
    calls.length = 0;
    stat.paint!(box as Box, { ...ctx, reveal: () => 1 });
    expect(calls.some((k) => k.name === "clip")).toBe(false);
    ui.destroy();
  });
});
