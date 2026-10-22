/**
 * table and table-column: a list of records as rows, one declared column per
 * field, with optional sorting and single-row selection kept in state.
 *
 *   state equipment=[{id: "laptop", name: "Laptop", price: 1200}] picked="" by="name" dir="asc"
 *   table "Equipment" items=equipment key=id bind=picked sort=by direction=dir
 *     table-column "Item" field=name
 *     table-column "Price" field=price format=money
 *
 * Layout works out everything (column widths, which rows are where, the text
 * each cell shows, which rows can be selected) into a TableGeometry on
 * box.data, relative to the box. paint draws it and registers hit regions;
 * press writes state. Nothing is written during layout or paint, and the
 * source list is never changed: sorting orders a list of indices.
 *
 * Rules (also in the README):
 * - Cells: text columns show text as is, numbers as 1,200.5 and true/false
 *   as Yes/No. number and money columns show only numbers; anything else is
 *   the placeholder "—", as are missing fields, null and lists or records.
 *   0 and false are values, not missing. Money is US dollars, like money().
 * - Sorting: ascending puts numbers (by value), then text (by en-US
 *   collation, numbers inside text compared as numbers), then true/false;
 *   descending reverses that. Missing values always go last. Equal values
 *   keep their list order.
 * - Selection stores the row's key= field (text or a finite number, 0
 *   included). Rows whose key is missing or repeats an earlier row's can't
 *   be selected. A selected key no row has selects nothing; state is left as
 *   it is.
 * - At most MAX_TABLE_ROWS rows and MAX_TABLE_COLUMNS columns, and only
 *   when the columns fit the width; otherwise a message replaces the table.
 */
import type { ComponentDef, LayoutContext, PaintContext, PropReader } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import type { TextMeasurer } from "../text";
import { wrapText } from "../text";
import type { Theme } from "../theme";
import type { Box, SayShapeNode, Value } from "../types";
import { chevron, fillTint, onProp, partBox, runOn, themeFont } from "./util";

/** The most rows one table shows. Larger lists show a message: page them with take() or pagination. */
export const MAX_TABLE_ROWS = 200;
/** The most columns one table shows. */
export const MAX_TABLE_COLUMNS = 8;
/** The placeholder for a missing or unusable value. */
export const EMPTY_CELL = "—";

const FORMATS = ["text", "number", "money"] as const;
const ALIGNS = ["left", "right"] as const;
type Format = (typeof FORMATS)[number];
type Align = (typeof ALIGNS)[number];
const LOCALE = "en-US";
/** Text columns shrink to this before the table gives up (numbers never shrink). */
const MIN_TEXT_COLUMN = 72;
/** Room for the sort arrow beside a header. */
const ARROW = 14;

export interface Rect { x: number; y: number; w: number; h: number }

export interface TableColumn {
  field: string;
  label: string;
  /** The header as drawn, cut to fit. */
  shownLabel: string;
  format: Format;
  align: Align;
  x: number;
  w: number;
  /** The direction shown on this column's header, when the table is sorted by it. */
  sorted: "asc" | "desc" | null;
}

export interface TableRow {
  /** The item's position in the list (not on screen). */
  index: number;
  y: number;
  h: number;
  /** The key= value, or null when it's missing, not text or a number, or a repeat. */
  key: string | number | null;
  selectable: boolean;
  selected: boolean;
  /** The hit-region detail for a selectable row. */
  detail: string | null;
  /** Each cell's text as drawn (cut to fit), and in full. */
  cells: Array<{ text: string; full: string }>;
}

/** Everything paint and press need, relative to the table's box. */
export type TableGeometry = {
  title: string[];
  titleFont: string;
  titleLH: number;
  headerFont: string;
  cellFont: string;
  /** Shown instead of rows and columns: too many, too narrow, no columns. */
  message?: string;
  /** The bordered area: header, rows and any empty message. */
  frame: Rect;
  headerH: number;
  columns: TableColumn[];
  rows: TableRow[];
  /** Shown under the header when there are no rows. */
  empty?: string;
  sortable: boolean;
};

// ---------------------------------------------------------------- cells

function formatNumber(v: number, money: boolean): string {
  const huge = Math.abs(v) >= 1e15, tiny = !money && v !== 0 && Math.abs(v) < 0.01;
  // Very large or small numbers in scientific form, so they're never cut or shown as 0.
  const opts: Intl.NumberFormatOptions = huge || tiny ? { notation: "scientific", maximumFractionDigits: 3 } : money ? {} : { maximumFractionDigits: 2 };
  if (money) Object.assign(opts, { style: "currency", currency: "USD" });
  return new Intl.NumberFormat(LOCALE, opts).format(v);
}

/** A cell's text, and whether the value didn't suit its column (for one warning). */
export function cellText(v: Value | undefined, format: Format): { text: string; incompatible: boolean } {
  if (v === undefined || v === null) return { text: EMPTY_CELL, incompatible: false };
  if (format === "text") {
    if (typeof v === "string") return { text: v, incompatible: false };
    if (typeof v === "number") return { text: formatNumber(v, false), incompatible: false };
    if (typeof v === "boolean") return { text: v ? "Yes" : "No", incompatible: false };
    return { text: EMPTY_CELL, incompatible: true };
  }
  // A number column never reads text like "12" as a number.
  if (typeof v === "number") return { text: formatNumber(v, format === "money"), incompatible: false };
  return { text: EMPTY_CELL, incompatible: true };
}

// ---------------------------------------------------------------- sorting

const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: "base" });
const rank = (v: Value | undefined) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);

function compareValues(a: Value | undefined, b: Value | undefined): number {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

/**
 * The order to show items in, as indices into the list: by a field, with
 * missing values last either way and ties in list order. The list itself is
 * never changed.
 */
export function sortedOrder(items: readonly Value[], field: string | null, direction: "asc" | "desc"): number[] {
  const order = items.map((_, i) => i);
  if (!field) return order;
  const values = items.map((item) => (isRecord(item) ? fieldOf(item, field) : undefined));
  const sign = direction === "desc" ? -1 : 1;
  return order.sort((i, j) => {
    const a = values[i], b = values[j];
    const ma = rank(a) === 3, mb = rank(b) === 3;
    if (ma || mb) return ma === mb ? i - j : ma ? 1 : -1;
    return sign * compareValues(a, b) || i - j;
  });
}

// ---------------------------------------------------------------- keys

/** A row's selection key: text or a finite number, else null. */
export function keyOf(item: Value, field: string): string | number | null {
  if (!isRecord(item)) return null;
  const k = fieldOf(item, field);
  return typeof k === "string" || (typeof k === "number" && isFinite(k)) ? k : null;
}

const rowDetail = (key: string | number) => `row:${typeof key === "number" ? "n" : "s"}:${key}`;
const sortDetail = (field: string) => `sort:${field}`;

/** The key a row detail stands for. */
function keyFromDetail(detail: string): string | number | null {
  const m = /^row:([ns]):([\s\S]*)$/.exec(detail);
  if (!m) return null;
  return m[1] === "n" ? Number(m[2]) : m[2]!;
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

/**
 * Column widths for the space there is: their natural widths when they fit
 * (with the extra shared out), otherwise text columns are narrowed, widest
 * first, but never below their minimum. null when even the minimums don't fit.
 */
export function fitColumns(natural: readonly number[], minimum: readonly number[], width: number, grow?: readonly boolean[]): number[] | null {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= width) {
    // Spare room goes to the columns that grow (text), so numbers stay snug; else to all.
    const growing = natural.map((n, i) => (grow?.some(Boolean) ? (grow[i] ? n : 0) : n));
    const share = growing.reduce((a, b) => a + b, 0);
    const extra = width - total;
    return natural.map((n, i) => n + (share > 0 ? (extra * growing[i]!) / share : extra / natural.length));
  }
  if (minimum.reduce((a, b) => a + b, 0) > width + 1e-6) return null;
  // The widest a column may be so that everything fits (a cap on the wide ones).
  const widths = (cap: number) => natural.map((n, i) => Math.max(minimum[i]!, Math.min(n, cap)));
  let lo = 0, hi = Math.max(...natural);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (widths(mid).reduce((a, b) => a + b, 0) <= width) lo = mid;
    else hi = mid;
  }
  const w = widths(lo);
  // Give back what rounding left, to the columns that were narrowed.
  const left = width - w.reduce((a, b) => a + b, 0);
  const cut = w.map((x, i) => (x < natural[i]! ? 1 : 0));
  const n = cut.reduce<number>((a, b) => a + b, 0);
  return n && left > 0 ? w.map((x, i) => x + (cut[i] ? left / n : 0)) : w;
}

interface ColumnSpec { field: string; label: string; format: Format; align: Align }

function readColumns(node: SayShapeNode, ctx: Pick<LayoutContext, "visibleChildren" | "props">): ColumnSpec[] {
  return ctx.visibleChildren(node).filter((c) => c.type === "table-column").map((c) => {
    const p = ctx.props(c);
    const field = p.str("field");
    const format = p.oneOf("format", FORMATS, "text");
    return { field, label: p.text(field), format, align: p.oneOf("align", ALIGNS, format === "text" ? "left" : "right") };
  });
}

function tableLayout(box: { w: number; node: SayShapeNode }, p: PropReader, ctx: Pick<LayoutContext, "theme" | "measure" | "warn" | "visibleChildren" | "props">): TableGeometry {
  const t: Theme = ctx.theme, m = ctx.measure;
  const line = box.node.line;
  const warn = (msg: string) => ctx.warn?.(`table on line ${line}: ${msg}`);
  const titleFont = themeFont(t, 600, t.text.body), headerFont = themeFont(t, 600, t.text.caption), cellFont = themeFont(t, 400, t.text.body);
  const titleLH = Math.round(t.text.body * 1.4);
  const pad = t.space.md;
  const headerH = Math.round(t.text.caption * 1.4) + 2 * t.space.sm;
  const rowH = Math.round(t.text.body * 1.4) + 2 * t.space.sm;
  const title = p.text() ? wrapText(p.text(), box.w, titleFont, m) : [];
  const top = title.length ? title.length * titleLH + t.space.sm : 0;
  const base: TableGeometry = { title, titleFont, titleLH, headerFont, cellFont, frame: { x: 0, y: top, w: box.w, h: 0 }, headerH, columns: [], rows: [], sortable: false };
  const say = (message: string): TableGeometry => ({ ...base, message, frame: { x: 0, y: top, w: box.w, h: Math.max(rowH * 2, 64) } });

  const specs = readColumns(box.node, ctx);
  // No columns yet is normal while a spec streams in, so it isn't a warning.
  if (!specs.length) return say("No columns yet");
  if (specs.length > MAX_TABLE_COLUMNS) {
    warn(`${specs.length} columns is more than the ${MAX_TABLE_COLUMNS} a table shows. Keep the most useful ones`);
    return say(`Too many columns: at most ${MAX_TABLE_COLUMNS}`);
  }

  const raw = p.expr("items");
  if (p.has("items") && !isList(raw)) warn(`items is not a list. Use a list of records, like items=equipment`);
  const items: readonly Value[] = isList(raw) ? raw : [];
  if (items.length > MAX_TABLE_ROWS) {
    warn(`${items.length} rows is more than the ${MAX_TABLE_ROWS} a table shows. Show a page with take() or pagination`);
    return say(`Too many rows to show: ${items.length}, at most ${MAX_TABLE_ROWS}`);
  }

  // Sorting: only by a field one of the columns shows.
  const sortable = p.has("sort");
  const sortValue = p.bound("sort");
  const sortField = typeof sortValue === "string" && specs.some((c) => c.field === sortValue) ? sortValue : null;
  const direction = p.bound("direction") === "desc" ? "desc" : "asc";
  const order = sortedOrder(items, sortField, direction);

  // Keys, in list order, so the first of two rows with one key keeps it however they're sorted.
  const keyField = p.has("key") ? p.str("key") : "";
  const bindable = p.has("bind");
  if (bindable && !keyField) warn(`bind= needs key= naming a field that identifies each row, like key=id`);
  const keys = items.map((item) => (keyField ? keyOf(item, keyField) : null));
  const seen = new Set<string>();
  let missingKeys = 0, duplicates = 0;
  const usable = keys.map((k) => {
    if (k === null) { if (keyField) missingKeys++; return false; }
    const id = `${typeof k}:${k}`;
    if (seen.has(id)) { duplicates++; return false; }
    seen.add(id);
    return true;
  });
  if (bindable && missingKeys) warn(`${missingKeys} rows have no text or number in "${keyField}", so they can't be selected`);
  if (bindable && duplicates) warn(`${duplicates} rows repeat another row's "${keyField}", so only the first of each can be selected. Keys should be unique`);
  const selectedValue = p.bound("bind");

  // Cell text, in the order shown.
  let malformed = 0, incompatible = 0;
  const texts = order.map((i) => {
    const item = items[i]!;
    if (!isRecord(item)) malformed++;
    return specs.map((c) => {
      const r = cellText(isRecord(item) ? fieldOf(item, c.field) : undefined, c.format);
      if (r.incompatible && isRecord(item)) incompatible++;
      return r.text;
    });
  });
  if (malformed) warn(`${malformed} items aren't records, so their cells show ${EMPTY_CELL}`);
  if (incompatible) warn(`${incompatible} cells hold a value their column can't show (number and money columns need numbers), so they show ${EMPTY_CELL}`);

  // Column widths from what they hold.
  const headerW = specs.map((c) => m.width(c.label, headerFont) + (sortable ? ARROW : 0) + 2 * pad);
  const cellW = specs.map((_, ci) => Math.max(0, ...texts.map((row) => m.width(row[ci]!, cellFont))) + 2 * pad);
  const natural = specs.map((_, ci) => Math.max(headerW[ci]!, cellW[ci]!));
  // Numbers are never cut short; text and headers can be.
  const minimum = specs.map((c, ci) => (c.format === "text" ? Math.min(natural[ci]!, MIN_TEXT_COLUMN) : Math.max(cellW[ci]!, Math.min(headerW[ci]!, MIN_TEXT_COLUMN))));
  const widths = fitColumns(natural, minimum, box.w, specs.map((c) => c.format === "text"));
  if (!widths) {
    const need = Math.ceil(minimum.reduce((a, b) => a + b, 0));
    warn(`${specs.length} columns need about ${need} pixels and there are ${Math.round(box.w)}. Use fewer columns, or a list`);
    return say(`Too narrow to show ${specs.length} columns`);
  }

  let x = 0;
  const columns: TableColumn[] = specs.map((c, ci) => {
    const w = widths[ci]!;
    const col: TableColumn = {
      ...c, x, w,
      shownLabel: fit(c.label, w - 2 * pad - (sortable ? ARROW : 0), headerFont, m),
      sorted: sortField === c.field ? direction : null,
    };
    x += w;
    return col;
  });

  const rowsTop = top + headerH;
  const rows: TableRow[] = order.map((i, r) => {
    const key = usable[i] ? keys[i]! : null;
    const selectable = bindable && key !== null;
    return {
      index: i,
      y: rowsTop + r * rowH,
      h: rowH,
      key,
      selectable,
      selected: selectable && selectedValue === key,
      detail: selectable ? rowDetail(key) : null,
      cells: texts[r]!.map((full, ci) => ({ full, text: fit(full, columns[ci]!.w - 2 * pad, cellFont, m) })),
    };
  });
  const emptyH = items.length ? 0 : rowH * 1.5;
  return {
    ...base,
    frame: { x: 0, y: top, w: box.w, h: headerH + rows.length * rowH + emptyH },
    columns,
    rows,
    empty: items.length ? undefined : isList(raw) ? "Nothing to show" : "No data",
    sortable,
  };
}

// ---------------------------------------------------------------- paint

function paintTable(box: Box, ctx: PaintContext): void {
  const d = box.data as TableGeometry | undefined;
  if (!d) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const pad = theme.space.md;
  g.textBaseline = "middle";

  g.font = d.titleFont;
  g.fillStyle = c.ink;
  g.textAlign = "left";
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));

  const f = d.frame;
  ctx.roundRect(ox + f.x + 0.5, oy + f.y + 0.5, f.w - 1, f.h - 1, theme.radius.md);
  g.strokeStyle = c.line;
  g.lineWidth = 1;
  g.stroke();

  if (d.message) {
    g.font = d.cellFont;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(d.message, ox + f.w / 2, oy + f.y + f.h / 2);
    return;
  }

  const rule = (y: number) => {
    g.beginPath();
    g.moveTo(ox + f.x + 1, Math.round(oy + y) + 0.5);
    g.lineTo(ox + f.x + f.w - 1, Math.round(oy + y) + 0.5);
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
  };
  const focusRing = (x: number, y: number, w: number, h: number) => {
    ctx.roundRect(x + 2, y + 2, w - 4, h - 4, theme.radius.sm);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  };

  // Header: a pressable cell per column when the table sorts.
  const hy = oy + f.y;
  g.font = d.headerFont;
  for (const col of d.columns) {
    const cell = partBox(box, ox + col.x, hy, col.w, d.headerH);
    const detail = sortDetail(col.field);
    const hovered = d.sortable && ctx.isHovered(box.node, detail);
    if (d.sortable) ctx.addHit(cell, { detail });
    g.fillStyle = col.sorted || hovered ? c.ink : c.muted;
    // The label lines up with the cells; the arrow goes on its far side from that edge.
    const right = col.align === "right";
    g.textAlign = right ? "right" : "left";
    const tx = right ? ox + col.x + col.w - pad : ox + col.x + pad;
    g.fillText(col.shownLabel, tx, hy + d.headerH / 2);
    if (col.sorted || hovered) {
      const labelW = g.measureText(col.shownLabel).width;
      const ax = right ? tx - labelW - 9 : tx + labelW + 9;
      chevron(g, ax, hy + d.headerH / 2, 8, col.sorted === "desc" ? "down" : "up", col.sorted ? c.accent : c.muted);
    }
    if (d.sortable && ctx.isFocused(box.node, detail)) focusRing(cell.x, cell.y, cell.w, cell.h);
  }
  rule(f.y + d.headerH);

  // Rows.
  g.font = d.cellFont;
  d.rows.forEach((row, r) => {
    const ry = oy + row.y;
    const last = r === d.rows.length - 1;
    if (row.selected || (row.detail && ctx.isHovered(box.node, row.detail))) {
      if (last) ctx.roundRect(ox + f.x + 1, ry, f.w - 2, row.h - 1, theme.radius.md - 1);
      else { g.beginPath(); g.rect(ox + f.x + 1, ry, f.w - 2, row.h); }
      fillTint(g, row.selected ? c.accent : c.ink, row.selected ? 0.12 : 0.04);
    }
    if (row.selected) {
      g.beginPath();
      g.rect(ox + f.x + 1, ry + 4, 3, row.h - 8);
      g.fillStyle = c.accent;
      g.fill();
    }
    if (row.detail) ctx.addHit(partBox(box, ox + f.x, ry, f.w, row.h), { detail: row.detail });
    d.columns.forEach((col, ci) => {
      const cell = row.cells[ci]!;
      g.fillStyle = cell.full === EMPTY_CELL ? c.muted : c.ink;
      const right = col.align === "right";
      g.textAlign = right ? "right" : "left";
      g.fillText(cell.text, right ? ox + col.x + col.w - pad : ox + col.x + pad, ry + row.h / 2);
    });
    if (!last) rule(row.y + row.h);
    if (row.detail && ctx.isFocused(box.node, row.detail)) focusRing(ox + f.x, ry, f.w, row.h);
  });

  if (d.empty) {
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(d.empty, ox + f.w / 2, oy + f.y + d.headerH + (f.h - d.headerH) / 2);
  }
}

// ---------------------------------------------------------------- components

export const table: ComponentDef = {
  type: "table",
  category: "data",
  description:
    "Rows of a list of records, one table-column per field, for things like inventory, orders or expenses. With sort= and direction=, pressing a header sorts by it; with bind= and key=, pressing a row selects it.",
  text: { description: "A title above the table." },
  props: {
    items: { type: "expression", required: true, description: `The list of records, e.g. items=equipment. At most ${MAX_TABLE_ROWS} rows; show a page of a longer list with take() or pagination.` },
    key: { type: "name", description: "The field that identifies each row, e.g. key=id. Needed for bind=." },
    bind: { type: "state", description: "State that holds the selected row's key. Pressing a row sets it." },
    sort: { type: "state", description: "State that holds the field to sort by. Pressing a header sets it; missing values sort last." },
    direction: { type: "state", description: "State that holds asc or desc. Pressing the sorted header again flips it." },
    on: onProp("after a row is selected, with bind= already set"),
  },
  children: ["table-column"],
  example: `state gear=[{id: "tent", name: "Tent", price: 180}, {id: "stove", name: "Stove", price: 45}] picked="" by="name" dir="asc"
table items=gear key=id bind=picked sort=by direction=dir
  table-column "Item" field=name
  table-column "Price" field=price format=money`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const geo = tableLayout(box, p, ctx);
    box.data = geo;
    box.h = geo.frame.y + geo.frame.h;
  },
  paint: paintTable,
  press(ctx) {
    const detail = ctx.target.detail;
    if (typeof detail !== "string") return;
    const p = ctx.props(ctx.target.node);
    if (detail.startsWith("sort:")) {
      const field = detail.slice(5);
      const sortPath = p.raw("sort"), dirPath = p.raw("direction");
      if (!sortPath) return;
      if (p.bound("sort") === field && dirPath) {
        ctx.set(dirPath, p.bound("direction") === "desc" ? "asc" : "desc");
      } else {
        ctx.set(sortPath, field);
        if (dirPath) ctx.set(dirPath, "asc");
      }
      return;
    }
    const key = keyFromDetail(detail);
    const bind = p.raw("bind");
    if (key === null || !bind) return;
    ctx.set(bind, key);
    runOn(ctx);
  },
  cursor: () => "pointer",
};

export const tableColumn: ComponentDef = {
  type: "table-column",
  category: "data",
  description: "One column of a table: its header and the field it shows.",
  text: { description: "The header. Defaults to the field name." },
  props: {
    field: { type: "name", required: true, description: "The field of each record to show, e.g. field=price." },
    format: { type: "enum", values: FORMATS, default: "text", description: "text, number (1,200.5) or money ($1,200.00, US dollars). number and money show only numbers; other values show —." },
    align: { type: "enum", values: ALIGNS, description: "left or right. Default: right for number and money, left for text." },
  },
  parents: ["table"],
  example: `table-column "Price" field=price format=money`,
  // Columns have no box of their own: the table lays them out and draws them.
  layout(box) {
    box.h = 0;
  },
};
