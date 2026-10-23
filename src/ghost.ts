/**
 * Placeholders for content that's on its way: shapes in a soft tint of the
 * theme's line color, with a highlight sweeping across them. The sweep is
 * placed by position on the canvas, not per shape, so every placeholder on
 * screen lights up in turn as one band passes over, rather than each
 * flickering on its own. With motion off (an option, or reduced motion) they
 * are a still tint.
 */
import type { PaintContext } from "./component";

/** One pass of the highlight, then a pause while it's off to the right. */
const SWEEP_MS = 1600;
/** How far the band travels: wider than a chat column, which leaves the pause. */
const SPAN = 1100;
const BAND = 180;
/** The band is drawn as strips of rising and falling strength (gradients aren't theme colors). */
const STRIPS = 18;
/** The band leans, like light across a surface. */
const LEAN = 0.35;

export interface Bounds { x: number; y: number; w: number; h: number }

/** Adds shapes to one path, so they're filled and swept together. */
export interface Shapes {
  rect(x: number, y: number, w: number, h: number, r: number): void;
  /** A rounded bar for a line of text. */
  pill(x: number, y: number, w: number, h: number): void;
  circle(cx: number, cy: number, r: number): void;
  /** The canvas, for any other path (call moveTo first). */
  g: CanvasRenderingContext2D;
}

function shapes(g: CanvasRenderingContext2D): Shapes {
  const rect = (x: number, y: number, w: number, h: number, r: number) => {
    if (w <= 0 || h <= 0) return;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  };
  return {
    rect,
    pill: (x, y, w, h) => rect(x, y, w, h, h / 2),
    circle: (cx, cy, r) => { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath(); },
    g,
  };
}

/**
 * Fill the shapes `draw` adds as a placeholder. `bounds` must cover them;
 * the sweep is clipped to the shapes.
 */
export function paintGhost(ctx: PaintContext, bounds: Bounds, draw: (s: Shapes) => void): void {
  const { g, theme } = ctx;
  const color = theme.colors.line;
  const alpha = g.globalAlpha;
  g.save();
  g.beginPath();
  draw(shapes(g));
  g.fillStyle = color;
  g.globalAlpha = alpha * (ctx.motion ? 0.55 : 1);
  g.fill();
  if (ctx.motion) {
    g.clip();
    const t = (ctx.now % SWEEP_MS) / SWEEP_MS;
    // Lean the band: x moves left as y grows, measured from the shapes' middle.
    const mid = bounds.y + bounds.h / 2;
    g.transform(1, 0, -LEAN, 1, LEAN * mid, 0);
    const left = -BAND + easeInOut(t) * (SPAN + BAND) - BAND / 2;
    const w = BAND / STRIPS;
    const top = bounds.y - 2, h = bounds.h + 4;
    for (let i = 0; i < STRIPS; i++) {
      const x = left + i * w;
      if (x + w < bounds.x - LEAN * h || x > bounds.x + bounds.w + LEAN * h) continue;
      const s = Math.sin((Math.PI * (i + 0.5)) / STRIPS);
      g.globalAlpha = alpha * 0.6 * s * s;
      g.fillRect(x, top, w + 0.5, h);
    }
    ctx.requestFrame();
  }
  g.restore();
}

/**
 * The placeholder for an element without its own: a few pills for something
 * short or text-like, a rounded block for anything taller.
 */
export function paintGenericGhost(ctx: PaintContext, box: Bounds): void {
  const lineH = 22, pillH = 10;
  if (box.h <= 0 || box.w <= 0) return;
  if (box.h > 120) {
    paintGhost(ctx, box, (s) => s.rect(box.x, box.y, box.w, box.h, ctx.theme.radius.md));
    return;
  }
  const lines = Math.max(1, Math.round(box.h / lineH));
  const gap = box.h / lines;
  paintGhost(ctx, box, (s) => {
    for (let i = 0; i < lines; i++) {
      const last = i === lines - 1;
      const w = lines === 1 ? Math.min(box.w, Math.max(48, box.w * 0.55)) : last ? box.w * 0.6 : box.w;
      s.pill(box.x, box.y + i * gap + (gap - pillH) / 2, w, Math.min(pillH, gap));
    }
  });
}

/** Slow in, slow out. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Fast at first, settling at the end: for things growing into place. */
export function easeOut(t: number): number {
  return 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
}

/**
 * Progress of item i of n within an overall reveal, so items start one after
 * another (a wave) and all finish by the end. `spread` is the share of the
 * reveal over which their starts are spread.
 */
export function staggered(progress: number, i: number, n: number, spread = 0.4): number {
  const start = n > 1 ? (i / (n - 1)) * spread : 0;
  return easeOut((progress - start) / (1 - spread));
}
