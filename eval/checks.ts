/**
 * Behavior checks for evaluation requests: they render the model's final
 * spec with the real engine and use it, so "has an each" isn't mistaken for
 * "works". Each returns true when the screen does what the request asked.
 */
import { PropReader } from "../src/component";
import { scopeOf } from "../src/each";
import type { Rendered } from "../src/testing";
import type { LoomNode } from "../src/types";

export interface Check {
  /** What the check looks for, shown in the report when it fails. */
  label: string;
  test(spec: string, ui: Rendered): boolean;
}

/** The spec computes with a list function, like sum( or count(, rather than typing the number. */
export const calls = (fn: string): Check => ({
  label: `uses ${fn}()`,
  test: (spec) => new RegExp(`\\b${fn}\\(`).test(spec),
});

/** The spec uses an action, like remove: or add:. */
export const acts = (op: string): Check => ({
  label: `has a ${op}: action`,
  test: (spec) => new RegExp(`(^|[\\s=";])${op}:`, "m").test(spec),
});

/**
 * At least `n` list items are shown, added up across every each: a kanban's
 * three columns of 3, 3 and 2 cards count as 8.
 */
export const repeats = (n: number): Check => ({
  label: `shows at least ${n} items from lists`,
  test: (_spec, ui) => {
    // Copies are named after the spec line they repeat: "7:card#3" is a copy of "7:card".
    const shown = new Map<string, number>();
    for (const f of ui.findAll({})) {
      if (!f.box || !f.node.id.includes("#")) continue;
      const line = f.node.id.slice(0, f.node.id.indexOf("#"));
      shown.set(line, (shown.get(line) ?? 0) + 1);
    }
    let items = 0;
    const walk = (node: LoomNode) => {
      if (node.type === "each") items += Math.max(0, ...node.children.map((c) => shown.get(c.id) ?? 0));
      node.children.forEach(walk);
    };
    if (ui.loom.tree) walk(ui.loom.tree);
    return items >= n;
  },
});

/** An each inside another each, for data with lists inside items. */
export const nested: Check = {
  label: "repeats a list inside each item",
  test: (_spec, ui) => {
    const inside = (n: LoomNode, depth: number): boolean =>
      n.children.some((c) => (c.type === "each" && depth > 0) || inside(c, depth + (c.type === "each" ? 1 : 0)));
    return !!ui.loom.tree && inside(ui.loom.tree, 0);
  },
};

/** Activate a pressable part of the first shown element of a type ("last" part: a stepper's +). */
function pressFirst(ui: Rendered, type: string, part: "first" | "last" = "last"): boolean {
  const found = ui.findAll(type).find((f) => f.box);
  if (!found) return false;
  const regions = ui.hits.filter((h) => h.box.node.id === found.node.id);
  const region = part === "last" ? regions.at(-1) : regions[0];
  if (!region) return false;
  ui.loom.activate({ node: region.box.node, box: region.box, detail: region.detail });
  ui.loom.renderNow();
  return true;
}

/** Pressing the first element of a type changes some text on screen (a count, a total). */
export const pressChanges = (type: string): Check => ({
  label: `pressing a ${type} updates the screen`,
  test: (_spec, ui) => {
    const before = ui.text().join("\n");
    return pressFirst(ui, type) && ui.text().join("\n") !== before;
  },
});

/** Pressing a button whose label matches removes an item: fewer list copies afterwards. */
export const removes = (label: RegExp): Check => ({
  label: "a remove button removes an item",
  test: (_spec, ui) => {
    const copies = () => ui.findAll({}).filter((f) => f.box && f.node.id.includes("#")).length;
    const before = copies();
    const button = ui.findAll("button").find((f) => f.box && label.test(f.shownText ?? ""));
    if (!button) return false;
    ui.press({ id: button.node.id });
    return copies() < before;
  },
});

/** Ticking every checkbox shows something that wasn't there before (a celebration). */
export const allDoneShowsMore: Check = {
  label: "ticking every item shows a new message",
  test: (_spec, ui) => {
    const before = new Set(ui.text());
    const ids = ui.findAll("check").filter((f) => f.box).map((f) => f.node.id);
    if (!ids.length) return false;
    for (const id of ids) {
      const f = ui.findAll("check").find((x) => x.node.id === id);
      if (f?.box && !isTicked(ui, f.node)) ui.press({ id });
    }
    return ui.text().some((t) => !before.has(t) && !/\d/.test(t));
  },
};

/** Whether a check's bind= is true, read through the element's own scope (t.done inside each). */
function isTicked(ui: Rendered, node: LoomNode): boolean {
  return !!new PropReader(node, scopeOf(node, ui.loom.state.scope)).bound();
}
