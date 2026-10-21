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
