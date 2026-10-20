import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { layoutTree, boxAt } from "../src/layout";
import { lightTheme } from "../src/theme";
import { MonoMeasurer } from "../src/text";
import { Store } from "../src/state";

const reg = new Registry(coreComponents);

function lay(src: string, width = 600) {
  const r = parse(src, reg, { rootProps: { pad: "20", gap: "14" } });
  const store = new Store();
  r.state.forEach((s) => store.declare(s.key, s.value));
  return { box: layoutTree(r.root, width, reg, lightTheme, new MonoMeasurer(), store.scope), store, r };
}

describe("layout", () => {
  it("places a card inside the root padding", () => {
    const { box } = lay(`card\n  text "Hi"\n`);
    const card = box.children[0]!;
    expect([card.x, card.y, card.w]).toEqual([20, 20, 560]);
    const text = card.children[0]!;
    expect([text.x, text.y, text.w]).toEqual([42, 42, 516]);
  });

  it("splits rows equally and centers shorter children", () => {
    const { box } = lay(`row gap=10\n  stat label="Days" value=2\n  button "Add"\n`);
    const [stat, button] = box.children[0]!.children;
    expect(stat!.w).toBe(275);
    expect(button!.x).toBe(20 + 275 + 10);
    expect(stat!.h).toBe(54);
    expect(button!.y - stat!.y).toBe((54 - 42) / 2);
  });

  it("wraps long text and grows taller", () => {
    const short = lay(`text "Short"\n`, 300).box.children[0]!.h;
    const long = lay(`text "${"word ".repeat(40)}"\n`, 300).box.children[0]!.h;
    expect(long).toBeGreaterThan(short * 3);
  });

  it("hides elements whose condition is false", () => {
    const { box } = lay(`state show=false\ntext "A"\ntext "B" if=show\ntext "C"\n`);
    expect(box.children.map((b) => b.node.text)).toEqual(["A", "C"]);
  });

  it("re-lays out when state changes", () => {
    const src = `state show=false\ntext "A"\ntext "B" if=show\n`;
    const r = parse(src, reg, { rootProps: { pad: "0", gap: "0" } });
    const store = new Store();
    r.state.forEach((s) => store.declare(s.key, s.value));
    const before = layoutTree(r.root, 400, reg, lightTheme, new MonoMeasurer(), store.scope).h;
    store.set("show", true);
    const after = layoutTree(r.root, 400, reg, lightTheme, new MonoMeasurer(), store.scope).h;
    expect(after).toBeGreaterThan(before);
  });

  it("finds the deepest box at a point", () => {
    const { box } = lay(`card\n  button "Go"\n`);
    const hit = boxAt(box, 100, 60);
    expect(hit?.node.type).toBe("button");
  });
});
