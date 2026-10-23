import type { ComponentDef, LayoutContext, PaintContext } from "../component";
import type { TextMeasurer } from "../text";
import type { Theme } from "../theme";
import type { Box, Value } from "../types";
import { isList } from "../data";
import { ellipsize, fitLines, wrapText } from "../text";
import { fitText } from "./input";
import { easeOut, paintGhost } from "../ghost";
import { fillTint, iconProblems, iconProp, TEXT_STYLES, textMetrics, textWidth, themeFont, toneColor, toneProp, TONES, WEIGHTS } from "./util";
import { drawIcon, ICON_NAMES, isIconName, type IconName } from "../icons";

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
    icon: iconProp,
  },
  example: `state guests=2 nights=3
text "Weekend in Yosemite" style=title
text "{guests} guests, {nights} nights" tone=muted
text "$160" tone=muted strike=true
text "Payment received" icon=check-circle tone=good`,
  check: (props) => iconProblems(props.icon, "icon"),
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const m = textMetrics(ctx.theme, p.oneOf("style", TEXT_STYLES, "body"), p.has("weight") ? p.oneOf("weight", WEIGHTS, "regular") : undefined);
    const f = `${m.weight} ${m.size}px ${ctx.theme.font.family}`;
    const icon = textIcon(p.str("icon"), m.size);
    const lines = wrapText(p.text(), Math.max(0, box.w - (icon ? icon.indent : 0)), f, ctx.measure);
    box.data = { lines, font: f, lineHeight: m.lineHeight, icon };
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
    const { lines, font, lineHeight, icon } = box.data as { lines: string[]; font: string; lineHeight: number; icon: TextIcon | null };
    const align = p.oneOf("align", ALIGN, "left");
    const g = ctx.g;
    const color = toneColor(ctx.theme, p.oneOf("tone", TONES, "default"));
    // The icon sits on the first line; the words keep to its right.
    const left = box.x + (icon ? icon.indent : 0);
    if (icon) drawIcon(g, icon.name, box.x, box.y + (lineHeight - icon.size) / 2, icon.size, color);
    g.font = font;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = "middle";
    const x = align === "left" ? left : align === "center" ? (left + box.x + box.w) / 2 : box.x + box.w;
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

interface TextIcon { name: IconName; size: number; indent: number }

/** An icon a little larger than the text it starts, and the room it takes. */
function textIcon(name: string, fontSize: number): TextIcon | null {
  if (!isIconName(name)) return null;
  const size = Math.round(Math.min(32, Math.max(16, fontSize * 1.2)));
  return { name, size, indent: size + Math.round(size * 0.45) };
}

const TRENDS = ["up", "down", "flat"] as const;
type Trend = (typeof TRENDS)[number];
const GOOD_WAYS = ["up", "down"] as const;

export const stat: ComponentDef = {
  type: "stat",
  category: "data",
  description: "A labelled number, for key figures like totals or counts. Add change= to show how it moved, and spark= for a small line of its recent values.",
  props: {
    label: { type: "string", required: true, description: "Short caption above the value." },
    value: { type: "string", required: true, description: "The figure to show, usually an {expression}." },
    tone: toneProp,
    align: { type: "enum", values: ["left", "center"], default: "left", description: "left or center." },
    change: {
      type: "string",
      description: "How the figure moved, shown small beside or under it with ▲ or ▼, e.g. change=\"+12%\" or change=\"{round(growth, 1)}%\". Write the sign; don't add an arrow.",
    },
    trend: {
      type: "enum", values: TRENDS,
      description: "up, down or flat: which way the change went, for its arrow and color. Leave it out to take it from change's sign.",
    },
    good: {
      type: "enum", values: GOOD_WAYS, default: "up",
      description: "Which way is good news: up (default, colored good) or down, for figures like costs or churn where falling is good.",
    },
    spark: {
      type: "expression",
      description: "A list of numbers, oldest first, drawn as a small line under the value, e.g. spark={[12, 15, 14, 19]} or spark=weekly.",
    },
  },
  example: `state price=24 qty=2
stat label="Total" value="\${price*qty}"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const d = statLayout(p.str("label"), p.str("value"), box.w, ctx.theme, ctx.measure);
    if (!p.has("change") && !p.has("spark") && !p.has("trend")) {
      box.data = { ...d };
      box.h = d.height;
      return;
    }
    const extra = statExtras(box, d, ctx);
    box.data = { ...d, ...extra };
    box.h = extra.height;
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
    const extra = (box.data as Partial<StatExtras>).extras ? (box.data as unknown as StatExtras) : null;
    if (ctx.isLoading(box.node)) {
      // The figure is on its way: a placeholder where it will be.
      const h = Math.round(d.size * 0.62), w = Math.min(box.w, Math.max(56, d.size * 3.2));
      const y = box.y + d.valueTop + d.valueLH - d.size * 0.72;
      if (!extra) {
        paintGhost(ctx, { x: box.x, y, w: box.w, h }, (s) => s.rect(center ? x - w / 2 : x, y, w, h, ctx.theme.radius.sm));
        return;
      }
      paintStatExtrasLoading(box, ctx, extra, { x, y, w, h, center });
      return;
    }
    // Just after its data arrived, the figure rises in and counts up to its value.
    const reveal = ctx.reveal(box.node);
    const base = g.globalAlpha;
    g.globalAlpha = base * easeOut(reveal * 1.6);
    const rise = (1 - easeOut(reveal * 1.6)) * 6;
    g.font = ctx.font(700, d.size);
    g.fillStyle = toneColor(ctx.theme, p.oneOf("tone", TONES, "default"));
    // A change beside a centred value: centre the pair, so the value starts left of the middle.
    const inline = extra?.change?.inline ?? false;
    let vx = x;
    if (inline && center && extra?.change) {
      g.textAlign = "left";
      vx = x - (extra.change.valueW + STAT_CHANGE_GAP + extra.change.width) / 2;
    }
    d.value.forEach((l, i) => g.fillText(reveal < 1 && d.value.length === 1 ? countUp(l, easeOut(reveal)) : l, vx, box.y + d.valueTop + d.valueLH * (i + 1) + rise));
    if (extra) paintStatExtras(box, ctx, extra, { x, vx, center, reveal, rise, base });
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

/** Space between a value and a change beside it. */
const STAT_CHANGE_GAP = 8;
/** A sparkline's height and its widest; it's a hint of a trend, not a chart. */
export const SPARK_H = 28;
const SPARK_MAX_W = 200;
const SPARK_INSET = 3;
/** The placeholder sparkline's shape: a gentle rise, as shares of its height. */
const SPARK_GHOST = [0.35, 0.5, 0.42, 0.62, 0.55, 0.78, 0.7, 0.9];

interface StatChange {
  /** As drawn: the arrow and the text as written, cut to fit. */
  text: string;
  width: number;
  /** The value's width, to place a change beside it. */
  valueW: number;
  inline: boolean;
  /** Baseline, relative to the box. */
  y: number;
}

interface StatSpark {
  /** Relative to the box; empty when there aren't two numbers to join. */
  points: Array<{ x: number; y: number }>;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StatExtras extends StatLayout {
  extras: true;
  change: StatChange | null;
  spark: StatSpark | null;
  dir: Trend | null;
  /** The color role for the change and the sparkline. */
  tone: "good" | "bad" | "muted" | "accent";
}

/**
 * Which way a change went, from the first number in it: "+12%" up, "-3"
 * and "−3" down, "0%" flat. Null when it holds no number.
 */
export function changeDirection(text: string): Trend | null {
  const m = /([+\-−])?\s*[$€£¥]?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)/.exec(text);
  if (!m) return null;
  const n = Number(m[2]!.replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return "flat";
  return m[1] === "-" || m[1] === "−" ? "down" : "up";
}

/** The arrow shown before a change. */
const ARROWS: Record<Trend, string> = { up: "▲", down: "▼", flat: "" };

/** The change and sparkline below or beside a stat's value, with the height they need. */
function statExtras(box: Box, d: StatLayout, ctx: LayoutContext): StatExtras & { height: number } {
  const p = ctx.props(box.node);
  const t = ctx.theme, m = ctx.measure;
  const w = Math.max(20, box.w);
  const loading = ctx.isLoading?.(box.node) ?? false;
  const center = p.oneOf("align", ["left", "center"] as const, "left") === "center";
  const raw = p.has("change") ? p.str("change").trim() : "";
  const dir: Trend | null = p.has("trend") ? p.oneOf("trend", TRENDS, "flat") : raw ? changeDirection(raw) : null;
  const goodUp = p.oneOf("good", GOOD_WAYS, "up") === "up";
  const tone = dir === "up" ? (goodUp ? "good" : "bad") : dir === "down" ? (goodUp ? "bad" : "good") : dir === "flat" ? "muted" : "accent";

  let bottom = d.valueTop + d.value.length * d.valueLH;
  let change: StatChange | null = null;
  if (p.has("change") && (raw || loading)) {
    const font = themeFont(t, 600, t.text.body);
    const lh = Math.round(t.text.body * 1.35);
    const arrow = dir ? ARROWS[dir] : "";
    const full = raw ? (arrow ? `${arrow} ${raw}` : raw) : "";
    // While loading, the size the placeholders take.
    const valueW = loading ? Math.min(w, Math.max(56, d.size * 3.2)) : m.width(d.value[0] ?? "", themeFont(t, 700, d.size));
    const natural = loading ? 48 : m.width(full, font);
    const inline = d.value.length === 1 && valueW + STAT_CHANGE_GAP + natural <= w;
    const text = inline ? full : ellipsize(full, w, font, m);
    const width = loading ? natural : m.width(text, font);
    if (inline) change = { text, width, valueW, inline, y: bottom };
    else {
      // A little space above, so the value's descenders stay clear of it.
      change = { text, width, valueW, inline, y: bottom + t.space.xs + lh - 5 };
      bottom += t.space.xs + lh;
    }
  }

  let spark: StatSpark | null = null;
  if (p.has("spark")) {
    const sw = Math.min(w, SPARK_MAX_W);
    const sx = center ? (w - sw) / 2 : 0;
    const sy = bottom + t.space.sm;
    spark = { points: [], x: sx, y: sy, w: sw, h: SPARK_H };
    if (!loading) spark.points = sparkPoints(p.expr("spark"), spark, box.node.line, ctx);
    bottom = sy + SPARK_H;
  }
  return { ...d, extras: true, change, spark, dir, tone, height: bottom + 6 };
}

/** Where a sparkline's numbers go in its area. Anything that isn't a number is left out, with a warning. */
function sparkPoints(list: Value | undefined, area: Omit<StatSpark, "points">, line: number, ctx: LayoutContext): StatSpark["points"] {
  if (list === undefined || list === null) return [];
  if (!isList(list)) {
    ctx.warn?.(`stat on line ${line}: spark should be a list of numbers, like spark={[12, 15, 14, 19]}`);
    return [];
  }
  const nums = list.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length < list.length) ctx.warn?.(`stat on line ${line}: spark has ${list.length - nums.length} entries that aren't numbers, so they're left out. Give a list of numbers, like spark={[12, 15, 14, 19]}`);
  if (nums.length < 2) return [];
  // Halves, so the range can't overflow for values near the largest number.
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = hi / 2 - lo / 2;
  const inner = area.h - 2 * SPARK_INSET;
  const stepX = (area.w - 2 * SPARK_INSET) / (nums.length - 1);
  return nums.map((v, i) => ({
    x: area.x + SPARK_INSET + i * stepX,
    y: area.y + SPARK_INSET + (span > 0 ? inner * (1 - (v / 2 - lo / 2) / span) : inner / 2),
  }));
}

function statToneColor(theme: Theme, tone: StatExtras["tone"]): string {
  return theme.colors[tone];
}

function paintStatExtras(box: Box, ctx: PaintContext, e: StatExtras, at: { x: number; vx: number; center: boolean; reveal: number; rise: number; base: number }): void {
  const { g, theme } = ctx;
  if (e.change) {
    g.font = ctx.font(600, theme.text.body);
    g.fillStyle = statToneColor(theme, e.tone);
    if (e.change.inline) {
      g.textAlign = "left";
      const left = at.center ? at.vx : at.x;
      g.fillText(e.change.text, left + e.change.valueW + STAT_CHANGE_GAP, box.y + e.change.y + at.rise);
    } else {
      g.textAlign = at.center ? "center" : "left";
      g.fillText(e.change.text, at.x, box.y + e.change.y + at.rise);
    }
  }
  const s = e.spark;
  if (s && s.points.length > 1) {
    const color = e.tone === "muted" ? theme.colors.accent : statToneColor(theme, e.tone);
    g.save();
    // The line draws in from the left once the data arrives.
    if (at.reveal < 1) {
      g.beginPath();
      g.rect(box.x + s.x - 4, box.y + s.y - 4, (s.w + 8) * easeOut(at.reveal), s.h + 8);
      g.clip();
    }
    g.globalAlpha = at.base;
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = color;
    g.beginPath();
    s.points.forEach((pt, i) => (i ? g.lineTo(box.x + pt.x, box.y + pt.y) : g.moveTo(box.x + pt.x, box.y + pt.y)));
    g.stroke();
    const last = s.points[s.points.length - 1]!;
    g.beginPath();
    g.arc(box.x + last.x, box.y + last.y, 2.5, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.restore();
  }
}

function paintStatExtrasLoading(box: Box, ctx: PaintContext, e: StatExtras, v: { x: number; y: number; w: number; h: number; center: boolean }): void {
  const pillH = 10;
  const lh = Math.round(ctx.theme.text.body * 1.35);
  const changeW = e.change?.width ?? 0;
  // A change beside a centred value: centre the pair.
  const pair = e.change?.inline && v.center ? v.w + STAT_CHANGE_GAP + changeW : v.w;
  const vx = v.center ? v.x - pair / 2 : v.x;
  const top = box.y + e.valueTop;
  paintGhost(ctx, { x: box.x, y: top, w: box.w, h: box.h - e.valueTop }, (s) => {
    s.rect(vx, v.y, v.w, v.h, ctx.theme.radius.sm);
    const c = e.change;
    if (c) {
      if (c.inline) s.pill(vx + v.w + STAT_CHANGE_GAP, v.y + v.h - pillH, changeW, pillH);
      else s.pill(v.center ? v.x - changeW / 2 : v.x, box.y + c.y - lh / 2 - pillH / 2 + 1, changeW, pillH);
    }
    const sp = e.spark;
    if (sp) {
      const x0 = box.x + sp.x, bottom = box.y + sp.y + sp.h, n = SPARK_GHOST.length;
      s.g.moveTo(x0, bottom);
      SPARK_GHOST.forEach((f, i) => s.g.lineTo(x0 + (sp.w * i) / (n - 1), bottom - sp.h * f));
      s.g.lineTo(x0 + sp.w, bottom);
      s.g.closePath();
    }
  });
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

const ICON_SIZES = { sm: 16, md: 20, lg: 28 } as const;
const ICON_SIZE_NAMES = ["sm", "md", "lg"] as const;

export const icon: ComponentDef = {
  type: "icon",
  category: "content",
  description: "A small symbol on its own, like a status mark or a weather sign. To start a line of text or a list row with one, use icon= on text or list-item instead.",
  props: {
    name: { type: "string", required: true, description: `Which icon: ${ICON_NAMES.join(", ")}.` },
    tone: toneProp,
    size: { type: "enum", values: ICON_SIZE_NAMES, default: "md", description: "sm, md or lg." },
  },
  example: `icon name=sun tone=warn size=lg
icon name=check-circle tone=good`,
  check: (props) => iconProblems(props.name, "name"),
  layout(box, ctx) {
    box.h = ICON_SIZES[ctx.props(box.node).oneOf("size", ICON_SIZE_NAMES, "md")];
  },
  minWidth: (node, ctx) => ICON_SIZES[ctx.props(node).oneOf("size", ICON_SIZE_NAMES, "md")],
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const name = p.str("name");
    if (!isIconName(name)) return;
    drawIcon(ctx.g, name, box.x, box.y, box.h, toneColor(ctx.theme, p.oneOf("tone", TONES, "default")));
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
