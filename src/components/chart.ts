/**
 * chart: a single-series bar or line chart of a list of records.
 *
 *   chart "Monthly revenue" kind=bar items=sales x=month y=revenue format=money
 *
 * Everything is worked out in layout (headless, from ctx.measure), into a
 * ChartGeometry kept on box.data relative to the box, so it's testable in
 * Node and survives containers moving the box. paint only draws it.
 *
 * Data rules, deterministic and never inventing numbers:
 * - Every item of the list is a category slot, in list order, equally spaced.
 * - A slot's value is its y field when that is a finite number. Anything
 *   else (missing field, null, text, not a record) is a gap: no bar, and the
 *   line breaks there. Text like "12" is not read as a number.
 * - A slot's label is its x field (text or a number), or "—" when missing.
 * - Bars always include 0; negative values go below it. Lines span the
 *   lowest to highest value, rounded out to whole ticks.
 * - More than MAX_CHART_ITEMS items, or too little width for them, shows a
 *   message instead of a chart: nothing is dropped silently.
 */
import type { ComponentDef, LayoutContext } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import { wrapText, type TextMeasurer } from "../text";
import type { Theme } from "../theme";
import type { Value } from "../types";
import { themeFont } from "./util";

/** The most items one chart draws. Larger lists show a message instead. */
export const MAX_CHART_ITEMS = 200;
/** The narrowest slot per item, in pixels, before the chart says it's too narrow. */
export const MIN_SLOT = { bar: 4, line: 3 } as const;

const KINDS = ["bar", "line"] as const;
const FORMATS = ["number", "money"] as const;
type Kind = (typeof KINDS)[number];
type Format = (typeof FORMATS)[number];
const LOCALE = "en-US";

export interface Rect { x: number; y: number; w: number; h: number }

export interface ChartSlot {
  /** The label as written in the data ("—" when missing). */
  label: string;
  /** The label as drawn, cut to fit, or null when thinned out to make room. */
  shownLabel: string | null;
  /** Where the label's centre is drawn: the slot's centre, moved in if it would stick out of the box. */
  labelX: number;
  /** Centre of the slot along x. */
  cx: number;
  /** The value, or null for a gap. */
  value: number | null;
  /** Bar charts: the bar, from the zero line to the value. */
  bar?: Rect;
  /** Line charts: where the value is. */
  point?: { x: number; y: number };
}

/** Everything paint needs, relative to the chart's box. */
export type ChartGeometry = {
  kind: Kind;
  title: string[];
  titleFont: string;
  titleLH: number;
  labelFont: string;
  /** Shown instead of a plot: no data, too many items, too narrow. */
  message?: string;
  plot: Rect;
  /** Value axis ticks, top to bottom is not guaranteed; y is where each is drawn. */
  ticks: Array<{ value: number; y: number; label: string }>;
  /** Where 0 is, when it's on the scale. */
  zeroY: number | null;
  min: number;
  max: number;
  slots: ChartSlot[];
  /** Line charts: runs of neighbouring values, broken at gaps. */
  segments: Array<Array<{ x: number; y: number }>>;
  labelY: number;
};

// ---------------------------------------------------------------- data

export interface ChartData {
  slots: Array<{ label: string; value: number | null }>;
  /** Why nothing can be drawn, when that's the case. */
  problem?: "not-list" | "empty" | "no-values" | "too-many";
  /** Items whose y wasn't a finite number. */
  gaps: number;
}

function labelOf(v: Value | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && isFinite(v)) return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(v);
  if (typeof v === "boolean") return String(v);
  return "—";
}

/** Read a list of records into slots, without changing it. */
export function chartData(items: Value | undefined, x: string, y: string): ChartData {
  if (!isList(items)) return { slots: [], problem: "not-list", gaps: 0 };
  if (!items.length) return { slots: [], problem: "empty", gaps: 0 };
  if (items.length > MAX_CHART_ITEMS) return { slots: [], problem: "too-many", gaps: 0 };
  let gaps = 0;
  const slots = items.map((item) => {
    const raw = isRecord(item) ? fieldOf(item, y) : undefined;
    const value = typeof raw === "number" && isFinite(raw) ? raw : null;
    if (value === null) gaps++;
    return { label: isRecord(item) ? labelOf(fieldOf(item, x)) : "—", value };
  });
  return { slots, gaps, problem: gaps === slots.length ? "no-values" : undefined };
}

// ---------------------------------------------------------------- scale

/**
 * A step of 1, 2 or 5 times a power of ten, nearest to raw. Rounding to the
 * nearest (not up) keeps the top of the scale close to the biggest value, at
 * the cost of up to half as many ticks again as asked for.
 */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

/** Clean float noise (0.1 + 0.2) from a tick without toFixed, which fails past 100 digits. */
function cleanTick(v: number, step: number): number {
  if (Math.abs(v) < step * 1e-9) return 0;
  return Number(v.toPrecision(15));
}

/** The value range and ticks: bars include 0; a constant line gets room around it. */
export function chartScale(values: readonly number[], kind: Kind, target: number): { min: number; max: number; step: number; ticks: number[] } {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (kind === "bar") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) {
    // Constant values: never divide by zero; keep 0 as a bound when it is one.
    if (lo === 0) hi = 1;
    else if (kind === "bar") lo < 0 ? (hi = 0) : (lo = 0);
    else {
      // At least the smallest number, so even 5e-324 gets room; never past the largest.
      const pad = Math.max(Math.abs(lo) * 0.1, Number.MIN_VALUE);
      lo = Math.max(lo - pad, -Number.MAX_VALUE);
      hi = Math.min(hi + pad, Number.MAX_VALUE);
    }
  }
  // Halves, so a range like -1e308..1e308 doesn't overflow to Infinity.
  const step = niceStep((hi / 2 - lo / 2) / Math.max(1, target) * 2);
  const first = Math.floor(lo / step + 1e-9), last = Math.ceil(hi / step - 1e-9);
  const ticks: number[] = [];
  // Count steps with k, not first + k: past 2^53, adding 1 to first changes nothing.
  const count = last - first;
  for (let k = 0; k <= count && k <= 50; k++) {
    const v = cleanTick((first + k) * step, step);
    if (isFinite(v) && v !== ticks[ticks.length - 1]) ticks.push(v);
  }
  // Ticks that don't cover the values or can't be told apart (numbers past
  // what a double can step through, like 1e15 + 0.1): use the values' own bounds.
  if (ticks.length < 2 || ticks[0]! > lo || ticks[ticks.length - 1]! < hi) return { min: lo, max: hi, step: hi / 2 - lo / 2, ticks: [lo, hi] };
  return { min: ticks[0]!, max: ticks[ticks.length - 1]!, step, ticks };
}

/** The fewest decimals that show x exactly (2.5 → 1), or 21 when none up to 20 do. */
function decimalsOf(x: number): number {
  for (let d = 0; d <= 20; d++) {
    const s = x * 10 ** d;
    if (Math.abs(s - Math.round(s)) <= 1e-6 * Math.max(1, Math.abs(s))) return d;
  }
  return 21;
}

/**
 * Labels for a whole axis, in one format, chosen so every tick reads exactly
 * and no two read the same: compact ($12K) when the step allows it, then
 * plain numbers, then scientific notation for very large or small values.
 */
export function tickLabels(ticks: readonly number[], step: number, format: Format): string[] {
  const money = format === "money";
  const biggest = Math.max(...ticks.map(Math.abs));
  const tries: Intl.NumberFormatOptions[] = [];
  if (biggest >= 10_000 && biggest < 1e15) {
    const unit = 10 ** (3 * Math.floor(Math.log10(biggest) / 3));
    const f = decimalsOf(step / unit);
    if (f <= 2) tries.push({ notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: f });
  }
  const d = decimalsOf(step);
  if (biggest < 1e15 && d <= 6) {
    const digits = money && d > 0 ? Math.max(2, d) : d;
    tries.push({ minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  for (let f = 0; f <= 15; f++) tries.push({ notation: "scientific", minimumFractionDigits: 0, maximumFractionDigits: f });
  for (const opts of tries) {
    try {
      const nf = new Intl.NumberFormat(LOCALE, money ? { ...opts, style: "currency", currency: "USD" } : opts);
      // Zero reads as 0 in every format, not 0E0.
      const out = ticks.map((v) => (v === 0 && opts.notation === "scientific" ? (money ? "$0" : "0") : nf.format(Object.is(v, -0) ? 0 : v)));
      if (new Set(out).size === out.length) return out;
    } catch {
      // An option this runtime doesn't support: try the next.
    }
  }
  // JavaScript's own shortest form always tells two different numbers apart.
  return ticks.map((v) => (money ? "$" : "") + String(v));
}

// ---------------------------------------------------------------- layout

/** Cut text to fit a width, ending with an ellipsis. */
function fit(text: string, width: number, font: string, m: TextMeasurer): string {
  if (m.width(text, font) <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (m.width(text.slice(0, mid) + "…", font) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo ? text.slice(0, lo) + "…" : "";
}

/** Plot height for a width: wide enough to read, not taller than a phone screen wants. */
const plotHeight = (w: number) => Math.round(Math.max(140, Math.min(260, w * 0.45)));
/** Room inside the plot so dots at the top and bottom stay within it. */
const INSET = 5;

function geometry(box: { w: number }, d: ChartData, kind: Kind, format: Format, title: string, line: number, ctx: Pick<LayoutContext, "theme" | "measure" | "warn">): ChartGeometry {
  const t: Theme = ctx.theme;
  const m = ctx.measure;
  const titleFont = themeFont(t, 600, t.text.body), labelFont = themeFont(t, 400, t.text.caption);
  const titleLH = Math.round(t.text.body * 1.4), labelLH = Math.round(t.text.caption * 1.4);
  const titleLines = title ? wrapText(title, box.w, titleFont, m) : [];
  const top = titleLines.length ? titleLines.length * titleLH + t.space.sm : 0;
  const base: ChartGeometry = {
    kind, title: titleLines, titleFont, titleLH, labelFont,
    plot: { x: 0, y: top, w: box.w, h: 0 }, ticks: [], zeroY: null, min: 0, max: 0, slots: [], segments: [], labelY: 0,
  };
  const say = (message: string): ChartGeometry => ({ ...base, message, plot: { x: 0, y: top, w: box.w, h: 72 } });

  if (d.problem === "not-list") return say("No data to chart");
  if (d.problem === "empty") return say("No data to chart");
  if (d.problem === "too-many") return say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`);
  if (d.problem === "no-values") return say("No numbers to chart");

  const values = d.slots.flatMap((s) => (s.value === null ? [] : [s.value]));
  const plotH = plotHeight(box.w);
  const scale = chartScale(values, kind, Math.max(2, Math.min(6, Math.floor(plotH / 44))));
  const tickText = tickLabels(scale.ticks, scale.step, format);
  const axisW = Math.ceil(Math.max(...tickText.map((s) => m.width(s, labelFont)))) + t.space.sm;
  const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotH };
  const n = d.slots.length;
  const slotW = plot.w / n;
  if (slotW < MIN_SLOT[kind]) {
    const fits = Math.max(0, Math.floor(plot.w / MIN_SLOT[kind]));
    ctx.warn?.(`chart on line ${line}: ${n} items don't fit in ${Math.round(box.w)} pixels; at most ${fits} do`);
    return say(`Too narrow to chart ${n} items`);
  }

  // Halves again, so (max - min) can't overflow for values near the largest number.
  const y = (v: number) => plot.y + INSET + (plot.h - 2 * INSET) * (1 - (v / 2 - scale.min / 2) / (scale.max / 2 - scale.min / 2));
  const zeroY = scale.min <= 0 && scale.max >= 0 ? y(0) : null;

  // Category labels: thin them out evenly when they'd overlap, never the data.
  const widths = d.slots.map((s) => m.width(s.label, labelFont));
  const widest = Math.min(Math.max(...widths), 120);
  const every = Math.max(1, Math.ceil((widest + t.space.sm) / slotW));
  const room = slotW * every - t.space.xs;
  const barW = Math.min(slotW * 0.7, 56);

  const slots: ChartSlot[] = d.slots.map((s, i) => {
    const cx = plot.x + slotW * (i + 0.5);
    const shownLabel = i % every === 0 ? fit(s.label, room, labelFont, m) : null;
    const half = shownLabel ? m.width(shownLabel, labelFont) / 2 : 0;
    const labelX = Math.min(Math.max(cx, half), box.w - half);
    const slot: ChartSlot = { label: s.label, shownLabel, labelX, cx, value: s.value };
    if (s.value !== null) {
      const vy = y(s.value);
      if (kind === "bar") {
        const z = zeroY ?? y(scale.min);
        slot.bar = { x: cx - barW / 2, y: Math.min(vy, z), w: barW, h: Math.abs(vy - z) };
      } else slot.point = { x: cx, y: vy };
    }
    return slot;
  });
  const segments: ChartGeometry["segments"] = [];
  if (kind === "line") {
    let run: Array<{ x: number; y: number }> = [];
    for (const s of slots) {
      if (s.point) run.push(s.point);
      else if (run.length) { segments.push(run); run = []; }
    }
    if (run.length) segments.push(run);
  }
  if (d.gaps) ctx.warn?.(`chart on line ${line}: ${d.gaps} of ${n} items have no number in their y field, so they're shown as gaps`);

  return {
    ...base,
    plot,
    ticks: scale.ticks.map((v, i) => ({ value: v, y: y(v), label: tickText[i]! })),
    zeroY,
    min: scale.min,
    max: scale.max,
    slots,
    segments,
    labelY: plot.y + plot.h + t.space.xs,
  };
}

export const chart: ComponentDef = {
  type: "chart",
  category: "data",
  description:
    "A bar or line chart of one number per item of a list of records, such as revenue by month; it redraws when the list changes. One series, at most 200 items, labels evenly spaced in list order.",
  text: { description: "A title above the chart." },
  props: {
    kind: { type: "enum", values: KINDS, default: "bar", description: "bar compares categories and always starts at 0; line shows a trend in list order, scaled to the values." },
    items: { type: "expression", required: true, description: "The list of records to chart, e.g. items=sales or items={filter(sales, 'open')}." },
    x: { type: "name", required: true, description: "The field holding each item's label, e.g. x=month." },
    y: { type: "name", required: true, description: "The field holding each item's number, e.g. y=revenue. Items without a number there are shown as gaps, not zero." },
    format: { type: "enum", values: FORMATS, default: "number", description: "How values on the axis read: number (37K) or money ($37K)." },
  },
  example: `state sales=[{month: "Jan", revenue: 12000}, {month: "Feb", revenue: 18000}, {month: "Mar", revenue: 15000}]
chart "Monthly revenue" kind=bar items=sales x=month y=revenue format=money`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const kind = p.oneOf("kind", KINDS, "bar");
    const format = p.oneOf("format", FORMATS, "number");
    const x = p.str("x"), y = p.str("y");
    const items = p.expr("items");
    if (p.has("items") && !isList(items)) ctx.warn?.(`chart on line ${box.node.line}: items is not a list, so there's nothing to chart. Use a list of records, like items=sales`);
    const g = geometry(box, chartData(items, x, y), kind, format, p.text(), box.node.line, ctx);
    box.data = g;
    const labelLH = Math.round(ctx.theme.text.caption * 1.4);
    box.h = g.message ? g.plot.y + g.plot.h : g.labelY + labelLH;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as ChartGeometry | undefined;
    if (!d) return;
    const ox = box.x, oy = box.y;
    g.textBaseline = "middle";

    g.font = d.titleFont;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));

    if (d.message) {
      ctx.roundRect(ox + 0.5, oy + d.plot.y + 0.5, d.plot.w - 1, d.plot.h - 1, theme.radius.md);
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
      g.font = d.labelFont;
      g.fillStyle = c.muted;
      g.textAlign = "center";
      g.fillText(d.message, ox + d.plot.w / 2, oy + d.plot.y + d.plot.h / 2);
      return;
    }

    const px = ox + d.plot.x, pw = d.plot.w;
    // Grid lines and value labels.
    g.lineWidth = 1;
    g.font = d.labelFont;
    g.textAlign = "right";
    for (const tk of d.ticks) {
      const ty = Math.round(oy + tk.y) + 0.5;
      g.beginPath();
      g.moveTo(px, ty);
      g.lineTo(px + pw, ty);
      g.strokeStyle = c.line;
      g.stroke();
      g.fillStyle = c.muted;
      g.fillText(tk.label, px - theme.space.sm / 2 - 2, oy + tk.y);
    }
    if (d.zeroY !== null) {
      const zy = Math.round(oy + d.zeroY) + 0.5;
      g.beginPath();
      g.moveTo(px, zy);
      g.lineTo(px + pw, zy);
      g.strokeStyle = c.muted;
      g.stroke();
    }

    g.fillStyle = c.accent;
    g.strokeStyle = c.accent;
    if (d.kind === "bar") {
      for (const s of d.slots) {
        if (!s.bar || s.bar.h <= 0) continue;
        const r = Math.min(theme.radius.sm, s.bar.w / 2, s.bar.h / 2);
        ctx.roundRect(ox + s.bar.x, oy + s.bar.y, s.bar.w, s.bar.h, r);
        g.fillStyle = c.accent;
        g.fill();
      }
    } else {
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.lineCap = "round";
      for (const run of d.segments) {
        if (run.length < 2) continue;
        g.beginPath();
        run.forEach((pt, i) => (i ? g.lineTo(ox + pt.x, oy + pt.y) : g.moveTo(ox + pt.x, oy + pt.y)));
        g.strokeStyle = c.accent;
        g.stroke();
      }
      // Dots: on every point when there's room, and always on a point with no neighbours.
      const slotW = pw / Math.max(1, d.slots.length);
      for (const run of d.segments) {
        for (const pt of run) {
          if (slotW < 10 && run.length > 1) continue;
          g.beginPath();
          g.arc(ox + pt.x, oy + pt.y, run.length === 1 ? 4 : 3, 0, Math.PI * 2);
          g.fillStyle = c.surface;
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = c.accent;
          g.stroke();
        }
      }
    }

    g.font = d.labelFont;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const s of d.slots) if (s.shownLabel) g.fillText(s.shownLabel, ox + s.labelX, oy + d.labelY);
    g.textBaseline = "middle";
  },
};
