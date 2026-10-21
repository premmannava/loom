import { describe, expect, it } from "vitest";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { exampleSpec } from "./examples";

describe("languageGuide", () => {
  const reg = new Registry(coreComponents);
  const guide = languageGuide(reg);

  it("documents every registered component", () => {
    for (const c of coreComponents) expect(guide).toContain(`  ${c.type}`);
  });

  it("contains an example that parses cleanly", () => {
    const example = guide.split("EXAMPLE\n")[1]!;
    const r = parse(example, reg);
    expect(r.diagnostics).toEqual([]);
    expect(r.nodeCount).toBeGreaterThan(5);
  });

  it("has examples for every component that parse without errors", () => {
    for (const c of coreComponents) {
      if (!c.example) continue;
      const r = parse(exampleSpec(c, coreComponents), reg);
      expect(r.diagnostics, c.type).toEqual([]);
    }
  });
});

describe("languageGuide options", () => {
  const reg = new Registry(coreComponents);

  it("lists every element in the index, by category, before the details", () => {
    const guide = languageGuide(reg);
    const indexAt = guide.indexOf("ELEMENTS AT A GLANCE");
    const detailsAt = guide.indexOf("\nELEMENTS\n");
    expect(indexAt).toBeGreaterThan(0);
    expect(detailsAt).toBeGreaterThan(indexAt);
    const index = guide.slice(indexAt, detailsAt);
    for (const c of coreComponents) expect(index, c.type).toMatch(new RegExp(`\\b${c.type}\\b`));
    expect(index).toMatch(/- navigation: screen, tabs, tab, breadcrumb, pagination/);
  });

  it("includes each element's example, unless turned off", () => {
    expect(languageGuide(reg)).toContain(`      slider "Up to \${maxPrice}" bind=maxPrice`);
    expect(languageGuide(reg, { examples: false })).not.toContain("    example:");
  });

  it("tells the model which image hosts work, or to avoid made-up URLs", () => {
    expect(languageGuide(reg)).toMatch(/Only use image with a URL the user or app gave you/);
    expect(languageGuide(reg, { imageHosts: ["cdn.shop.com"] })).toMatch(/Images only load from these hosts: cdn\.shop\.com/);
  });

  it("only mentions screens and images when those elements are registered", () => {
    const small = new Registry(coreComponents.filter((c) => !["screen", "image"].includes(c.type)));
    const guide = languageGuide(small);
    expect(guide).not.toMatch(/starting screen first/);
    expect(guide).not.toMatch(/Images only load|image with a URL/);
    expect(languageGuide(reg)).toMatch(/starting screen first/);
  });

  it("describes the app's own actions and notes", () => {
    const guide = languageGuide(reg, {
      actions: [
        { name: "add_to_cart", value: "the product id", description: "when the user wants to buy" },
        { name: "close", description: "when the user is done" },
      ],
      notes: "This is an outdoor gear shop.",
    });
    expect(guide).toContain("- emit:add_to_cart:<the product id>  when the user wants to buy");
    expect(guide).toContain("- emit:close  when the user is done");
    expect(guide).toContain("ABOUT THIS APP\nThis is an outdoor gear shop.");
    expect(languageGuide(reg)).not.toContain("APP ACTIONS");
  });

  it("keeps the worked example last, so it can be read as a spec", () => {
    const guide = languageGuide(reg, { notes: "x", actions: [{ name: "a", description: "b" }] });
    const example = guide.split("EXAMPLE\n").at(-1)!;
    expect(parse(example, reg).diagnostics).toEqual([]);
  });
});
