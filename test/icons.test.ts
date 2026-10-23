/** SayShape's own icons, the icon element, and icon= on text and list-item. */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { ICON_NAMES, ICONS, drawIcon, isIconName, nearestIcon } from "../src/icons";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { createRecordingContext } from "../src/testing/canvas";
import { render } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const warnings = (spec: string) => parse(spec, registry).diagnostics.map((d) => d.message);

describe("the icon set", () => {
  it("draws every icon in the color it's given and nothing else, inside its square", () => {
    for (const name of ICON_NAMES) {
      const { context, take } = createRecordingContext();
      drawIcon(context, name, 0, 0, 24, lightTheme.colors.ink);
      const ops = take();
      expect(ops.length, name).toBeGreaterThan(0);
      for (const op of ops) expect(op.fillStyle || op.strokeStyle, name).toBe(lightTheme.colors.ink);
    }
  });

  it("keeps every coordinate on the 24×24 grid, with room for the stroke", () => {
    for (const [name, shapes] of Object.entries(ICONS)) {
      for (const shape of shapes) {
        const nums = (shape.match(/-?\d*\.?\d+/g) ?? []).map(Number);
        // Arcs end with angles in degrees, which can be outside the grid.
        const coords = shape.startsWith("A") ? nums.slice(0, 3) : nums;
        for (const n of coords) expect(n >= 0 && n <= 24, `${name}: ${shape}`).toBe(true);
      }
    }
  });

  it("finds the icon a model probably meant", () => {
    expect(nearestIcon("tick")).toBe("check");
    expect(nearestIcon("Flight")).toBe("plane");
    expect(nearestIcon("trending-up")).toBe("trend-up");
    expect(nearestIcon("constructor")).toBe(null);
    expect(isIconName("constructor")).toBe(false);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});

describe("the icon element", () => {
  it("shows a known icon at its size, and warns about an unknown one with the nearest", () => {
    expect(warnings(`icon name=plane size=lg\n`)).toEqual([]);
    const w = warnings(`icon name=tick\n`);
    expect(w[0]).toMatch(/name="tick" isn't an icon\. Did you mean name=check\? Icons: check, check-circle/);
    const ui = render(`icon name=plane size=lg tone=muted\n`);
    expect(ui.find("icon").box!.h).toBe(28);
    expect(ui.drawOps.every((o) => (o.fillStyle || o.strokeStyle) === lightTheme.colors.muted)).toBe(true);
    ui.destroy();
  });
});

describe("icon= on text and list-item", () => {
  it("starts the text with the icon in its tone, and keeps the words to its right", () => {
    const ui = render(`text "Payment received" icon=check-circle tone=good\n`, { theme: darkTheme });
    const strokes = ui.drawOps.filter((o) => o.op === "stroke");
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((o) => o.strokeStyle === darkTheme.colors.good)).toBe(true);
    const label = ui.drawOps.find((o) => o.op === "fillText")!;
    const box = ui.find("text").box!;
    expect(Number(label.args[1])).toBeGreaterThan(box.x + 16);
    ui.destroy();
  });

  it("wraps text in the room left beside the icon", () => {
    const long = "A long line that has to wrap well before the edge of a narrow column";
    const plain = render(`text "${long}"\n`, { width: 240 });
    const iconed = render(`text "${long}" icon=info\n`, { width: 240 });
    expect(iconed.find("text").box!.h).toBeGreaterThanOrEqual(plain.find("text").box!.h);
    plain.destroy();
    iconed.destroy();
  });

  it("puts an accent icon at the start of a list row", () => {
    const ui = render(`list\n  list-item "Shipped" detail="Arrives Friday" icon=truck\n`);
    expect(ui.drawOps.some((o) => o.op === "stroke" && o.strokeStyle === lightTheme.colors.accent)).toBe(true);
    expect(warnings(`list\n  list-item "Shipped" icon=lorry\n`)[0]).toMatch(/icon="lorry" isn't an icon/);
    ui.destroy();
  });

  it("ignores an unknown icon on screen: the words show as usual", () => {
    const ui = render(`text "Hello" icon=nope\n`);
    expect(ui.drawOps.filter((o) => o.op === "stroke")).toEqual([]);
    expect(ui.drawOps.find((o) => o.op === "fillText")!.args[0]).toBe("Hello");
    ui.destroy();
  });
});
