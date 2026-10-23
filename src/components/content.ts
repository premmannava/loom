import type { ComponentDef } from "../component";
import type { TextMeasurer } from "../text";
import type { Theme } from "../theme";
import { fitLines, wrapText } from "../text";
import { fitText } from "./input";
import { easeOut, paintGhost } from "../ghost";
import { fillTint, TEXT_STYLES, textMetrics, textWidth, themeFont, toneColor, toneProp, TONES, WEIGHTS } from "./util";

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
  example: `state guests=2 nights=3
text "Weekend in Yosemite" style=title
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
  minWidth(node, ctx) {
    // Text wraps, so it needs only its longest word (up to a point: long words break).
    const p = ctx.props(node);
    const m = textMetrics(ctx.theme, p.oneOf("style", TEXT_STYLES, "body"), p.has("weight") ? p.oneOf("weight", WEIGHTS, "regular") : undefined);
    const words = p.text().split(/\s+/).filter(Boolean);
    return Math.min(100, Math.max(0, ...words.map((w) => textWidth(ctx, w, m.weight, m.size))));
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
  example: `state price=24 qty=2
stat label="Total" value="\${price*qty}"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const d = statLayout(p.str("label"), p.str("value"), box.w, ctx.theme, ctx.measure);
    box.data = { ...d };
    box.h = d.height;
  },
  minWidth(node, ctx) {
    // What its label and its value need at the smallest size, so "Days 2" stays small; long values wrap below 110.
    const p = ctx.props(node);
    const label = p.str("label").toUpperCase();
    const labelW = textWidth(ctx, label, 600, STAT_LABEL) + label.length;
    const valueW = textWidth(ctx, p.str("value"), 700, STAT_SIZES[STAT_SIZES.length - 1]!);
    return Math.max(40, Math.min(110, Math.max(labelW, valueW)));
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const g = ctx.g;
    const d = box.data as unknown as StatLayout;
    const center = p.oneOf("align", ["left", "center"] as const, "left") === "center";
    const x = center ? box.x + box.w / 2 : box.x;
    g.textAlign = center ? "center" : "left";
    g.textBaseline = "alphabetic";
    g.font = ctx.font(600, STAT_LABEL);
    if ("letterSpacing" in g) (g as unknown as { letterSpacing: string }).letterSpacing = "1px";
    g.fillStyle = ctx.theme.colors.muted;
    d.label.forEach((l, i) => g.fillText(l, x, box.y + 12 + i * STAT_LABEL_LH));
    if ("letterSpacing" in g) (g as unknown as { letterSpacing: string }).letterSpacing = "0px";
    if (ctx.isLoading(box.node)) {
      // The figure is on its way: a placeholder where it will be.
      const h = Math.round(d.size * 0.62), w = Math.min(box.w, Math.max(56, d.size * 3.2));
      const y = box.y + d.valueTop + d.valueLH - d.size * 0.72;
      paintGhost(ctx, { x: box.x, y, w: box.w, h }, (s) => s.rect(center ? x - w / 2 : x, y, w, h, ctx.theme.radius.sm));
      return;
    }
    // Just after its data arrived, the figure rises in and counts up to its value.
    const reveal = ctx.reveal(box.node);
    const base = g.globalAlpha;
    g.globalAlpha = base * easeOut(reveal * 1.6);
    const rise = (1 - easeOut(reveal * 1.6)) * 6;
    g.font = ctx.font(700, d.size);
    g.fillStyle = toneColor(ctx.theme, p.oneOf("tone", TONES, "default"));
    d.value.forEach((l, i) => g.fillText(reveal < 1 && d.value.length === 1 ? countUp(l, easeOut(reveal)) : l, x, box.y + d.valueTop + d.valueLH * (i + 1) + rise));
    g.globalAlpha = base;
  },
  paintLoading(box, ctx) {
    stat.paint!(box, ctx);
  },
};

/**
 * A figure part of the way to its value: "$1,240.50" at 0.5 is "$620.25".
 * Keeps everything around the number, its decimals and its thousands commas.
 */
export function countUp(text: string, progress: number): string {
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/.exec(text);
  if (!m || progress >= 1) return text;
  const decimals = m[2] ? m[2].length - 1 : 0;
  const full = Number(m[1]!.replace(/,/g, "") + (m[2] ?? ""));
  if (!Number.isFinite(full) || full > 1e15) return text;
  const now = (full * Math.max(0, progress)).toFixed(decimals);
  const [whole, frac] = now.split(".");
  const grouped = m[1]!.includes(",") ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole!;
  return text.slice(0, m.index) + grouped + (frac !== undefined ? "." + frac : "") + text.slice(m.index + m[0].length);
}

/** Value sizes a stat tries, largest first, before it wraps the value at the smallest. */
const STAT_SIZES = [28, 24, 20, 18];
const STAT_LABEL = 11, STAT_LABEL_LH = 14;

interface StatLayout { label: string[]; value: string[]; size: number; valueLH: number; valueTop: number; height: number }

/**
 * A stat's lines: the label (upper case, at most two lines) and the value at
 * the largest size that fits on one line, or wrapped at the smallest (at most
 * three lines). With a one-line label and value at full size it's 54 px tall.
 */
export function statLayout(label: string, value: string, width: number, theme: Theme, m: TextMeasurer): StatLayout {
  const w = Math.max(20, width);
  // Labels are drawn with 1px letter spacing, which the measurer doesn't know about.
  const spaced: TextMeasurer = { width: (t, f) => m.width(t, f) + t.length };
  const labelLines = label ? fitLines(label.toUpperCase(), w, themeFont(theme, 600, STAT_LABEL), spaced, 2) : [];
  let size = STAT_SIZES[STAT_SIZES.length - 1]!;
  let lines: string[] | null = null;
  for (const s of STAT_SIZES) {
    if (m.width(value, themeFont(theme, 700, s)) <= w) { size = s; lines = [value]; break; }
  }
  lines ??= fitLines(value, w, themeFont(theme, 700, size), m, 3);
  const valueLH = Math.round(size * 1.3);
  const valueTop = 12 + Math.max(0, labelLines.length - 1) * STAT_LABEL_LH;
  return { label: labelLines, value: lines, size, valueLH, valueTop, height: valueTop + lines.length * valueLH + 6 };
}

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
  example: `state done=3
progress value={done} max=5 label="{done} of 5 steps"`,
  layout(box, ctx) {
    box.h = ctx.props(box.node).has("label") ? 30 : 10;
  },
  minWidth: () => 80,
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const g = ctx.g;
    let y = box.y;
    if (p.has("label")) {
      g.font = ctx.font(400, 13);
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = ctx.theme.colors.muted;
      g.fillText(fitText(g, p.str("label"), box.w), box.x, y);
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
  minWidth: (node, ctx) => Math.min(140, textWidth(ctx, ctx.props(node).text(), 600, 12) + 20),
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
    g.fillText(fitText(g, label, w - 12), box.x + w / 2, box.y + box.h / 2 + 1);
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
  minWidth(node, ctx) {
    const p = ctx.props(node);
    const d = AVATAR_SIZES[p.oneOf("size", AVATAR_SIZE_NAMES, "md")];
    return p.bool("name", true) ? d + 12 + Math.min(100, textWidth(ctx, p.text(), 600, ctx.theme.text.body)) : d;
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
    g.fillText(fitText(g, p.text(), maxW), x, detail ? cy - lh / 2 : cy);
    if (detail) {
      g.font = ctx.font(400, 13);
      g.fillStyle = theme.colors.muted;
      g.fillText(fitText(g, detail, maxW), x, cy + lh / 2);
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
