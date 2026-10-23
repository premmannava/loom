/**
 * chart: bar and line charts of one or more fields of a list of records, and
 * pie and donut charts of one field.
 *
 *   chart "Monthly revenue" kind=bar items=sales x=month y=revenue format=money
 *   chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year
 *   chart "Sales by region" kind=donut items=regions x=name y=total format=money
 *
 * Everything is worked out in layout (headless, from ctx.measure), into a
 * ChartGeometry kept on box.data relative to the box, so it's testable in
 * Node and survives containers moving the box. paint only draws it.
 *
 * Data rules, deterministic and never inventing numbers:
 * - Bar and line: every item of the list is a category slot, in list order,
 *   equally spaced. Each field in y is a series, drawn in the theme's series
 *   colors in the order written; one field draws in the accent, as it always has.
 * - A value is its field when that is a finite number. Anything else (missing
 *   field, null, text, not a record) is a gap: no bar, and the line breaks
 *   there. Text like "12" is not read as a number.
 * - A slot's label is its x field (text or a number), or "—" when missing.
 * - Bars always include 0; negative values go below it. Lines span the
 *   lowest to highest value, rounded out to whole ticks. Every series shares
 *   one scale.
 * - Pie and donut: one slice per item with a positive y, in list order. Zero
 *   and gaps are left out. More than MAX_SLICES slices keeps the largest
 *   MAX_SLICES - 1 and adds an "Other" slice holding the rest. A negative
 *   value, or nothing above zero, shows a message instead.
 * - More than MAX_CHART_ITEMS items, more than MAX_SERIES fields, or too
 *   little width for them, shows a message instead of a chart: nothing is
 *   dropped silently.
 */
import type { ComponentDef, LayoutContext } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import { ellipsize, fitLines, wrapText, type TextMeasurer } from "../text";
import { SERIES_COUNT, seriesColors, type Theme } from "../theme";
import type { Box, Value } from "../types";
import { easeOut, paintGhost, staggered } from "../ghost";
import { themeFont } from "./util";

/** The most items one chart draws. Larger lists show a message instead. */
export const MAX_CHART_ITEMS = 200;
/** The most fields one bar or line chart draws, one color each. */
export const MAX_SERIES = SERIES_COUNT;
/** The most slices a pie or donut draws; past it, the smallest are summed into "Other". */
export const MAX_SLICES = SERIES_COUNT;
/** The narrowest slot per item, in pixels, before the chart says it's too narrow. */
export const MIN_SLOT = { bar: 4, line: 3 } as const;
/** Grouped bars: the narrowest bar, and the surface gap between bars in a group. */
const MIN_GROUP_BAR = 3;
const BAR_GAP = 2;

const KINDS = ["bar", "line", "pie", "donut"] as const;
const FORMATS = ["number", "money"] as const;
type Kind = (typeof KINDS)[number];
type AxisKind = "bar" | "line";
type Format = (typeof FORMATS)[number];
const LOCALE = "en-US";
const isRound = (k: Kind): k is "pie" | "donut" => k === "pie" || k === "donut";

/** The fields named in y=, in order: "revenue,last_year" → ["revenue", "last_year"]. */
export function fieldsOf(y: string): string[] {
  return y.split(",").map((f) => f.trim()).filter(Boolean);
}

/** The names in labels=, in order; blanks stay blank so they line up with y. */
function labelsOf(raw: string): string[] {
  return raw ? raw.split(",").map((l) => l.trim()) : [];
}

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
  /** The first series' value, or null for a gap. */
  value: number | null;
  /** Every series' value, in y's order. */
  values: Array<number | null>;
  /** Bar charts: the first series' bar, from the zero line to the value. */
  bar?: Rect;
  /** Bar charts: each series' bar, side by side in the slot; null for a gap. */
  bars?: Array<Rect | null>;
  /** Line charts: where the first series' value is. */
  point?: { x: number; y: number };
  /** Line charts: each series' point; null for a gap. */
  points?: Array<{ x: number; y: number } | null>;
}

/** One entry of the legend below a chart, relative to the box. */
export interface LegendItem {
  /** Index into the theme's series colors. */
  color: number;
  /** Where the swatch is. */
  swatch: Rect;
  /** The name, as written and as drawn (cut to fit). */
  label: string;
  shownLabel: string;
  labelX: number;
  /** Pie and donut: the value and share ("$12K · 34%"), as drawn, right-aligned at detailX. */
  detail?: string;
  detailX?: number;
  /** Centre line of the entry's text. */
  y: number;
}

export interface PieSlice {
  label: string;
  value: number;
  /** Share of the total, 0 to 1. */
  share: number;
  /** Angles in radians, clockwise from the top. */
  start: number;
  end: number;
  color: number;
  /** True for the slice that sums the smallest items. */
  other?: boolean;
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
  /** The message as drawn: wrapped to the box, at most three lines. */
  messageLines?: string[];
  plot: Rect;
  /** Value axis ticks, top to bottom is not guaranteed; y is where each is drawn. */
  ticks: Array<{ value: number; y: number; label: string }>;
  /** Where 0 is, when it's on the scale. */
  zeroY: number | null;
  min: number;
  max: number;
  slots: ChartSlot[];
  /** Line charts: runs of neighbouring values of the first series, broken at gaps. */
  segments: Array<Array<{ x: number; y: number }>>;
  /** Line charts: the runs of every series, in y's order (the first is `segments`). */
  seriesSegments: Array<Array<Array<{ x: number; y: number }>>>;
  /** The series drawn, in y's order: their names and colors. */
  series: Array<{ field: string; label: string; color: number }>;
  labelY: number;
  /** Below the plot: series names (2 or more series), or slices with value and share. */
  legend: LegendItem[];
  legendFont: string;
  /** Data still loading: draw a placeholder of this shape (series: how many, for the legend). */
  loading?: { series: number };
  /** Pie and donut. */
  pie?: {
    cx: number;
    cy: number;
    r: number;
    /** 0 for a pie; the hole's radius for a donut. */
    inner: number;
    slices: PieSlice[];
    total: number;
    /** Donut: the total in the middle, as drawn, and its font. */
    center?: { text: string; font: string; caption: string; captionFont: string; lh: number };
  };
};

// ---------------------------------------------------------------- data

export interface ChartData {
  slots: Array<{ label: string; value: number | null }>;
  /** Why nothing can be drawn, when that's the case. */
  problem?: "not-list" | "empty" | "no-values" | "too-many";
  /** Items whose y wasn't a finite number. */
  gaps: number;
}

export interface SeriesData {
  slots: Array<{ label: string; values: Array<number | null> }>;
  problem?: ChartData["problem"];
  /** For each field, the items whose value wasn't a finite number. */
  gaps: number[];
}

function labelOf(v: Value | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && isFinite(v)) return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(v);
  if (typeof v === "boolean") return String(v);
  return "—";
}

const numberAt = (item: Value, field: string): number | null => {
  const raw = isRecord(item) ? fieldOf(item, field) : undefined;
  return typeof raw === "number" && isFinite(raw) ? raw : null;
};

/** Read a list of records into slots with one value per field, without changing it. */
export function chartSeries(items: Value | undefined, x: string, ys: readonly string[]): SeriesData {
  const none = ys.map(() => 0);
  if (!isList(items)) return { slots: [], problem: "not-list", gaps: none };
  if (!items.length) return { slots: [], problem: "empty", gaps: none };
  if (items.length > MAX_CHART_ITEMS) return { slots: [], problem: "too-many", gaps: none };
  const gaps = ys.map(() => 0);
  const slots = items.map((item) => {
    const values = ys.map((y, k) => {
      const v = numberAt(item, y);
      if (v === null) gaps[k]!++;
      return v;
    });
    return { label: isRecord(item) ? labelOf(fieldOf(item, x)) : "—", values };
  });
  const empty = slots.every((s) => s.values.every((v) => v === null));
  return { slots, gaps, problem: empty ? "no-values" : undefined };
}

/** Read a list of records into slots for one field, without changing it. */
export function chartData(items: Value | undefined, x: string, y: string): ChartData {
  const d = chartSeries(items, x, [y]);
  const slots = d.slots.map((s) => ({ label: s.label, value: s.values[0] ?? null }));
  return { slots, gaps: d.gaps[0] ?? 0, ...(d.problem ? { problem: d.problem } : {}) };
}

export interface PieData {
  slices: Array<{ label: string; value: number; other?: boolean }>;
  total: number;
  problem?: ChartData["problem"] | "negative" | "zero" | "overflow";
  /** Items whose y wasn't a finite number. */
  gaps: number;
  /** Items summed into the "Other" slice. */
  folded: number;
}

/**
 * Slices for a pie or donut: positive values in list order. Past MAX_SLICES,
 * the largest MAX_SLICES - 1 stay (still in list order) and the rest become
 * one "Other" slice, so nothing is left out of the total.
 */
export function pieData(items: Value | undefined, x: string, y: string): PieData {
  const base = { slices: [], total: 0, gaps: 0, folded: 0 };
  if (!isList(items)) return { ...base, problem: "not-list" };
  if (!items.length) return { ...base, problem: "empty" };
  if (items.length > MAX_CHART_ITEMS) return { ...base, problem: "too-many" };
  let gaps = 0;
  const all: Array<{ label: string; value: number }> = [];
  for (const item of items) {
    const value = numberAt(item, y);
    if (value === null) { gaps++; continue; }
    if (value < 0) return { ...base, gaps, problem: "negative" };
    if (value > 0) all.push({ label: isRecord(item) ? labelOf(fieldOf(item, x)) : "—", value });
  }
  if (gaps === items.length) return { ...base, gaps, problem: "no-values" };
  const total = all.reduce((t, s) => t + s.value, 0);
  if (!all.length) return { ...base, gaps, problem: "zero" };
  if (!isFinite(total)) return { ...base, gaps, problem: "overflow" };
  if (all.length <= MAX_SLICES) return { slices: all, total, gaps, folded: 0 };
  // Rank by size, ties in list order, then keep the biggest in list order.
  const keep = new Set(all.map((s, i) => [s.value, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, MAX_SLICES - 1).map(([, i]) => i));
  const kept = all.filter((_s, i) => keep.has(i));
  const rest = all.filter((_s, i) => !keep.has(i));
  const other = rest.reduce((t, s) => t + s.value, 0);
  return { slices: [...kept, { label: "Other", value: other, other: true }], total, gaps, folded: rest.length };
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

/** One value as it reads in a legend or a donut's middle: $12,000, 37.5, $1.2M. */
export function valueText(v: number, format: Format): string {
  const money = format === "money";
  const a = Math.abs(v);
  const whole = Number.isInteger(v);
  const opts: Intl.NumberFormatOptions =
    a >= 1e15 ? { notation: "scientific", minimumFractionDigits: 0, maximumFractionDigits: 2 }
    : a >= 100_000 ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
    : { minimumFractionDigits: money && !whole ? 2 : 0, maximumFractionDigits: whole ? 0 : 2 };
  try {
    return new Intl.NumberFormat(LOCALE, money ? { ...opts, style: "currency", currency: "USD" } : opts).format(v);
  } catch {
    return (money ? "$" : "") + String(v);
  }
}

/** A share of a total as a whole percentage, with "<1%" for a sliver rather than "0%". */
export function shareText(share: number): string {
  const pct = share * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/** Plot height for a width: wide enough to read, not taller than a phone screen wants. */
const plotHeight = (w: number) => Math.round(Math.max(140, Math.min(260, w * 0.45)));
/** A pie's diameter for a width: a little smaller than a plot, and never wider than the box. */
const pieSize = (w: number) => Math.min(w, Math.round(Math.max(140, Math.min(220, w * 0.45))));
/** Room inside the plot so dots at the top and bottom stay within it. */
const INSET = 5;
/** Legend swatches: size, and the space between a swatch and its name. */
const SWATCH = 10;
const SWATCH_GAP = 6;

type Ctx = Pick<LayoutContext, "theme" | "measure" | "warn">;

/** The title and the parts every kind of chart shares. */
function header(box: { w: number }, kind: Kind, title: string, ctx: Ctx) {
  const t = ctx.theme, m = ctx.measure;
  const titleFont = themeFont(t, 600, t.text.body), labelFont = themeFont(t, 400, t.text.caption);
  const titleLH = Math.round(t.text.body * 1.4);
  const titleLines = title ? wrapText(title, box.w, titleFont, m) : [];
  const top = titleLines.length ? titleLines.length * titleLH + t.space.sm : 0;
  const base: ChartGeometry = {
    kind, title: titleLines, titleFont, titleLH, labelFont,
    plot: { x: 0, y: top, w: box.w, h: 0 }, ticks: [], zeroY: null, min: 0, max: 0, slots: [], segments: [], seriesSegments: [],
    series: [], labelY: 0, legend: [], legendFont: labelFont,
  };
  const say = (message: string): ChartGeometry => ({
    ...base, message, messageLines: fitLines(message, Math.max(0, box.w - 2 * t.space.sm), labelFont, m, 3), plot: { x: 0, y: top, w: box.w, h: 72 },
  });
  return { base, say, top };
}

/**
 * Series names side by side below the plot, starting a new line when the
 * next one doesn't fit; a name wider than the whole box is cut to fit.
 */
function flowLegend(entries: Array<{ label: string; color: number }>, width: number, top: number, ctx: Ctx): { items: LegendItem[]; bottom: number } {
  const t = ctx.theme, m = ctx.measure;
  const font = themeFont(t, 400, t.text.caption);
  const lh = Math.round(t.text.caption * 1.4);
  const lead = SWATCH + SWATCH_GAP;
  const items: LegendItem[] = [];
  let x = 0, y = top;
  for (const e of entries) {
    const shownLabel = fit(e.label, Math.max(0, width - lead), font, m);
    const w = lead + m.width(shownLabel, font);
    if (x > 0 && x + w > width) { x = 0; y += lh; }
    items.push({ color: e.color, swatch: { x, y: y + (lh - SWATCH) / 2, w: SWATCH, h: SWATCH }, label: e.label, shownLabel, labelX: x + lead, y: y + lh / 2 });
    x += w + t.space.md;
  }
  return { items, bottom: y + lh };
}

/**
 * Slices in columns below a pie: name on the left, value and share on the
 * right. As many equal columns as the widest entry allows, at least one;
 * when one column is too narrow, the name is cut first, then the numbers.
 */
function gridLegend(entries: Array<{ label: string; detail: string; color: number }>, width: number, top: number, ctx: Ctx): { items: LegendItem[]; bottom: number } {
  const t = ctx.theme, m = ctx.measure;
  const font = themeFont(t, 400, t.text.caption);
  const lh = Math.round(t.text.caption * 1.6);
  const lead = SWATCH + SWATCH_GAP, between = t.space.sm, colGap = t.space.md;
  const natural = Math.max(...entries.map((e) => lead + m.width(e.label, font) + between + m.width(e.detail, font)));
  const cols = Math.max(1, Math.min(entries.length, Math.floor((width + colGap) / (Math.min(width, natural) + colGap))));
  const colW = (width - colGap * (cols - 1)) / cols;
  const room = Math.max(0, colW - lead);
  const items = entries.map((e, i): LegendItem => {
    const x = (i % cols) * (colW + colGap), y = top + Math.floor(i / cols) * lh;
    const dw = m.width(e.detail, font);
    // Keep the numbers whole when the name can still show a few letters beside them.
    const detail = dw + between + 24 <= room ? e.detail : fit(e.detail, room / 2, font, m);
    const labelRoom = Math.max(0, room - m.width(detail, font) - between);
    return {
      color: e.color, swatch: { x, y: y + (lh - SWATCH) / 2, w: SWATCH, h: SWATCH },
      label: e.label, shownLabel: fit(e.label, labelRoom, font, m), labelX: x + lead,
      detail, detailX: x + colW, y: y + lh / 2,
    };
  });
  return { items, bottom: top + Math.ceil(entries.length / cols) * lh };
}

function axisGeometry(
  box: { w: number }, d: SeriesData, series: ChartGeometry["series"], kind: AxisKind, format: Format, title: string, line: number, ctx: Ctx,
): { g: ChartGeometry; h: number } {
  const t: Theme = ctx.theme;
  const m = ctx.measure;
  const { base, say, top } = header(box, kind, title, ctx);
  const labelFont = base.labelFont;
  const labelLH = Math.round(t.text.caption * 1.4);
  const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });

  if (d.problem === "not-list") return done(say("No data to chart"));
  if (d.problem === "empty") return done(say("No data to chart"));
  if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
  if (d.problem === "no-values") return done(say("No numbers to chart"));

  const ns = series.length;
  const values = d.slots.flatMap((s) => s.values.flatMap((v) => (v === null ? [] : [v])));
  const plotH = plotHeight(box.w);
  const scale = chartScale(values, kind, Math.max(2, Math.min(6, Math.floor(plotH / 44))));
  const tickText = tickLabels(scale.ticks, scale.step, format);
  const axisW = Math.ceil(Math.max(...tickText.map((s) => m.width(s, labelFont)))) + t.space.sm;
  const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotH };
  const n = d.slots.length;
  const slotW = plot.w / n;
  // Grouped bars need room for every bar of a slot, with gaps, in 80% of it.
  const grouped = kind === "bar" && ns > 1;
  const minSlot = grouped ? (ns * MIN_GROUP_BAR + (ns - 1) * BAR_GAP) / 0.8 : MIN_SLOT[kind];
  if (slotW < minSlot) {
    const fits = Math.max(0, Math.floor(plot.w / minSlot));
    ctx.warn?.(`chart on line ${line}: ${n} items${grouped ? ` with ${ns} series` : ""} don't fit in ${Math.round(box.w)} pixels; at most ${fits} do`);
    return done(say(`Too narrow to chart ${n} items`));
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
  const group = grouped ? Math.min(slotW * 0.8, ns * 40 + (ns - 1) * BAR_GAP) : barW;
  const each = grouped ? (group - (ns - 1) * BAR_GAP) / ns : barW;

  const slots: ChartSlot[] = d.slots.map((s, i) => {
    const cx = plot.x + slotW * (i + 0.5);
    const shownLabel = i % every === 0 ? fit(s.label, room, labelFont, m) : null;
    const half = shownLabel ? m.width(shownLabel, labelFont) / 2 : 0;
    const labelX = Math.min(Math.max(cx, half), box.w - half);
    const slot: ChartSlot = { label: s.label, shownLabel, labelX, cx, value: s.values[0] ?? null, values: s.values };
    if (kind === "bar") {
      const z = zeroY ?? y(scale.min);
      slot.bars = s.values.map((v, k) => {
        if (v === null) return null;
        const vy = y(v);
        return { x: cx - group / 2 + k * (each + BAR_GAP), y: Math.min(vy, z), w: each, h: Math.abs(vy - z) };
      });
      if (slot.bars[0]) slot.bar = slot.bars[0];
    } else {
      slot.points = s.values.map((v) => (v === null ? null : { x: cx, y: y(v) }));
      if (slot.points[0]) slot.point = slot.points[0];
    }
    return slot;
  });
  const seriesSegments: ChartGeometry["seriesSegments"] = [];
  if (kind === "line") {
    for (let k = 0; k < ns; k++) {
      const runs: ChartGeometry["segments"] = [];
      let run: Array<{ x: number; y: number }> = [];
      for (const s of slots) {
        const p = s.points?.[k];
        if (p) run.push(p);
        else if (run.length) { runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
      seriesSegments.push(runs);
    }
  }
  series.forEach((sr, k) => {
    const gaps = d.gaps[k] ?? 0;
    if (!gaps) return;
    const where = ns > 1 ? ` ${sr.field} field` : " y field";
    ctx.warn?.(`chart on line ${line}: ${gaps} of ${n} items have no number in their${where}, so they're shown as gaps`);
  });

  const labelY = plot.y + plot.h + t.space.xs;
  let h = labelY + labelLH;
  let legend: LegendItem[] = [];
  if (ns > 1) {
    const l = flowLegend(series, box.w, h + t.space.sm, ctx);
    legend = l.items;
    h = l.bottom;
  }
  return {
    g: {
      ...base,
      plot,
      ticks: scale.ticks.map((v, i) => ({ value: v, y: y(v), label: tickText[i]! })),
      zeroY,
      min: scale.min,
      max: scale.max,
      slots,
      segments: seriesSegments[0] ?? [],
      seriesSegments,
      series,
      labelY,
      legend,
    },
    h,
  };
}

function roundGeometry(box: { w: number }, d: PieData, kind: "pie" | "donut", format: Format, title: string, line: number, ctx: Ctx): { g: ChartGeometry; h: number } {
  const t = ctx.theme, m = ctx.measure;
  const { base, say, top } = header(box, kind, title, ctx);
  const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
  const name = kind === "pie" ? "Pie" : "Donut";

  if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
  if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
  if (d.problem === "no-values") return done(say("No numbers to chart"));
  if (d.problem === "negative") {
    ctx.warn?.(`chart on line ${line}: a ${kind} can't show negative values. Use kind=bar to show values below zero`);
    return done(say(`${name} charts can't show negative values`));
  }
  if (d.problem === "zero") return done(say("Every value is 0, so there's nothing to chart"));
  if (d.problem === "overflow") return done(say("These values are too large to add up"));
  if (d.gaps) ctx.warn?.(`chart on line ${line}: ${d.gaps} items have no number in their y field, so they're left out`);

  const size = pieSize(box.w);
  const r = size / 2;
  const cx = box.w / 2, cy = top + r;
  let a = 0;
  const slices: PieSlice[] = d.slices.map((s, i) => {
    const share = s.value / d.total;
    const slice: PieSlice = { label: s.label, value: s.value, share, start: a, end: i === d.slices.length - 1 ? Math.PI * 2 : a + share * Math.PI * 2, color: i, ...(s.other ? { other: true } : {}) };
    a = slice.end;
    return slice;
  });
  const inner = kind === "donut" ? Math.round(r * 0.6) : 0;

  let center: NonNullable<ChartGeometry["pie"]>["center"];
  if (inner) {
    const text = valueText(d.total, format);
    const width = inner * 2 * 0.85;
    const fonts = [themeFont(t, 700, t.text.title), themeFont(t, 600, t.text.lead), themeFont(t, 600, t.text.body)];
    const font = fonts.find((f) => m.width(text, f) <= width) ?? fonts[fonts.length - 1]!;
    const fontSize = font === fonts[0] ? t.text.title : font === fonts[1] ? t.text.lead : t.text.body;
    const captionFont = themeFont(t, 400, t.text.caption);
    const caption = m.width("Total", captionFont) <= width ? "Total" : "";
    center = { text: ellipsize(text, width, font, m), font, caption, captionFont, lh: Math.round(fontSize * 1.2) };
  }

  const legendTop = top + size + t.space.md;
  const l = gridLegend(
    slices.map((s) => ({ label: s.label, detail: `${valueText(s.value, format)} · ${shareText(s.share)}`, color: s.color })),
    box.w, legendTop, ctx,
  );
  return {
    g: {
      ...base,
      plot: { x: cx - r, y: top, w: size, h: size },
      legend: l.items,
      pie: { cx, cy, r, inner, slices, total: d.total, ...(center ? { center } : {}) },
    },
    h: l.bottom,
  };
}

/** Rows of legend a loading pie or donut keeps room for. */
const GHOST_LEGEND_ROWS = 4;

/** The shape of a chart whose data is on its way, at the size it will likely have, so little moves when it arrives. */
function loadingGeometry(box: { w: number }, kind: Kind, series: number, title: string, ctx: Ctx): { g: ChartGeometry; h: number } {
  const t = ctx.theme;
  const { base, top } = header(box, kind, title, ctx);
  const labelLH = Math.round(t.text.caption * 1.4);
  const rowH = Math.round(t.text.caption * 1.4) + t.space.xs;
  if (isRound(kind)) {
    const size = pieSize(box.w);
    const legendTop = top + size + t.space.md;
    return { g: { ...base, plot: { x: box.w / 2 - size / 2, y: top, w: size, h: size }, labelY: legendTop, loading: { series } }, h: legendTop + GHOST_LEGEND_ROWS * rowH };
  }
  const axisW = 28;
  const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotHeight(box.w) };
  const labelY = plot.y + plot.h + t.space.xs;
  const legend = series > 1 ? t.space.sm + rowH : 0;
  return { g: { ...base, plot, labelY, loading: { series } }, h: labelY + labelLH + legend };
}

/** Heights of the placeholder bars and line, as shares of the plot: a gentle rise with some variety. */
const GHOST_SHAPE = [0.42, 0.58, 0.5, 0.72, 0.62, 0.84, 0.7, 0.9, 0.78, 0.66, 0.8, 0.6];

function paintChartLoading(box: Box, ctx: PaintCtx): void {
  const { g, theme } = ctx;
  const d = box.data as ChartGeometry | undefined;
  if (!d?.loading) return;
  const ox = box.x, oy = box.y;
  const c = theme.colors;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = d.titleFont;
  g.fillStyle = c.ink;
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));
  const pillH = 8;
  const rowH = Math.round(theme.text.caption * 1.4) + theme.space.xs;
  const bounds = { x: ox, y: oy + d.plot.y, w: box.w, h: box.h - d.plot.y };

  if (isRound(d.kind)) {
    const r = d.plot.w / 2, cx = ox + d.plot.x + r, cy = oy + d.plot.y + r;
    paintGhost(ctx, bounds, (s) => {
      if (d.kind === "donut") {
        // A ring: the outer circle, then the hole the other way round.
        s.g.moveTo(cx + r, cy);
        s.g.arc(cx, cy, r, 0, Math.PI * 2);
        s.g.moveTo(cx + r * 0.6, cy);
        s.g.arc(cx, cy, r * 0.6, Math.PI * 2, 0, true);
        s.g.closePath();
      } else s.circle(cx, cy, r);
      for (let i = 0; i < GHOST_LEGEND_ROWS; i++) {
        const y = oy + d.labelY + i * rowH + rowH / 2;
        s.circle(ox + 5, y, 5);
        s.pill(ox + 18, y - pillH / 2, Math.min(box.w * 0.4, 70 + ((i * 37) % 60)), pillH);
        s.pill(ox + box.w - 64, y - pillH / 2, 64, pillH);
      }
    });
    return;
  }

  // The baseline, as the real chart will have; grid lines would show through the shapes.
  const px = ox + d.plot.x, pw = d.plot.w, py = oy + d.plot.y, ph = d.plot.h;
  g.lineWidth = 1;
  g.strokeStyle = c.line;
  g.beginPath();
  g.moveTo(px, Math.round(py + ph) + 0.5);
  g.lineTo(px + pw, Math.round(py + ph) + 0.5);
  g.stroke();
  const ns = Math.max(1, d.loading.series);
  const n = Math.max(4, Math.min(GHOST_SHAPE.length, Math.floor(pw / (d.kind === "bar" ? 26 * ns + 14 : 40))));
  const slotW = pw / n;
  const bottom = py + ph;
  paintGhost(ctx, bounds, (s) => {
    for (let i = 0; i <= 3; i++) s.pill(ox, py + (ph * i) / 3 - pillH / 2, d.plot.x - 8, pillH);
    if (d.kind === "bar") {
      const group = Math.min(slotW * 0.7, ns * 40);
      const bw = (group - (ns - 1) * BAR_GAP) / ns;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < ns; k++) {
          const h = ph * GHOST_SHAPE[(i + k * 3) % GHOST_SHAPE.length]! * (k ? 0.8 : 1);
          s.rect(px + slotW * (i + 0.5) - group / 2 + k * (bw + BAR_GAP), bottom - h, bw, h, Math.min(theme.radius.sm, bw / 2));
        }
      }
    } else {
      // The area under a line that rises gently: the shape a trend will take.
      s.g.moveTo(px, bottom);
      s.g.lineTo(px, bottom - ph * GHOST_SHAPE[0]! * 0.85);
      for (let i = 0; i < n; i++) s.g.lineTo(px + slotW * (i + 0.5), bottom - ph * GHOST_SHAPE[i]! * 0.85);
      s.g.lineTo(px + pw, bottom - ph * GHOST_SHAPE[n - 1]! * 0.85);
      s.g.lineTo(px + pw, bottom);
      s.g.closePath();
    }
    for (let i = 0; i < n; i += slotW < 44 ? 2 : 1) s.pill(px + slotW * (i + 0.5) - 14, oy + d.labelY + 3, 28, pillH);
    if (ns > 1) {
      const y = oy + d.labelY + Math.round(theme.text.caption * 1.4) + theme.space.sm + rowH / 2;
      for (let k = 0; k < ns; k++) {
        const x = ox + k * 96;
        if (x + 80 > ox + box.w) break;
        s.rect(x, y - 5, 10, 10, 2);
        s.pill(x + 16, y - pillH / 2, 60, pillH);
      }
    }
  });
}

/** Warnings about props that only make sense together, shown by the parser. */
function check(props: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const kind = props.kind ?? "bar";
  const y = props.y;
  // Expressions are worked out later; only what's written can be checked here.
  if (y === undefined || y.startsWith("{")) return out;
  const fields = fieldsOf(y);
  if (isRound(kind as Kind) && fields.length > 1) {
    out.push(`chart kind=${kind} shows one field, so only y=${fields[0]} is used. Write y=${fields[0]}, or use kind=bar or kind=line to compare ${fields.join(", ")}`);
  }
  if (!isRound(kind as Kind) && fields.length > MAX_SERIES) {
    out.push(`chart draws at most ${MAX_SERIES} series, and y lists ${fields.length}. Keep ${MAX_SERIES} fields or fewer, or make two charts`);
  }
  const labels = props.labels;
  if (labels !== undefined && !labels.includes("{")) {
    if (isRound(kind as Kind)) out.push(`labels= names the y fields of a bar or line chart; a ${kind}'s slices are named by x=, so labels= was ignored`);
    else if (labelsOf(labels).length !== fields.length) {
      out.push(`labels has ${labelsOf(labels).length} names for ${fields.length} y field${fields.length === 1 ? "" : "s"}; give one per field, in the same order, like labels="This year,Last year"`);
    }
  }
  return out;
}

export const chart: ComponentDef = {
  type: "chart",
  category: "data",
  description:
    "A chart of a list of records: bar or line for one or more numbers per item, such as revenue and last year's revenue by month, or pie or donut for how one number splits across items, such as sales by region. It redraws when the list changes, and shows at most 200 items, 6 series and 6 slices (smaller slices are summed into Other).",
  text: { description: "A title above the chart." },
  props: {
    kind: {
      type: "enum", values: KINDS, default: "bar",
      description: "bar compares categories and always starts at 0; line shows a trend in list order, scaled to the values; pie and donut show each item's share of the total, and donut puts the total in the middle. pie and donut take one y field and no negative values.",
    },
    items: { type: "expression", required: true, description: "The list of records to chart, e.g. items=sales or items={filter(sales, 'open')}." },
    x: { type: "name", required: true, description: "The field holding each item's label (each slice's name in a pie), e.g. x=month." },
    y: {
      type: "names", required: true,
      description: "The field holding each item's number, e.g. y=revenue. Bar and line can compare up to 6 fields on one scale, separated by commas with no spaces, e.g. y=revenue,last_year; each gets its own color and a legend. Items without a number are shown as gaps, not zero.",
    },
    labels: {
      type: "string",
      description: "Bar and line with several y fields: the legend's names, in the same order, separated by commas, e.g. labels=\"This year,Last year\". Without it the legend shows the field names.",
    },
    format: { type: "enum", values: FORMATS, default: "number", description: "How values read on the axis, in a pie's legend and in a donut's middle: number (37K) or money ($37K)." },
  },
  example: `state sales=[{month: "Jan", revenue: 12000, last_year: 10000}, {month: "Feb", revenue: 18000, last_year: 14000}, {month: "Mar", revenue: 15000, last_year: 16000}]
chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year labels="This year,Last year" format=money`,
  check,
  minWidth: () => 200,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const kind = p.oneOf("kind", KINDS, "bar");
    const format = p.oneOf("format", FORMATS, "number");
    const x = p.str("x");
    const fields = fieldsOf(p.str("y"));
    if (ctx.isLoading?.(box.node)) {
      const out = loadingGeometry(box, kind, isRound(kind) ? 1 : Math.min(MAX_SERIES, Math.max(1, fields.length)), p.text(), ctx);
      box.data = out.g;
      box.h = out.h;
      return;
    }
    const items = p.expr("items");
    const line = box.node.line;
    if (p.has("items") && !isList(items)) ctx.warn?.(`chart on line ${line}: items is not a list, so there's nothing to chart. Use a list of records, like items=sales`);
    let out: { g: ChartGeometry; h: number };
    if (isRound(kind)) {
      out = roundGeometry(box, pieData(items, x, fields[0] ?? ""), kind, format, p.text(), line, ctx);
    } else if (fields.length > MAX_SERIES) {
      ctx.warn?.(`chart on line ${line}: y lists ${fields.length} fields; a chart draws at most ${MAX_SERIES}`);
      const { say } = header(box, kind, p.text(), ctx);
      const g = say(`Too many series to chart: at most ${MAX_SERIES}`);
      out = { g, h: g.plot.y + g.plot.h };
    } else {
      const ys = fields.length ? fields : [""];
      const labels = labelsOf(p.str("labels"));
      const series = ys.map((field, k) => ({ field, label: labels[k] || field, color: k }));
      out = axisGeometry(box, chartSeries(items, x, ys), series, kind, format, p.text(), line, ctx);
    }
    box.data = out.g;
    box.h = out.h;
  },
  paintLoading: paintChartLoading,
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as ChartGeometry | undefined;
    if (!d) return;
    // Laid out while loading but painted after the data came: wait for the next layout.
    if (d.loading) return paintChartLoading(box, ctx);
    const ox = box.x, oy = box.y;
    const palette = seriesColors(theme);
    // One series draws in the accent, exactly as before series existed.
    const colorOf = (k: number) => (d.series.length > 1 ? palette[k % palette.length]! : c.accent);
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
      const lines = d.messageLines ?? [d.message];
      const lh = Math.round(theme.text.caption * 1.4);
      lines.forEach((l, i) => g.fillText(l, ox + d.plot.w / 2, oy + d.plot.y + d.plot.h / 2 + (i - (lines.length - 1) / 2) * lh));
      return;
    }

    // Just after its data arrived: marks grow into place while the rest fades in.
    const reveal = ctx.reveal(box.node);
    const fade = easeOut(reveal * 2.5);
    const base = g.globalAlpha;

    if (d.pie) {
      paintRound(ctx, d, ox, oy, palette, reveal);
      g.globalAlpha = base * fade;
      paintLegend(ctx, d, ox, oy, (k) => palette[k % palette.length]!);
      g.globalAlpha = base;
      return;
    }

    const px = ox + d.plot.x, pw = d.plot.w;
    g.globalAlpha = base * fade;
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

    g.globalAlpha = base;
    g.fillStyle = c.accent;
    g.strokeStyle = c.accent;
    if (d.kind === "bar") {
      const zero = d.zeroY ?? d.plot.y + d.plot.h;
      d.slots.forEach((s, i) => {
        // A wave from left to right: each bar grows out of the zero line.
        const grow = reveal < 1 ? staggered(reveal, i, d.slots.length) : 1;
        (s.bars ?? []).forEach((full, k) => {
          if (!full || full.h <= 0) return;
          const up = full.y + full.h / 2 < zero;
          const h = full.h * grow;
          if (h <= 0.25) return;
          const b = { x: full.x, y: up ? full.y + full.h - h : full.y, w: full.w, h };
          const r = Math.min(theme.radius.sm, b.w / 2, b.h / 2);
          ctx.roundRect(ox + b.x, oy + b.y, b.w, b.h, r);
          g.fillStyle = colorOf(k);
          g.fill();
        });
      });
    } else {
      // The lines run in from the left.
      g.save();
      if (reveal < 1) {
        g.beginPath();
        g.rect(px - 6, oy + d.plot.y - 6, (pw + 12) * easeOut(reveal), d.plot.h + 12);
        g.clip();
      }
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.lineCap = "round";
      d.seriesSegments.forEach((runs, k) => {
        for (const run of runs) {
          if (run.length < 2) continue;
          g.beginPath();
          run.forEach((pt, i) => (i ? g.lineTo(ox + pt.x, oy + pt.y) : g.moveTo(ox + pt.x, oy + pt.y)));
          g.strokeStyle = colorOf(k);
          g.stroke();
        }
      });
      // Dots: on every point when there's room, and always on a point with no neighbours.
      const slotW = pw / Math.max(1, d.slots.length);
      d.seriesSegments.forEach((runs, k) => {
        for (const run of runs) {
          for (const pt of run) {
            if (slotW < 10 && run.length > 1) continue;
            g.beginPath();
            g.arc(ox + pt.x, oy + pt.y, run.length === 1 ? 4 : 3, 0, Math.PI * 2);
            g.fillStyle = c.surface;
            g.fill();
            g.lineWidth = 2;
            g.strokeStyle = colorOf(k);
            g.stroke();
          }
        }
      });
      g.restore();
    }

    g.globalAlpha = base * fade;
    g.font = d.labelFont;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const s of d.slots) if (s.shownLabel) g.fillText(s.shownLabel, ox + s.labelX, oy + d.labelY);
    g.textBaseline = "middle";
    if (d.legend.length) paintLegend(ctx, d, ox, oy, colorOf);
  },
};

type PaintCtx = Parameters<NonNullable<ComponentDef["paint"]>>[1];

function paintRound(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number, palette: readonly string[], reveal = 1): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const pie = d.pie!;
  const cx = ox + pie.cx, cy = oy + pie.cy;
  // Angles are measured clockwise from the top; the canvas's 0 is at three o'clock.
  const at = (a: number) => a - Math.PI / 2;
  // Just after the data arrived, the slices sweep round from the top.
  const sweep = reveal < 1 ? Math.PI * 2 * easeOut(reveal) : Infinity;
  const base = g.globalAlpha;
  for (const s of pie.slices) {
    if (s.start >= sweep) break;
    const end = Math.min(s.end, sweep);
    g.beginPath();
    if (pie.inner) {
      g.arc(cx, cy, pie.r, at(s.start), at(end));
      g.arc(cx, cy, pie.inner, at(end), at(s.start), true);
    } else {
      g.moveTo(cx, cy);
      g.arc(cx, cy, pie.r, at(s.start), at(end));
    }
    g.closePath();
    g.fillStyle = palette[s.color % palette.length]!;
    g.fill();
  }
  // A thin surface line between slices, so neighbours read apart without relying on color.
  if (pie.slices.length > 1) {
    g.lineWidth = 2;
    g.lineCap = "butt";
    g.strokeStyle = c.surface;
    for (const s of pie.slices) {
      if (s.start >= sweep) break;
      const a = at(s.start);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * pie.inner, cy + Math.sin(a) * pie.inner);
      g.lineTo(cx + Math.cos(a) * (pie.r + 1), cy + Math.sin(a) * (pie.r + 1));
      g.stroke();
    }
  }
  if (pie.center) {
    const m = pie.center;
    g.globalAlpha = base * easeOut((reveal - 0.4) / 0.6);
    const capLH = Math.round(theme.text.caption * 1.4);
    const shift = m.caption ? capLH / 2 : 0;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = m.font;
    g.fillStyle = c.ink;
    g.fillText(m.text, cx, cy - shift);
    if (m.caption) {
      g.font = m.captionFont;
      g.fillStyle = c.muted;
      g.fillText(m.caption, cx, cy - shift + m.lh / 2 + capLH / 2);
    }
  }
}

function paintLegend(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number, colorOf: (k: number) => string): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  g.font = d.legendFont;
  g.textBaseline = "middle";
  for (const it of d.legend) {
    ctx.roundRect(ox + it.swatch.x, oy + it.swatch.y, it.swatch.w, it.swatch.h, 2);
    g.fillStyle = colorOf(it.color);
    g.fill();
    g.textAlign = "left";
    g.fillStyle = d.pie ? c.ink : c.muted;
    if (it.shownLabel) g.fillText(it.shownLabel, ox + it.labelX, oy + it.y);
    if (it.detail && it.detailX !== undefined) {
      g.textAlign = "right";
      g.fillStyle = c.muted;
      g.fillText(it.detail, ox + it.detailX, oy + it.y);
    }
  }
}
