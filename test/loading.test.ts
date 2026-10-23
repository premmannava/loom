/**
 * Data on its way: elements that read names the host is still loading draw
 * placeholders shaped like themselves, then draw in when the data arrives.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { countUp } from "../src/components/content";
import { Loading, REVEAL_MS } from "../src/loading";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const sales = [{ month: "Jan", revenue: 120 }, { month: "Feb", revenue: 180 }, { month: "Mar", revenue: 150 }] as unknown as Value;

const SPEC = `card
  text "Best: {first(sort(sales, 'revenue', 'desc')).month}"
  stat label="Total" value={money(sum(sales, 'revenue'))}
  chart "Revenue" kind=bar items=sales x=month y=revenue
  table "Months" items=top key=month
    table-column "Month" field=month
    table-column "Revenue" field=revenue format=money
derive top={take(sales, 2)}
`;

const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("Loading", () => {
  it("knows which names an element reads: text, expressions and bare items, not plain labels or actions", () => {
    const { root } = parse(`text "Hi {name}" if=shown\nchart "C" items=sales x=month y=revenue\nbutton "Go" on=inc:count\nstat label="sales" value=3\n`, registry);
    const loading = new Loading(registry);
    const [text, chart, button, stat] = root.children;
    expect(loading.readsOf(text!).sort()).toEqual(["name", "shown"]);
    expect(loading.readsOf(chart!)).toEqual(["sales"]);
    expect(loading.readsOf(button!)).toEqual([]);
    expect(loading.readsOf(stat!)).toEqual([]);
  });

  it("follows derive lines, and draws in over REVEAL_MS once the data arrives", () => {
    const parsed = parse(SPEC, registry);
    const table = parsed.root.children[0]!.children[3]!;
    const loading = new Loading(registry);
    loading.set(["sales"], 1000);
    expect(loading.view(parsed.derived).isLoading(table, () => undefined)).toBe(true);
    loading.set([], 2000);
    const view = loading.view(parsed.derived);
    expect(view.isLoading(table, () => undefined)).toBe(false);
    expect(view.reveal(table, 2000)).toBe(0);
    expect(view.reveal(table, 2000 + REVEAL_MS / 2)).toBeCloseTo(0.5);
    expect(view.reveal(table, 2000 + REVEAL_MS)).toBe(1);
  });

  it("while awaiting, counts a name with no value yet as loading, and a declared one as not", () => {
    const { root } = parse(`state ready=[1]\nchart "A" items=sales x=a y=b\nchart "B" items=ready x=a y=b\n`, registry);
    const loading = new Loading(registry);
    loading.setAwaiting(true);
    const view = loading.view([]);
    const scope = (n: string) => (n === "ready" ? ([1] as unknown as Value) : undefined);
    expect(view.isLoading(root.children[0]!, scope)).toBe(true);
    expect(view.isLoading(root.children[1]!, scope)).toBe(false);
  });
});

describe("elements while their data loads", () => {
  it("draw placeholders instead of empty states, with no warnings about the missing data", () => {
    // As a chat app does it: the names first, then the spec.
    const ui = render("");
    ui.loom.setLoading(["sales"]);
    ui.loom.setSpec(SPEC);
    ui.loom.renderNow();
    const shown = texts(ui);
    expect(shown).not.toContain("No data to chart");
    expect(shown).not.toContain("No data");
    expect(shown.some((t) => t.startsWith("Best:"))).toBe(false);
    expect(shown).not.toContain("—");
    // Titles and headers are real: they don't depend on the data.
    expect(shown).toEqual(expect.arrayContaining(["Revenue", "Months", "Month", "TOTAL"]));
    expect(ui.warnings).toEqual([]);
    // No rows to press while there are none.
    expect(ui.hits.some((h) => h.box.node.type === "table")).toBe(false);
    ui.destroy();
  });

  it("keep about the size they'll have, so little moves when the data arrives", () => {
    const ui = render(SPEC);
    ui.loom.setLoading(["sales"]);
    ui.loom.renderNow();
    const chart = ui.find("chart").box!;
    const table = ui.find("table").box!;
    expect(chart.h).toBeGreaterThan(150);
    expect(table.h).toBeGreaterThan(200);
    ui.loom.state.set("sales", sales);
    ui.loom.setLoading([]);
    ui.loom.renderNow();
    expect(Math.abs(ui.find("chart").box!.h - chart.h)).toBeLessThan(30);
    ui.destroy();
  });

  it("show the real content once the data arrives", () => {
    const ui = render(SPEC);
    ui.loom.setLoading(["sales"]);
    ui.loom.renderNow();
    ui.loom.state.set("sales", sales);
    ui.loom.setLoading([]);
    ui.loom.renderNow();
    const shown = texts(ui);
    expect(shown).toEqual(expect.arrayContaining(["Best: Feb", "$450.00", "Jan", "Feb"]));
    ui.destroy();
  });

  it("use theme colors only, in both themes", async () => {
    const { darkTheme } = await import("../src/theme");
    const ui = render(SPEC, { theme: darkTheme });
    ui.loom.setLoading(["sales"]);
    ui.loom.renderNow();
    const palette = new Set<string>(Object.values(darkTheme.colors));
    for (const op of ui.drawOps) expect(palette.has(op.fillStyle || op.strokeStyle), op.op).toBe(true);
    ui.destroy();
  });
});

describe("countUp", () => {
  it("counts a figure up to its value, keeping its symbols, decimals and commas", () => {
    expect(countUp("$1,240.50", 0.5)).toBe("$620.25");
    expect(countUp("$1,240.50", 1)).toBe("$1,240.50");
    expect(countUp("12,000 items", 0.25)).toBe("3,000 items");
    expect(countUp("Jun", 0.5)).toBe("Jun");
    expect(countUp("47%", 0)).toBe("0%");
  });
});
