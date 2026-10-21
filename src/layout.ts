/**
 * Headless layout: turns a node tree into positioned boxes using only a
 * TextMeasurer, so it runs (and is tested) without a canvas.
 */
import { PropReader, type LayoutContext } from "./component";
import { evaluate, type Scope } from "./expr";
import type { Registry } from "./registry";
import type { TextMeasurer } from "./text";
import type { Theme } from "./theme";
import type { Box, LoomNode } from "./types";

/** Whether a node is shown: its `if=` passes and, given a registry, its component's visible() agrees. */
export function isVisible(node: LoomNode, scope: Scope, registry?: Registry): boolean {
  const own = registry?.get(node.type)?.visible;
  if (own && !own(node, scope)) return false;
  const raw = node.props.if;
  if (raw === undefined) return true;
  const expr = raw.replace(/^\{([\s\S]*)\}$/, "$1");
  const r = evaluate(expr, scope);
  return r.ok && !!r.value;
}

export function shiftBox(box: Box, dx: number, dy: number): void {
  box.x += dx;
  box.y += dy;
  for (const k of box.children) shiftBox(k, dx, dy);
}

export function createLayoutContext(registry: Registry, theme: Theme, measure: TextMeasurer, scope: Scope): LayoutContext {
  const readers = new WeakMap<LoomNode, PropReader>();
  const ctx: LayoutContext = {
    theme,
    measure,
    scope,
    props(node) {
      let r = readers.get(node);
      if (!r) readers.set(node, (r = new PropReader(node, scope)));
      return r;
    },
    layout(node, x, y, width) {
      const box: Box = { node, x, y, w: Math.max(0, width), h: 0, children: [] };
      const def = registry.get(node.type);
      if (def) def.layout(box, ctx);
      return box;
    },
    visibleChildren(node) {
      return node.children.filter((c) => isVisible(c, scope, registry));
    },
    shift: shiftBox,
  };
  return ctx;
}

/** Lay out a whole tree. */
export function layoutTree(root: LoomNode, width: number, registry: Registry, theme: Theme, measure: TextMeasurer, scope: Scope): Box {
  return createLayoutContext(registry, theme, measure, scope).layout(root, 0, 0, width);
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
