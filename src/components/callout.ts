/**
 * callout: the one thing to notice in an answer, on a tinted panel with a bar
 * in its tone's color down the left edge and an optional icon.
 *
 *   callout "Rock is 47% of revenue" detail="Up from 41% last year" icon=true
 */
import type { ComponentDef, LayoutContext, PaintContext } from "../component";
import { easeOut, paintGhost } from "../ghost";
import { wrapText } from "../text";
import type { Theme } from "../theme";
import type { Box } from "../types";
import { fillTint, themeFont } from "./util";

/** info is the accent; accent is accepted as another name for it. */
const CALLOUT_TONES = ["info", "accent", "good", "warn", "bad"] as const;
type CalloutTone = (typeof CALLOUT_TONES)[number];

/** The bar down the left edge, and the icon's diameter. */
const BAR = 4;
const ICON = 20;

function calloutColor(theme: Theme, tone: CalloutTone): string {
  const c = theme.colors;
  return { info: c.accent, accent: c.accent, good: c.good, warn: c.warn, bad: c.bad }[tone];
}

interface CalloutLayout {
  lines: string[];
  detail: string[];
  font: string;
  detailFont: string;
  lh: number;
  detailLH: number;
  padX: number;
  padY: number;
  textX: number;
  icon: boolean;
}

function measure(box: Box, ctx: LayoutContext): CalloutLayout & { height: number } {
  const p = ctx.props(box.node);
  const t = ctx.theme;
  const padX = t.space.md, padY = t.space.sm + t.space.xs;
  const icon = p.bool("icon", false);
  const textX = BAR + padX + (icon ? ICON + t.space.sm : 0);
  const width = Math.max(20, box.w - textX - padX);
  const font = themeFont(t, 600, t.text.body);
  const detailFont = themeFont(t, 400, t.text.caption);
  const lh = Math.round(t.text.body * 1.35);
  const detailLH = Math.round(t.text.caption * 1.4);
  const loading = ctx.isLoading?.(box.node) ?? false;
  // While its data loads, keep a line for each part so little moves when it arrives.
  const text = p.text();
  const lines = text ? wrapText(text, width, font, ctx.measure) : [""];
  const detailText = p.str("detail");
  const detail = detailText ? wrapText(detailText, width, detailFont, ctx.measure) : loading && p.has("detail") ? [""] : [];
  const body = lines.length * lh + (detail.length ? t.space.xs + detail.length * detailLH : 0);
  return { lines, detail, font, detailFont, lh, detailLH, padX, padY, textX, icon, height: padY * 2 + Math.max(body, icon ? ICON : 0) };
}

/** The panel: a tint of the tone over the whole box, and the bar down its left edge. */
function paintPanel(box: Box, ctx: PaintContext, color: string): void {
  const { g, theme } = ctx;
  ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.md);
  fillTint(g, color, 0.1);
  g.save();
  ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.md);
  g.clip();
  g.fillStyle = color;
  g.fillRect(box.x, box.y, BAR, box.h);
  g.restore();
}

/** A small symbol in a circle: i for info, a tick for good, ! for warn, × for bad. */
function paintIcon(ctx: PaintContext, tone: CalloutTone, cx: number, cy: number, color: string): void {
  const { g, theme } = ctx;
  const r = ICON / 2;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.save();
  g.strokeStyle = theme.colors.onAccent;
  g.fillStyle = theme.colors.onAccent;
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (tone === "good") {
    g.moveTo(cx - 4.5, cy + 0.5);
    g.lineTo(cx - 1.5, cy + 3.5);
    g.lineTo(cx + 4.5, cy - 3.5);
    g.stroke();
  } else if (tone === "bad") {
    g.moveTo(cx - 3.5, cy - 3.5);
    g.lineTo(cx + 3.5, cy + 3.5);
    g.moveTo(cx + 3.5, cy - 3.5);
    g.lineTo(cx - 3.5, cy + 3.5);
    g.stroke();
  } else {
    // i is a dot over a stem; ! is a stem over a dot.
    const info = tone !== "warn";
    g.moveTo(cx, info ? cy - 1 : cy - 5);
    g.lineTo(cx, info ? cy + 5 : cy + 1);
    g.stroke();
    g.beginPath();
    g.arc(cx, info ? cy - 4.5 : cy + 4.5, 1.3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

export const callout: ComponentDef = {
  type: "callout",
  category: "content",
  description: "The one thing to notice in an answer: a key finding, a warning or a next step.",
  text: { description: "The takeaway, in one short sentence. May include {expressions}. Long text wraps.", required: true },
  props: {
    detail: { type: "string", description: "An optional second line in muted text, e.g. what the finding is based on." },
    tone: {
      type: "enum", values: CALLOUT_TONES, default: "info",
      description: "info (default, the accent color) for a finding, good for good news, warn for something to watch, bad for a problem. accent is the same as info.",
    },
    icon: { type: "boolean", default: false, description: "Show a small icon matching the tone: i, a tick, ! or ×." },
  },
  example: `callout "Rock is 47% of revenue" detail="Up from 41% last year" icon=true`,
  layout(box, ctx) {
    const d = measure(box, ctx);
    box.data = { ...d };
    box.h = d.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const d = box.data as unknown as CalloutLayout;
    const tone = p.oneOf("tone", CALLOUT_TONES, "info");
    const color = calloutColor(theme, tone);
    paintPanel(box, ctx, color);
    // Just after its data arrived, the words fade in on the panel.
    const base = g.globalAlpha;
    g.globalAlpha = base * easeOut(ctx.reveal(box.node) * 2);
    const top = box.y + d.padY;
    if (d.icon) paintIcon(ctx, tone, box.x + BAR + d.padX + ICON / 2, top + Math.max(d.lh, ICON) / 2, color);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = d.font;
    g.fillStyle = theme.colors.ink;
    const x = box.x + d.textX;
    d.lines.forEach((l, i) => g.fillText(l, x, top + d.lh * i + d.lh / 2 + 1));
    if (d.detail.length) {
      const dy = top + d.lines.length * d.lh + theme.space.xs;
      g.font = d.detailFont;
      g.fillStyle = theme.colors.muted;
      d.detail.forEach((l, i) => g.fillText(l, x, dy + d.detailLH * i + d.detailLH / 2 + 1));
    }
    g.globalAlpha = base;
  },
  paintLoading(box, ctx) {
    const p = ctx.props(box.node);
    const d = box.data as unknown as CalloutLayout;
    const tone = p.oneOf("tone", CALLOUT_TONES, "info");
    const color = calloutColor(ctx.theme, tone);
    // The panel is real (its tone doesn't depend on the data); the words are on their way.
    paintPanel(box, ctx, color);
    const top = box.y + d.padY, x = box.x + d.textX;
    const room = Math.max(0, box.x + box.w - d.padX - x);
    const pillH = 10;
    paintGhost(ctx, { x, y: top, w: room, h: box.h - d.padY * 2 }, (s) => {
      if (d.icon) s.circle(box.x + BAR + d.padX + ICON / 2, top + Math.max(d.lh, ICON) / 2, ICON / 2);
      d.lines.forEach((_l, i) => {
        const last = i === d.lines.length - 1;
        s.pill(x, top + d.lh * i + (d.lh - pillH) / 2, last ? Math.min(room, Math.max(48, room * 0.7)) : room, pillH);
      });
      if (d.detail.length) {
        const dy = top + d.lines.length * d.lh + ctx.theme.space.xs;
        s.pill(x, dy + (d.detailLH - 8) / 2, Math.min(room, Math.max(40, room * 0.45)), 8);
      }
    });
  },
};
