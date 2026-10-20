import type { LayoutContext, PressContext, PropDef } from "../component";
import type { Theme } from "../theme";
import type { Box } from "../types";

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

/** Split width equally between visible children, side by side. */
export function row(box: Box, ctx: LayoutContext, pad: number, gap: number, align: (typeof ROW_ALIGN)[number]): void {
  const kids = ctx.visibleChildren(box.node);
  const n = kids.length || 1;
  const innerW = box.w - pad * 2;
  const cw = Math.max(0, (innerW - gap * (n - 1)) / n);
  let tallest = 0;
  kids.forEach((k, i) => {
    const kb = ctx.layout(k, box.x + pad + i * (cw + gap), box.y + pad, cw);
    box.children.push(kb);
    tallest = Math.max(tallest, kb.h);
  });
  if (align !== "top") {
    for (const kb of box.children) {
      const d = tallest - kb.h;
      if (d > 0) ctx.shift(kb, 0, align === "center" ? d / 2 : d);
    }
  }
  box.h = tallest + pad * 2;
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
