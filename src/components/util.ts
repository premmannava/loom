import { ICON_NAMES, isIconName, nearestIcon } from "../icons";
import type { LayoutContext, PressContext, PropDef } from "../component";
import type { Theme } from "../theme";
import type { Box, SayShapeNode } from "../types";
import { fitLines } from "../text";

export const TONES = ["default", "muted", "accent", "good", "warn", "bad"] as const;
export type Tone = (typeof TONES)[number];

export function toneColor(theme: Theme, tone: Tone): string {
  const c = theme.colors;
  return { default: c.ink, muted: c.muted, accent: c.accent, good: c.good, warn: c.warn, bad: c.bad }[tone];
}

export const toneProp: PropDef = { type: "enum", values: TONES, default: "default", description: "Color role: default, muted, accent, good, warn or bad." };

export const gapProp = (def: number): PropDef => ({ type: "number", default: def, description: `Space between children in pixels (default ${def}).` });
export const padProp = (def: number): PropDef => ({ type: "number", default: def, description: `Inner padding in pixels (default ${def}).` });

/** Stack visible children top to bottom. */
export function stack(box: Box, ctx: LayoutContext, pad: number, gap: number): void {
  const kids = ctx.visibleChildren(box.node);
  const innerW = box.w - pad * 2;
  let y = box.y + pad;
  kids.forEach((k, i) => {
    if (i) y += gap;
    const kb = ctx.layout(k, box.x + pad, y, innerW);
    box.children.push(kb);
    y += kb.h;
  });
  box.h = y - box.y + pad;
}

export const ROW_ALIGN = ["top", "center", "bottom"] as const;

/**
 * Widths for children side by side in `space` pixels (gaps already taken out).
 * Equal shares when every child's minimum fits in one, which is how rows have
 * always worked. Otherwise a child whose minimum is more than its share gets
 * its minimum, and the others split what's left in proportion to what they
 * need, so a price beside a product name doesn't take as much room as the name.
 * If the minimums don't all fit, equal shares (children fit their content to
 * them as best they can).
 */
export function shareWidths(space: number, mins: readonly number[]): number[] {
  const n = mins.length;
  if (!n) return [];
  const equal = Math.max(0, space / n);
  if (mins.every((m) => m <= equal)) return mins.map(() => equal);
  if (mins.reduce((t, m) => t + m, 0) > space) return mins.map(() => equal);
  // Children that need little still get a usable share.
  const weight = (m: number) => Math.max(m, 40);
  // Children that need more than an equal share get exactly what they need.
  const widths: Array<number | null> = mins.map((m) => (m > equal ? m : null));
  for (;;) {
    const fixed = widths.reduce<number>((t, w) => t + (w ?? 0), 0);
    const free = mins.map((m, i) => (widths[i] === null ? weight(m) : 0));
    const totalWeight = free.reduce((t, w) => t + w, 0);
    const shareOf = (i: number) => (totalWeight ? ((space - fixed) * free[i]!) / totalWeight : 0);
    let changed = false;
    mins.forEach((m, i) => { if (widths[i] === null && m > shareOf(i)) { widths[i] = m; changed = true; } });
    if (!changed) return widths.map((w, i) => w ?? shareOf(i));
  }
}

/**
 * Lay out visible children side by side. With wrap (the default), children
 * that can't all get their minimum width (ComponentDef.minWidth) move onto
 * more lines, so a row of controls becomes a column on a narrow screen. At
 * widths where everything fits, every child gets an equal share, as before.
 */
export function row(box: Box, ctx: LayoutContext, pad: number, gap: number, align: (typeof ROW_ALIGN)[number], wrap = false): void {
  const kids = ctx.visibleChildren(box.node);
  const innerW = Math.max(0, box.w - pad * 2);
  const mins = kids.map((k) => Math.min(innerW, ctx.minWidth(k)));
  // Greedy lines: start a new one when the next child's minimum wouldn't fit.
  const lines: number[][] = [];
  let line: number[] = [], used = 0;
  kids.forEach((_k, i) => {
    const need = (line.length ? used + gap : 0) + mins[i]!;
    if (wrap && line.length && need > innerW + 0.01) { lines.push(line); line = []; used = 0; }
    used = (line.length ? used + gap : 0) + mins[i]!;
    line.push(i);
  });
  if (line.length || !lines.length) lines.push(line);

  let y = box.y + pad;
  lines.forEach((idx, li) => {
    if (li) y += gap;
    const widths = shareWidths(innerW - gap * Math.max(0, idx.length - 1), idx.map((i) => mins[i]!));
    let x = box.x + pad, tallest = 0;
    const placed: Box[] = [];
    idx.forEach((i, j) => {
      const kb = ctx.layout(kids[i]!, x, y, widths[j]!);
      placed.push(kb);
      box.children.push(kb);
      tallest = Math.max(tallest, kb.h);
      x += widths[j]! + gap;
    });
    if (align !== "top") {
      for (const kb of placed) {
        const d = tallest - kb.h;
        if (d > 0) ctx.shift(kb, 0, align === "center" ? d / 2 : d);
      }
    }
    y += tallest;
  });
  box.h = y - box.y + pad;
}

/** The narrowest a row can be: its widest child when it may wrap, all of them side by side when it may not. */
export function rowMinWidth(node: SayShapeNode, ctx: LayoutContext, pad: number, gap: number, wrap: boolean): number {
  const mins = ctx.visibleChildren(node).map((k) => ctx.minWidth(k));
  const inner = wrap ? Math.max(0, ...mins) : mins.reduce((t, m) => t + m, 0) + gap * Math.max(0, mins.length - 1);
  return inner + pad * 2;
}

export const TEXT_STYLES = ["display", "title", "lead", "body", "caption"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];
export const WEIGHTS = ["regular", "semibold", "bold"] as const;

export function textMetrics(theme: Theme, style: TextStyle, weight?: (typeof WEIGHTS)[number]) {
  const size = theme.text[style];
  const w = weight ?? (style === "display" || style === "title" ? "bold" : "regular");
  const numeric = { regular: 400, semibold: 600, bold: 700 }[w];
  return { size, weight: numeric, lineHeight: Math.round(size * 1.35 * 10) / 10 };
}

/** A CSS font string from the theme's family. */
export function themeFont(theme: Theme, weight: number, size: number, family: "family" | "mono" = "family"): string {
  return `${weight} ${size}px ${theme.font[family]}`;
}

/** A box covering one pressable part of an element, for ctx.addHit with a detail. */
export function partBox(box: Box, x: number, y: number, w: number, h: number): Box {
  return { node: box.node, x, y, w, h, children: [] };
}

/** Fill the current path with a color at reduced opacity (tints, hover washes). */
export function fillTint(g: CanvasRenderingContext2D, color: string, alpha: number): void {
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.fill();
  g.restore();
}

/** A small chevron centred on (x, y), pointing right, down, left or up. */
export function chevron(g: CanvasRenderingContext2D, x: number, y: number, size: number, dir: "right" | "down" | "left" | "up", color: string): void {
  const s = size / 2;
  const pts: Record<typeof dir, [number, number][]> = {
    right: [[-s / 2, -s], [s / 2, 0], [-s / 2, s]],
    left: [[s / 2, -s], [-s / 2, 0], [s / 2, s]],
    down: [[-s, -s / 2], [0, s / 2], [s, -s / 2]],
    up: [[-s, s / 2], [0, -s / 2], [s, s / 2]],
  };
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.8;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  pts[dir].forEach(([dx, dy], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
  g.stroke();
  g.restore();
}

/** Run an element's on= actions, if any (used after a component writes its bind= state). */
export function runOn(ctx: PressContext): void {
  const on = ctx.props(ctx.target.node).raw("on");
  if (on) ctx.run(on);
}

export const onProp = (what: string): PropDef => ({
  type: "action",
  description: `Actions to run ${what}, e.g. emit:changed. Separate several with ;`,
});

/** How wide text is in the theme's font, for minWidth and layout. */
export function textWidth(ctx: LayoutContext, text: string, weight: number, size: number): number {
  return text ? ctx.measure.width(text, themeFont(ctx.theme, weight, size)) : 0;
}

/** A control's label in body text, wrapped to a width and at most maxLines lines (the last ends with … if cut). */
export function labelLines(ctx: LayoutContext, text: string, width: number, maxLines: number): { lines: string[]; lh: number } {
  const lh = Math.round(ctx.theme.text.body * 1.35);
  if (!text) return { lines: [], lh };
  return { lines: fitLines(text, Math.max(20, width), themeFont(ctx.theme, 400, ctx.theme.text.body), ctx.measure, maxLines), lh };
}


/** icon= on text and list-item: a symbol before the words, from the icon element's list. */
export const iconProp: PropDef = { type: "string", description: "An icon before the text, by name from icon's list, e.g. icon=check-circle." };

/** A warning for an icon name that doesn't exist, with the nearest one and the full list. */
export function iconProblems(raw: string | undefined, prop: string): string[] {
  if (raw === undefined || raw.includes("{") || isIconName(raw)) return [];
  const near = nearestIcon(raw);
  return [`${prop}="${raw}" isn't an icon.${near ? ` Did you mean ${prop}=${near}?` : ""} Icons: ${ICON_NAMES.join(", ")}`];
}
