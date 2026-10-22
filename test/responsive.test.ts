/**
 * Narrow screens: rows move children onto more lines when they don't fit,
 * grids keep columns wide enough, and text wraps, shrinks or ends with "…"
 * instead of running past its element or being squeezed. Each spec here is
 * the kind of thing a model writes for a phone or a chat column.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { shareWidths } from "../src/components/util";
import { render } from "../src/testing";
import type { Box } from "../src/types";
import { walkBoxes } from "../src/layout";
import { textOverflows } from "./overflow";

const boxes = (root: Box, type: string) => {
  const out: Box[] = [];
  walkBoxes(root, (b) => { if (b.node.type === type) out.push(b); });
  return out;
};

const STRESS: Record<string, string> = {
  "long stat values in a row": `card
  row
    stat label="Total revenue this financial year" value="$12,345,678.90"
    stat label="Orders" value="1,234,567"`,
  "steppers with labels side by side": `state hikers=3 days=2
card
  row
    stepper "Number of hikers" bind=hikers min=1
    stepper "Days on the trail" bind=days min=1`,
  "long button labels": `row
  button "Continue to secure checkout and payment" on=emit:pay
  button "Go back to the shopping cart" variant=secondary on=emit:back`,
  "long check, radio and switch labels": `state a=false b="x" c=true
column
  check "I agree to the terms and conditions and the privacy policy of this service" bind=a
  radio "Express shipping with tracking and signature on delivery" bind=b value=x
  switch "Send me order updates and occasional offers by email" bind=c`,
  "a stat with one enormous unbroken value": `stat label="ID" value="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"`,
  "badges, links and an avatar": `row
  badge "Awaiting confirmation from the warehouse" tone=warn
  link "Read the full delivery and returns policy" on=emit:policy
  avatar "Alexandria Ocasio-Cortez Montgomery" detail="Regional operations manager, North America"`,
  "fields and a slider with long labels": `state q="" price=40
column
  input "Search across every product, brand and category" bind=q
  slider "Maximum price you're willing to pay per night: \${price}" bind=price min=0 max=500`,
};

describe.each(Object.entries(STRESS))("%s", (_name, spec) => {
  it.each([240, 320, 480])("fits at %ipx", (width) => {
    const ui = render(spec, { components: coreComponents, width });
    expect(ui.loom.diagnostics).toEqual([]);
    expect(textOverflows(ui.loom.boxes!, ui.drawOps)).toEqual([]);
    ui.destroy();
  });
});

describe("rows", () => {
  const spec = `state a=1 b=2
row
  stepper "Hikers" bind=a
  stepper "Days" bind=b`;

  it("keep small stats on one line", () => {
    const ui = render(`row
  stat label="Days" value=2
  stat label="Hikers" value=3
  stat label="Water (L)" value=18`, { components: coreComponents, width: 375 });
    expect(new Set(boxes(ui.loom.boxes!, "stat").map((b) => b.y)).size).toBe(1);
    ui.destroy();
  });

  it("keep children side by side when they fit, in equal shares as before", () => {
    const ui = render(spec, { components: coreComponents, width: 600 });
    const [s1, s2] = boxes(ui.loom.boxes!, "stepper");
    expect(s1!.y).toBe(s2!.y);
    expect(s1!.w).toBeCloseTo(s2!.w);
    ui.destroy();
  });

  it("move children onto the next line when they don't fit", () => {
    const ui = render(spec, { components: coreComponents, width: 320 });
    const [s1, s2] = boxes(ui.loom.boxes!, "stepper");
    expect(s2!.y).toBeGreaterThan(s1!.y);
    // Alone on its line, each stepper gets the row's whole width.
    expect(s1!.w).toBeCloseTo(boxes(ui.loom.boxes!, "row")[0]!.w);
    ui.destroy();
  });

  it("stay on one line with wrap=false", () => {
    const ui = render(spec.replace("row", "row wrap=false"), { components: coreComponents, width: 320 });
    const [s1, s2] = boxes(ui.loom.boxes!, "stepper");
    expect(s1!.y).toBe(s2!.y);
    ui.destroy();
  });

  it("give a child its minimum when an equal share is too small, and share the rest", () => {
    expect(shareWidths(400, [60, 60, 60])).toEqual([400 / 3, 400 / 3, 400 / 3]);
    expect(shareWidths(400, [220, 60, 60])).toEqual([220, 90, 90]);
    // The rest is shared by need: a name needing 100 gets more than a price needing 40.
    const [, name, price] = shareWidths(400, [160, 100, 40]);
    expect(name! + price!).toBeCloseTo(240);
    expect(name!).toBeGreaterThan(price!);
    expect(price!).toBeGreaterThanOrEqual(40);
    // If the minimums can't all fit, equal shares, as before.
    expect(shareWidths(300, [220, 220])).toEqual([150, 150]);
  });

  it("wrap four stats into two lines of two when four don't fit", () => {
    const ui = render(`row align=top
  stat label="Revenue" value="$48,200"
  stat label="Orders" value="1,204"
  stat label="Returns" value="3.1%"
  stat label="Rating" value="4.8"`, { components: coreComponents, width: 220 });
    const ys = [...new Set(boxes(ui.loom.boxes!, "stat").map((b) => b.y))];
    expect(ys.length).toBe(2);
    ui.destroy();
  });
});

describe("stat", () => {
  const stat = (value: string, width: number) => {
    const ui = render(`stat label="Total" value="${value}"`, { components: coreComponents, width });
    const box = boxes(ui.loom.boxes!, "stat")[0]!;
    const sizes = ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] !== "TOTAL").map((o) => Number(/(\d+)px/.exec(o.font)![1]));
    ui.destroy();
    return { h: box.h, sizes };
  };

  it("keeps its usual size when the value fits", () => {
    expect(stat("$48", 300)).toEqual({ h: 54, sizes: [28] });
  });

  it("shrinks a value that doesn't fit, before wrapping it", () => {
    const r = stat("$1,234,567", 150);
    expect(r.sizes).toHaveLength(1);
    expect(r.sizes[0]).toBeLessThan(28);
    expect(r.h).toBeLessThan(54);
  });

  it("wraps a value too long even at the smallest size, and grows taller", () => {
    const r = stat("$12,345,678.90 per year", 160);
    expect(r.sizes.length).toBeGreaterThan(1);
    expect(r.h).toBeGreaterThan(54);
  });
});

describe("grid", () => {
  it("never makes columns narrower than their children need", () => {
    const ui = render(`state a=1 b=2
grid min=60
  stepper "Hikers" bind=a
  stepper "Days" bind=b`, { components: coreComponents, width: 320 });
    const [s1, s2] = boxes(ui.loom.boxes!, "stepper");
    expect(s2!.y).toBeGreaterThan(s1!.y);
    ui.destroy();
  });
});

describe("the overflow check itself", () => {
  const box = (x: number, w: number): Box => ({ node: { id: "t", type: "text", props: {}, children: [], line: 1, indent: 0 }, x, y: 0, w, h: 20, children: [] });
  const op = (text: string, x: number, maxWidth?: number, textAlign = "left") => ({
    op: "fillText", args: maxWidth === undefined ? [text, x, 10] : [text, x, 10, maxWidth], fillStyle: "#000", strokeStyle: "", font: "400 10px X", globalAlpha: 1, textAlign,
  });

  it("finds text running past its element", () => {
    // 20 characters at 10px * 0.55 = 110px, in a 50px box.
    expect(textOverflows(box(0, 50), [op("x".repeat(20), 0)])).toHaveLength(1);
  });

  it("finds text squeezed with maxWidth", () => {
    expect(textOverflows(box(0, 200), [op("x".repeat(20), 0, 60)])[0]?.problem).toMatch(/squeezed/);
  });

  it("accepts text that fits, whatever its alignment", () => {
    expect(textOverflows(box(0, 200), [op("hello", 100, undefined, "center"), op("hello", 200, undefined, "right")])).toEqual([]);
  });
});
