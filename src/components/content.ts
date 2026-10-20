import type { ComponentDef } from "../component";
import { wrapText } from "../text";
import { fillTint, TEXT_STYLES, textMetrics, themeFont, toneColor, toneProp, TONES, WEIGHTS } from "./util";

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
    strike: { type: "boolean", default: false, description: "Draw a line through the text, e.g. for an old price." },
  },
  example: `text "Weekend in Yosemite" style=title
text "{guests} guests, {nights} nights" tone=muted
text "$160" tone=muted strike=true`,
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
    if (p.bool("strike")) {
      lines.forEach((l, i) => {
        const w = g.measureText(l).width;
        const left = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
        g.fillRect(left, box.y + lineHeight * i + lineHeight / 2, w, Math.max(1, Math.round(lineHeight / 16)));
      });
    }
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

const BADGE_TONES = ["accent", "good", "warn", "bad", "muted"] as const;

export const badge: ComponentDef = {
  type: "badge",
  category: "content",
  description: "A small rounded label for a status or a short tag, like Shipped or New.",
  text: { description: "The label, one or two words.", required: true },
  props: {
    tone: { type: "enum", values: BADGE_TONES, default: "accent", description: "Color role: accent, good, warn, bad or muted." },
  },
  example: `badge "Shipped" tone=good`,
  layout(box) {
    box.h = 24;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const color = toneColor(theme, p.oneOf("tone", BADGE_TONES, "accent"));
    g.font = ctx.font(600, 12);
    const label = p.text();
    const w = Math.min(box.w, g.measureText(label).width + 20);
    ctx.roundRect(box.x, box.y, w, box.h, box.h / 2);
    fillTint(g, color, 0.16);
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, box.x + w / 2, box.y + box.h / 2 + 1, w - 12);
  },
};

const AVATAR_SIZES = { sm: 28, md: 40, lg: 56 } as const;
const AVATAR_SIZE_NAMES = ["sm", "md", "lg"] as const;
const AVATAR_TONES = ["accent", "good", "warn", "bad", "muted"] as const;

/** Up to two initials: the first letters of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? [...words[words.length - 1]!][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export const avatar: ComponentDef = {
  type: "avatar",
  category: "content",
  description: "A person's initials in a circle, with their name and an optional detail line beside it.",
  text: { description: "The person's name. The initials come from it.", required: true },
  props: {
    detail: { type: "string", description: "A second line under the name, like a role." },
    size: { type: "enum", values: AVATAR_SIZE_NAMES, default: "md", description: "sm, md or lg." },
    tone: { type: "enum", values: AVATAR_TONES, default: "accent", description: "Circle color role: accent, good, warn, bad or muted." },
    name: { type: "boolean", default: true, description: "Show the name beside the circle (default true)." },
  },
  example: `avatar "Ada Lovelace" detail="Trip organizer"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const d = AVATAR_SIZES[p.oneOf("size", AVATAR_SIZE_NAMES, "md")];
    const lines = p.bool("name", true) ? (p.has("detail") ? 2 : 1) : 0;
    box.h = Math.max(d, lines * Math.round(ctx.theme.text.body * 1.35));
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const d = AVATAR_SIZES[p.oneOf("size", AVATAR_SIZE_NAMES, "md")];
    const color = toneColor(theme, p.oneOf("tone", AVATAR_TONES, "accent"));
    const cy = box.y + box.h / 2;
    g.beginPath();
    g.arc(box.x + d / 2, cy, d / 2, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.font = ctx.font(700, Math.round(d * 0.38));
    g.fillStyle = theme.colors.onAccent;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials(p.text()), box.x + d / 2, cy + 1);
    if (!p.bool("name", true)) return;
    const x = box.x + d + 12, maxW = Math.max(0, box.w - d - 12);
    const lh = Math.round(theme.text.body * 1.35);
    const detail = p.str("detail");
    g.textAlign = "left";
    g.font = ctx.font(600, theme.text.body);
    g.fillStyle = theme.colors.ink;
    g.fillText(p.text(), x, detail ? cy - lh / 2 : cy, maxW);
    if (detail) {
      g.font = ctx.font(400, 13);
      g.fillStyle = theme.colors.muted;
      g.fillText(detail, x, cy + lh / 2, maxW);
    }
  },
};

const CODE_SIZE = 13, CODE_LH = 20, CODE_PAD = 12;

export const code: ComponentDef = {
  type: "code",
  category: "content",
  description: "A short piece of code or a command, in a monospaced font on a tinted block.",
  text: { description: "The code. Long lines wrap.", required: true },
  props: {},
  example: `code "npm install loom-ui"`,
  layout(box, ctx) {
    const font = themeFont(ctx.theme, 400, CODE_SIZE, "mono");
    const lines = wrapText(ctx.props(box.node).text(), Math.max(20, box.w - CODE_PAD * 2), font, ctx.measure);
    box.data = { lines, font };
    box.h = lines.length * CODE_LH + CODE_PAD * 2;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const { lines, font } = box.data as { lines: string[]; font: string };
    ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.sm);
    fillTint(g, theme.colors.ink, 0.06);
    g.font = font;
    g.fillStyle = theme.colors.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    lines.forEach((l, i) => g.fillText(l, box.x + CODE_PAD, box.y + CODE_PAD + CODE_LH * i + CODE_LH / 2));
  },
};
