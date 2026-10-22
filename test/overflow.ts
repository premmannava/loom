/**
 * Finds text that doesn't fit: drawn past the edges of the element that drew
 * it, or squeezed narrower with fillText's maxWidth (which condenses letters
 * instead of wrapping or cutting them). Used by the contract tests on every
 * component's example and by test/responsive.test.ts on harder specs.
 */
import { boxAt } from "../src/layout";
import { monoWidth, type DrawOp } from "../src/testing";
import type { Box } from "../src/types";

/** Rounding and anti-aliasing slack, in pixels. */
const SLACK = 1;
/** fillText's maxWidth may trim a hair (a measuring difference), never condense text visibly. */
const MAX_SQUEEZE = 1.05;

export interface Overflow {
  text: string;
  element: string;
  problem: string;
}

export function textOverflows(root: Box, ops: readonly DrawOp[]): Overflow[] {
  const out: Overflow[] = [];
  for (const op of ops) {
    if (op.op !== "fillText") continue;
    const [raw, x, y, maxWidth] = op.args as [unknown, number, number, number | undefined];
    const text = String(raw);
    if (!text.trim()) continue;
    const natural = monoWidth(text, op.font);
    const owner = boxAt(root, x, y);
    const element = owner ? `${owner.node.type} (line ${owner.node.line})` : "nothing";
    if (maxWidth !== undefined && natural > maxWidth * MAX_SQUEEZE) {
      out.push({ text, element, problem: `squeezed from ${natural.toFixed(0)}px into ${maxWidth.toFixed(0)}px` });
    }
    const w = maxWidth === undefined ? natural : Math.min(natural, maxWidth);
    const align = op.textAlign;
    const left = align === "center" ? x - w / 2 : align === "right" || align === "end" ? x - w : x;
    const right = left + w;
    if (!owner) {
      out.push({ text, element, problem: "drawn outside every element" });
      continue;
    }
    if (left < owner.x - SLACK || right > owner.x + owner.w + SLACK) {
      out.push({ text, element, problem: `spans ${left.toFixed(0)}–${right.toFixed(0)}px, outside its element's ${owner.x.toFixed(0)}–${(owner.x + owner.w).toFixed(0)}px` });
    }
  }
  return out;
}
