import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { callout } from "../../src/components/callout";
import type { PaintContext } from "../../src/component";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";
import { darkTheme, lightTheme } from "../../src/theme";

// The contract tests (test/contract.test.ts) already check the definition,
// layout bounds at three widths, theme-only colors and keyboard reach.
// Test what's specific to callout here.

const registry = new Registry(coreComponents);
const c = lightTheme.colors;
const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("callout", () => {
  it("renders its example without diagnostics", () => {
    const ui = render(`${callout.example}\n`);
    expect(ui.diagnostics).toEqual([]);
    expect(texts(ui)).toEqual(["Rock is 47% of revenue", "Up from 41% last year"]);
    ui.destroy();
  });

  it("parses every tone, and accent as another name for info", () => {
    for (const tone of ["info", "accent", "good", "warn", "bad"]) {
      expect(parse(`callout "A" tone=${tone}\n`, registry).diagnostics).toEqual([]);
    }
  });

  it("warns about bad prop values but keeps the element", () => {
    const r = parse(`callout "A" tone=loud colour=red\n`, registry);
    expect(r.diagnostics.length).toBe(2);
    expect(r.diagnostics.every((d) => d.severity === "warning")).toBe(true);
    expect(r.root.children).toHaveLength(1);
  });

  it("needs its text", () => {
    const r = parse(`callout tone=good\n`, registry);
    expect(r.diagnostics.some((d) => d.message.includes("callout"))).toBe(true);
  });

  it("wraps long text and grows taller at narrow widths, keeping every line inside", () => {
    const spec = `callout "Revenue from rock grew faster than every other genre in the last four quarters" detail="Based on 2,410 invoices from January to December" icon=true\n`;
    const hs = [240, 360, 600].map((width) => {
      const ui = render(spec, { width });
      const box = ui.find("callout").box!;
      for (const o of ui.drawOps.filter((d) => d.op === "fillText")) {
        expect(Number(o.args[1])).toBeGreaterThan(box.x);
        expect(Number(o.args[2])).toBeLessThan(box.y + box.h);
      }
      ui.destroy();
      return box.h;
    });
    expect(hs[0]).toBeGreaterThan(hs[1]!);
    expect(hs[1]).toBeGreaterThanOrEqual(hs[2]!);
  });

  it("draws the text in ink, the detail in muted, and the bar and tint in the tone's color", () => {
    const ui = render(`callout "Watch costs" detail="Up 8%" tone=warn\n`);
    const ops = ui.drawOps;
    expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Watch costs")!.fillStyle).toBe(c.ink);
    expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Up 8%")!.fillStyle).toBe(c.muted);
    const tint = ops.find((o) => o.op === "fill")!;
    expect(tint.fillStyle).toBe(c.warn);
    expect(tint.globalAlpha).toBeLessThan(1);
    expect(ops.find((o) => o.op === "fillRect")!.fillStyle).toBe(c.warn);
    ui.destroy();
  });

  it("is a little taller with an icon only when the text is shorter than it", () => {
    const plain = render(`callout "A"\n`), icon = render(`callout "A" icon=true\n`);
    expect(icon.find("callout").box!.h).toBeGreaterThanOrEqual(plain.find("callout").box!.h);
    // The icon's circle, in the tone's color.
    expect(icon.drawOps.filter((o) => o.op === "fill" && o.fillStyle === c.accent && o.globalAlpha === 1)).toHaveLength(1);
    plain.destroy();
    icon.destroy();
  });

  it("draws an icon for every tone, in theme colors only", () => {
    for (const tone of ["info", "good", "warn", "bad"]) {
      const ui = render(`callout "A" tone=${tone} icon=true\n`, { theme: darkTheme });
      const palette = new Set<string>(Object.values(darkTheme.colors));
      for (const op of ui.drawOps) expect(palette.has(op.fillStyle || op.strokeStyle), `${tone} ${op.op}`).toBe(true);
      ui.destroy();
    }
  });

  it("is not pressable", () => {
    const ui = render(`callout "A"\n`);
    expect(ui.hits).toEqual([]);
    ui.destroy();
  });
});

describe("callout while loading", () => {
  const SPEC = `callout "Best month: {first(sort(sales, 'revenue', 'desc')).month}" detail="From {len(sales)} months" icon=true\n`;

  it("keeps its panel and draws placeholders for the words", () => {
    const ui = render(SPEC);
    ui.loom.setLoading(["sales"]);
    ui.loom.renderNow();
    expect(texts(ui)).toEqual([]);
    expect(ui.warnings).toEqual([]);
    // The tint and the bar are real; the text, detail and icon are one placeholder.
    expect(ui.drawOps.find((o) => o.op === "fillRect")!.fillStyle).toBe(c.accent);
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === c.line)).toBe(true);
    const loadingH = ui.find("callout").box!.h;
    ui.loom.state.set("sales", [{ month: "Jan", revenue: 3 }, { month: "Feb", revenue: 5 }]);
    ui.loom.setLoading([]);
    ui.loom.renderNow();
    expect(texts(ui)).toEqual(["Best month: Feb", "From 2 months"]);
    expect(ui.find("callout").box!.h).toBe(loadingH);
    ui.destroy();
  });

  it("fades its words in as the data arrives", () => {
    const ui = render(`callout "A"\n`);
    const box = ui.find("callout").box!;
    const engine = ui.loom as unknown as { paintContext(g: CanvasRenderingContext2D): PaintContext };
    const ctx = engine.paintContext(ui.canvas.getContext("2d")!);
    ui.canvas.takeDrawOps();
    callout.paint!(box, { ...ctx, reveal: () => 0.1 });
    const early = ui.canvas.takeDrawOps().find((o) => o.op === "fillText")!;
    expect(early.globalAlpha).toBeGreaterThan(0);
    expect(early.globalAlpha).toBeLessThan(1);
    callout.paint!(box, { ...ctx, reveal: () => 1 });
    expect(ui.canvas.takeDrawOps().find((o) => o.op === "fillText")!.globalAlpha).toBe(1);
    ui.destroy();
  });
});
