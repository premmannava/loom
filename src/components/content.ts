import type { ComponentDef } from "../component";
import { wrapText } from "../text";
import { TEXT_STYLES, textMetrics, toneColor, toneProp, TONES, WEIGHTS } from "./util";

const ALIGN = ["left", "center", "right"] as const;

export const text: ComponentDef = {
  type: "text",
  category: "content",
  description: "A paragraph or heading that wraps to the available width. Use {expressions} to show state.",
  text: { description: "The words to show. May include {expressions}.", required: true },
  props: {
    style: { type: "enum", values: TEXT_STYLES, default: "body", description: "display, title, lead, body or caption." },
    weight: { type: "enum", values: WEIGHTS, description: "regular, semibold or bold. Titles default to bold." },
    tone: toneProp,
    align: { type: "enum", values: ALIGN, default: "left", description: "left, center or right." },
  },
  example: `text "Weekend in Yosemite" style=title
text "{guests} guests, {nights} nights" tone=muted`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const m = textMetrics(ctx.theme, p.oneOf("style", TEXT_STYLES, "body"), p.has("weight") ? p.oneOf("weight", WEIGHTS, "regular") : undefined);
    const f = `${m.weight} ${m.size}px ${ctx.theme.font.family}`;
    const lines = wrapText(p.text(), box.w, f, ctx.measure);
    box.data = { lines, font: f, lineHeight: m.lineHeight };
    box.h = lines.length * m.lineHeight;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { lines, font, lineHeight } = box.data as { lines: string[]; font: string; lineHeight: number };
    const align = p.oneOf("align", ALIGN, "left");
    const g = ctx.g;
    g.font = font;
    g.fillStyle = toneColor(ctx.theme, p.oneOf("tone", TONES, "default"));
    g.textAlign = align;
    g.textBaseline = "middle";
    const x = align === "left" ? box.x : align === "center" ? box.x + box.w / 2 : box.x + box.w;
    lines.forEach((l, i) => g.fillText(l, x, box.y + lineHeight * i + lineHeight / 2 + 1));
  },
};

export const stat: ComponentDef = {
  type: "stat",
  category: "data",
  description: "A labelled number, for key figures like totals or counts.",
  props: {
    label: { type: "string", required: true, description: "Short caption above the value." },
    value: { type: "string", required: true, description: "The figure to show, usually an {expression}." },
    tone: toneProp,
    align: { type: "enum", values: ["left", "center"], default: "left", description: "left or center." },
  },
  example: `stat label="Total" value="\${price*qty}"`,
  layout(box) {
    box.h = 54;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const g = ctx.g;
    const center = p.oneOf("align", ["left", "center"] as const, "left") === "center";
    const x = center ? box.x + box.w / 2 : box.x;
    g.textAlign = center ? "center" : "left";
    g.textBaseline = "alphabetic";
    g.font = ctx.font(600, 11);
    if ("letterSpacing" in g) (g as unknown as { letterSpacing: string }).letterSpacing = "1px";
    g.fillStyle = ctx.theme.colors.muted;
    g.fillText(p.str("label").toUpperCase(), x, box.y + 12);
    if ("letterSpacing" in g) (g as unknown as { letterSpacing: string }).letterSpacing = "0px";
    g.font = ctx.font(700, 28);
    g.fillStyle = toneColor(ctx.theme, p.oneOf("tone", TONES, "default"));
    g.fillText(p.str("value"), x, box.y + 48);
  },
};

export const progress: ComponentDef = {
  type: "progress",
  category: "feedback",
  description: "A horizontal bar showing how far a value is toward a maximum.",
  props: {
    value: { type: "number", required: true, description: "Current amount, usually an {expression}." },
    max: { type: "number", default: 100, description: "The full amount (default 100)." },
    label: { type: "string", description: "Optional caption above the bar." },
    tone: toneProp,
  },
  example: `progress value={done} max=5 label="{done} of 5 steps"`,
  layout(box, ctx) {
    box.h = ctx.props(box.node).has("label") ? 30 : 10;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const g = ctx.g;
    let y = box.y;
    if (p.has("label")) {
      g.font = ctx.font(400, 13);
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = ctx.theme.colors.muted;
      g.fillText(p.str("label"), box.x, y);
      y += 20;
    }
    const max = p.num("max", 100) || 1;
    const f = Math.max(0, Math.min(1, p.num("value", 0) / max));
    ctx.roundRect(box.x, y, box.w, 10, 5);
    g.fillStyle = ctx.theme.colors.line;
    g.fill();
    if (f > 0) {
      ctx.roundRect(box.x, y, Math.max(10, box.w * f), 10, 5);
      const tone = p.oneOf("tone", TONES, "accent");
      g.fillStyle = tone === "default" ? ctx.theme.colors.accent : toneColor(ctx.theme, tone);
      g.fill();
    }
  },
};
