/**
 * Headless layout: turns a node tree into positioned boxes using only a
 * TextMeasurer, so it runs (and is tested) without a canvas.
 */
import { PropReader, type LayoutContext } from "./component";
import { eachInstances, MAX_EACH_ELEMENTS, scopeOf, type EachBudget } from "./each";
import { bareExpression, evaluate, type Scope } from "./expr";
import type { Registry } from "./registry";
import type { TextMeasurer } from "./text";
import type { Theme } from "./theme";
import type { Box, LoomNode } from "./types";

/** Whether a node is shown: its `if=` passes and, given a registry, its component's visible() agrees. */
export function isVisible(node: LoomNode, base: Scope, registry?: Registry): boolean {
  const scope = scopeOf(node, base);
  const own = registry?.get(node.type)?.visible;
  if (own && !own(node, scope)) return false;
  const raw = node.props.if;
  if (raw === undefined) return true;
  const expr = bareExpression(raw);
  const r = evaluate(expr, scope);
  return r.ok && !!r.value;
}

export function shiftBox(box: Box, dx: number, dy: number): void {
  box.x += dx;
  box.y += dy;
  for (const k of box.children) shiftBox(k, dx, dy);
}

/**
 * A node's children as they should be laid out: hidden ones (`if=`) left out,
 * and every `each` replaced by its copies, one set per item.
 */
export function shownChildren(node: LoomNode, scope: Scope, registry?: Registry, warn?: (message: string) => void, budget?: EachBudget): LoomNode[] {
  const out: LoomNode[] = [];
  const add = (kids: readonly LoomNode[]) => {
    for (const c of kids) {
      if (!isVisible(c, scope, registry)) continue;
      if (c.type === "each") add(eachInstances(c, scopeOf(c, scope), warn, budget));
      // A passing if= block stands for the lines under it.
      else if (c.type === "if") add(c.children);
      else out.push(c);
    }
  };
  add(node.children);
  return out;
}

export function createLayoutContext(registry: Registry, theme: Theme, measure: TextMeasurer, scope: Scope, warn?: (message: string) => void): LayoutContext {
  const readers = new WeakMap<LoomNode, PropReader>();
  // Containers may ask more than once per layout; copies must stay the same objects.
  const kids = new WeakMap<LoomNode, LoomNode[]>();
  const budget: EachBudget = { left: MAX_EACH_ELEMENTS };
  const ctx: LayoutContext = {
    theme,
    measure,
    scope,
    props(node) {
      let r = readers.get(node);
      if (!r) readers.set(node, (r = new PropReader(node, scopeOf(node, scope))));
      return r;
    },
    layout(node, x, y, width) {
      const box: Box = { node, x, y, w: Math.max(0, width), h: 0, children: [] };
      const def = registry.get(node.type);
      if (def) def.layout(box, ctx);
      return box;
    },
    visibleChildren(node) {
      let k = kids.get(node);
      if (!k) kids.set(node, (k = shownChildren(node, scope, registry, warn, budget)));
      return k;
    },
    shift: shiftBox,
    warn,
  };
  return ctx;
}

/** Lay out a whole tree. */
export function layoutTree(root: LoomNode, width: number, registry: Registry, theme: Theme, measure: TextMeasurer, scope: Scope, warn?: (message: string) => void): Box {
  return createLayoutContext(registry, theme, measure, scope, warn).layout(root, 0, 0, width);
}

/** Find the deepest box containing a point. */
export function boxAt(box: Box, x: number, y: number): Box | null {
  if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return null;
  for (let i = box.children.length - 1; i >= 0; i--) {
    const hit = boxAt(box.children[i]!, x, y);
    if (hit) return hit;
  }
  return box;
}

/** Walk every box in paint order. */
export function walkBoxes(box: Box, fn: (b: Box, depth: number) => void, depth = 0): void {
  fn(box, depth);
  for (const k of box.children) walkBoxes(k, fn, depth + 1);
}
