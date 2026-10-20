/**
 * Component contract tests. These run over every registered component, so a
 * new component is checked against the project rules (CLAUDE.md) without
 * anyone writing tests for it first.
 */
import { describe, expect, it } from "vitest";
import type { ComponentDef } from "../src/component";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { darkTheme, lightTheme, type Theme } from "../src/theme";
import { walkBoxes } from "../src/layout";
import type { Box } from "../src/types";

const ALL: ComponentDef[] = [...coreComponents, ...mapComponents];
const registry = new Registry(ALL);
const WIDTHS = [320, 600, 1024];
const THEMES: Theme[] = [lightTheme, darkTheme];

/**
 * Interactive components that can't be reached with Tab yet, and why. The
 * test below fails once one of them becomes reachable, so this list can't
 * silently go stale: remove the entry when that happens.
 */
const NOT_KEYBOARD_REACHABLE_YET: Record<string, string> = {
  map: "Countries can be clicked but not reached by keyboard. Planned with the accessibility work in Phase 3.",
};

/** The component's example as a full spec. Components that only go inside a parent are wrapped in it. */
function exampleSpec(def: ComponentDef): string {
  const example = def.example ?? "";
  const parent = def.parents?.[0];
  if (!parent || parent === "root") return example + "\n";
  const [stateLines, body] = splitState(example);
  return [...stateLines, parent, ...body.map((l) => "  " + l)].join("\n") + "\n";
}

function splitState(src: string): [string[], string[]] {
  const lines = src.split("\n");
  return [lines.filter((l) => /^state\s/.test(l)), lines.filter((l) => !/^state\s/.test(l))];
}

/** Components that can be interactive: they take an action or a state to write. */
const canInteract = (def: ComponentDef) => Object.values(def.props).some((p) => p.type === "action" || p.type === "state");

/** Instances that set an action or state prop must be pressable (a card is only pressable with on=). */
const interactiveBoxes = (root: Box, def: ComponentDef) =>
  boxesOf(root, def.type).filter((b) =>
    Object.entries(def.props).some(([name, p]) => (p.type === "action" || p.type === "state") && name in b.node.props),
  );

const boxesOf = (root: Box, type: string) => {
  const out: Box[] = [];
  walkBoxes(root, (b) => { if (b.node.type === type) out.push(b); });
  return out;
};

const EPS = 0.01;

describe.each(ALL.map((d) => [d.type, d] as const))("%s", (_type, def) => {
  describe("definition", () => {
    it("has no placeholders left from the scaffold", () => {
      const texts = [def.description, def.text?.description, def.example, ...Object.values(def.props).map((p) => p.description)];
      const left = texts.filter((t) => t && /\bTODO\b/.test(t));
      expect(left, "fill in the TODOs from npm run new:component").toEqual([]);
    });

    it("has a one or two sentence description", () => {
      expect(def.description.trim()).not.toBe("");
      const sentences = def.description.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 1);
      expect(sentences.length).toBeLessThanOrEqual(2);
    });

    it("has an example that parses with no diagnostics", () => {
      expect(def.example, "every component needs an example").toBeTruthy();
      const r = parse(exampleSpec(def), registry);
      expect(r.diagnostics).toEqual([]);
      expect(r.nodeCount).toBeGreaterThan(0);
    });

    it("describes its text, if it takes any", () => {
      if (def.text) expect(def.text.description.trim()).not.toBe("");
    });

    it("documents every prop with a consistent type and default", () => {
      for (const [name, p] of Object.entries(def.props)) {
        const where = `${def.type}.${name}`;
        expect(p.description.trim(), where).not.toBe("");
        if (p.required) expect(p.default, `${where} is required, so it shouldn't have a default`).toBeUndefined();
        if (p.type === "enum") {
          expect(p.values?.length, `${where} needs values`).toBeGreaterThan(0);
          if (p.default !== undefined) expect(p.values, `${where} default`).toContain(p.default);
        }
        if (p.default !== undefined && p.type === "number") expect(typeof p.default, where).toBe("number");
        if (p.default !== undefined && p.type === "boolean") expect(typeof p.default, where).toBe("boolean");
      }
    });

    it("only allows children that exist", () => {
      if (Array.isArray(def.children)) for (const c of def.children) expect(registry.has(c), c).toBe(true);
      for (const p of def.parents ?? []) expect(p === "root" || registry.has(p), p).toBe(true);
    });
  });

  describe.each(WIDTHS)("at %ipx", (width) => {
    it("lays out inside its parent with finite, non-negative sizes", () => {
      const ui = render(exampleSpec(def), { components: ALL, width });
      const root = ui.loom.boxes!;
      const check = (b: Box, parent: Box | null) => {
        const where = `${b.node.type} (line ${b.node.line}) at ${width}px`;
        for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v), where).toBe(true);
        expect(b.w, where).toBeGreaterThanOrEqual(0);
        expect(b.h, where).toBeGreaterThanOrEqual(0);
        if (parent) {
          expect(b.x, `${where} starts left of its parent`).toBeGreaterThanOrEqual(parent.x - EPS);
          expect(b.y, `${where} starts above its parent`).toBeGreaterThanOrEqual(parent.y - EPS);
          expect(b.x + b.w, `${where} extends past its parent's right edge`).toBeLessThanOrEqual(parent.x + parent.w + EPS);
          expect(b.y + b.h, `${where} extends past its parent's bottom edge`).toBeLessThanOrEqual(parent.y + parent.h + EPS);
        }
        for (const k of b.children) check(k, b);
      };
      check(root, null);
      ui.destroy();
    });
  });

  describe.each(THEMES.map((t) => [t.name, t] as const))("painted in %s", (_name, theme) => {
    it("uses only theme colors and the theme font", () => {
      const ui = render(exampleSpec(def), { components: ALL, theme });
      const palette = new Set<string>(Object.values(theme.colors));
      const ops = ui.drawOps;
      if (def.paint || def.paintOver) expect(ops.length, "painting the example should draw something").toBeGreaterThan(0);
      for (const op of ops) {
        const color = op.fillStyle || op.strokeStyle;
        expect(palette.has(color), `${op.op} used "${color}", which isn't a theme color`).toBe(true);
        if (op.font) {
          const themed = op.font.includes(theme.font.family) || op.font.includes(theme.font.mono);
          expect(themed, `${op.op} used the font "${op.font}", which isn't a theme font`).toBe(true);
        }
      }
      ui.destroy();
    });
  });

  if (canInteract(def)) {
    describe("interaction", () => {
      it("registers a hit region for every instance that uses an action or state", () => {
        const ui = render(exampleSpec(def), { components: ALL });
        const boxes = interactiveBoxes(ui.loom.boxes!, def);
        expect(boxes.length, "the example should show the component being interactive").toBeGreaterThan(0);
        for (const b of boxes) expect(ui.hits.some((h) => h.box.node.id === b.node.id), `line ${b.node.line}`).toBe(true);
        ui.destroy();
      });

      const gap = NOT_KEYBOARD_REACHABLE_YET[def.type];
      it(gap ? `can't be reached with Tab yet (known gap: ${gap})` : "can be reached with Tab", () => {
        const ui = render(exampleSpec(def), { components: ALL });
        const want = new Set(interactiveBoxes(ui.loom.boxes!, def).map((b) => b.node.id));
        const reached = new Set<string>();
        for (let i = 0; i < ui.hits.length + 1; i++) {
          ui.tab();
          if (ui.focused) reached.add(ui.focused.id);
        }
        const all = [...want].every((id) => reached.has(id));
        expect(all).toBe(!gap);
        ui.destroy();
      });
    });
  }
});
