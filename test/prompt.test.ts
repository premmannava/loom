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

describe("the DATA section", () => {
  const guide = languageGuide(new Registry(coreComponents));

  it("is there when each is, and not otherwise", () => {
    expect(guide).toMatch(/DATA AND LISTS/);
    expect(languageGuide(new Registry(coreComponents.filter((c) => c.type !== "each")))).not.toMatch(/DATA AND LISTS/);
  });

  it("shows examples that parse cleanly and work as described", async () => {
    const { render } = await import("../src/testing");
    const { DATA_EXAMPLES } = await import("../src/prompt");
    for (const spec of Object.values(DATA_EXAMPLES)) expect(guide).toContain(spec.split("\n").map((l) => "  " + l).join("\n"));

    const todo = render(DATA_EXAMPLES.todo + "\n");
    expect(todo.diagnostics).toEqual([]);
    expect(todo.text()).toContain("1 of 3 packed");
    todo.press({ type: "check", text: "Snacks" });
    expect(todo.text()).toContain("2 of 3 packed");
    todo.press({ type: "button", text: "Add trail mix" });
    expect(todo.text()).toContain("2 of 4 packed");
    todo.press({ id: "8:button#0" });
    expect(todo.text()).toContain("1 of 3 packed");

    const cart = render(DATA_EXAMPLES.cart + "\n");
    expect(cart.diagnostics).toEqual([]);
    expect(cart.text()).toContain("Total $177");
    const plus = cart.hits.filter((h) => h.box.node.id === "7:stepper#1").at(-1)!;
    cart.loom.activate({ node: plus.box.node, box: plus.box, detail: plus.detail });
    cart.loom.renderNow();
    expect(cart.text()).toContain("Total $306");
  });
});
