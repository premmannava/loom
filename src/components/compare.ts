/**
 * compare and compare-row: two to four options side by side, one row per
 * attribute, with the best value in each row marked and an optional
 * recommended option highlighted. For "Plan A vs B vs C", "iPhone vs Pixel".
 *
 *   compare items=plans name=name pick="Pro"
 *     compare-row "Price" field=price format=money best=low
 *     compare-row "Storage (GB)" field=storage format=number best=high
 *     compare-row "Support" field=support
 *
 * Like a table turned on its side: options are columns, attributes are rows.
 * Rows have no box of their own; compare lays them out and draws them.
 */
import type { ComponentDef, LayoutContext } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import { drawIcon } from "../icons";
import { fitLines, wrapText } from "../text";
import type { SayShapeNode, Value } from "../types";
import { cellText, EMPTY_CELL } from "./table";
import { fillTint, themeFont } from "./util";

export const MAX_COMPARE_OPTIONS = 4;
const FORMATS = ["text", "number", "money"] as const;
const BESTS = ["low", "high"] as const;
const PAD = 12, MIN_OPTION_W = 96, MIN_STACKED_W = 56, LINES = 2;

interface Cell { lines: string[]; check?: boolean; best: boolean }
type CompareLayout = {
  title: string[];
  message?: string[];
  labelW: number;
  colW: number;
  /** Narrow: each row's label sits on its own line above the values, which use the whole width. */
  stacked: boolean;
  top: number;
  headerH: number;
  names: string[][];
  pick: number;
  /** The recommended column's label, as long as fits: RECOMMENDED, TOP PICK or nothing. */
  badge: string;
  rows: Array<{ label: string[]; cells: Cell[]; y: number; h: number }>;
  fonts: { title: string; name: string; label: string; cell: string; badge: string };
  lh: number;
  titleLH: number;
};

function rowsOf(node: SayShapeNode, ctx: Pick<LayoutContext, "visibleChildren">): SayShapeNode[] {
  return ctx.visibleChildren(node).filter((k) => k.type === "compare-row");
}

export const compare: ComponentDef = {
  type: "compare",
  category: "data",
  description: "Two to four options side by side with one row per attribute, marking the best value in each row: plans, products or choices to weigh up. Use compare-row children.",
  text: { description: "A title above the comparison." },
  props: {
    items: { type: "expression", required: true, description: "The options, a list of records, e.g. items=plans. Two to four." },
    name: { type: "name", default: "name", description: "The field holding each option's name, shown at the top of its column (default name)." },
    pick: { type: "string", description: "The name of the option to recommend: its column is highlighted and marked Recommended." },
  },
  children: ["compare-row"],
  example: `state plans=[{name: "Basic", price: 9, storage: 50, support: "Email"}, {name: "Pro", price: 19, storage: 500, support: "Chat"}, {name: "Team", price: 49, storage: 2000, support: "Phone"}]
compare items=plans pick="Pro"
  compare-row "Price a month" field=price format=money best=low
  compare-row "Storage (GB)" field=storage format=number best=high
  compare-row "Support" field=support`,
  minWidth: () => 200,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme, m = ctx.measure;
    const fonts = {
      title: themeFont(t, 600, t.text.body), name: themeFont(t, 600, t.text.body), label: themeFont(t, 400, t.text.caption + 1),
      cell: themeFont(t, 400, t.text.body), badge: themeFont(t, 600, 11),
    };
    const lh = Math.round(t.text.body * 1.35), titleLH = Math.round(t.text.body * 1.4);
    const title = p.text() ? wrapText(p.text(), box.w, fonts.title, m) : [];
    const top = title.length ? title.length * titleLH + t.space.sm : 0;
    const items = p.expr("items");
    const base: CompareLayout = { title, labelW: 0, colW: 0, stacked: false, top, headerH: 0, names: [], pick: -1, badge: "", rows: [], fonts, lh, titleLH };
    const say = (message: string, warning?: string) => {
      if (warning) ctx.warn?.(`compare on line ${box.node.line}: ${warning}`);
      const lines = fitLines(message, Math.max(20, box.w - 2 * PAD), fonts.label, m, 3);
      box.data = { ...base, message: lines };
      box.h = top + Math.max(64, lines.length * lh + PAD * 2);
    };
    if (!isList(items)) return say("Nothing to compare", p.has("items") ? "items is not a list. Use a list of records, like items=plans" : undefined);
    const options = items.filter(isRecord);
    if (options.length < 2) return say("Add at least two options to compare");
    if (options.length > MAX_COMPARE_OPTIONS) return say(`Too many options: at most ${MAX_COMPARE_OPTIONS}`, `${options.length} options is more than the ${MAX_COMPARE_OPTIONS} a comparison shows`);

    const sideW = Math.round(Math.min(160, Math.max(84, box.w * 0.28)));
    const stacked = (box.w - sideW) / options.length < MIN_OPTION_W;
    const labelW = stacked ? 0 : sideW;
    const colW = (box.w - labelW) / options.length;
    if (colW < MIN_STACKED_W) return say(`Too narrow to compare ${options.length} options`);
    const cellW = colW - (stacked ? 8 : PAD * 2);
    const nameField = p.str("name") || "name";
    const names = options.map((o) => fitLines(String(fieldOf(o, nameField) ?? EMPTY_CELL), cellW, fonts.name, m, LINES));
    const pickName = p.str("pick");
    const pick = pickName ? options.findIndex((o) => String(fieldOf(o, nameField) ?? "") === pickName) : -1;
    const badge = ["RECOMMENDED", "TOP PICK", "★"].find((b) => m.width(b, fonts.badge) <= colW - 8) ?? "";
    const headerH = (pick >= 0 ? 22 : 0) + Math.max(...names.map((n) => n.length)) * lh + PAD * 2;

    let y = box.y + top + headerH;
    const rows = rowsOf(box.node, ctx).map((r) => {
      const rp = ctx.props(r);
      const field = rp.str("field");
      const format = rp.oneOf("format", FORMATS, "text");
      const best = rp.has("best") ? rp.oneOf("best", BESTS, "high") : null;
      const values: Array<Value | undefined> = options.map((o) => fieldOf(o, field));
      const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const target = best && nums.length >= 2 && new Set(nums).size > 1 ? (best === "low" ? Math.min(...nums) : Math.max(...nums)) : null;
      const cells: Cell[] = values.map((v) => {
        if (typeof v === "boolean") return { lines: [], check: v, best: false };
        const text = cellText(v, format).text;
        return { lines: fitLines(text, cellW, fonts.cell, m, LINES), best: target !== null && v === target };
      });
      const label = fitLines(rp.text() || field, stacked ? box.w : labelW - PAD, fonts.label, m, LINES);
      const valueLines = Math.max(...cells.map((c) => c.lines.length || 1));
      const h = (stacked ? label.length + valueLines : Math.max(label.length, valueLines)) * lh + PAD * 2;
      const row = { label, cells, y, h };
      y += h;
      return row;
    });
    box.data = { ...base, labelW, colW, stacked, headerH, names, pick, badge, rows };
    box.h = y - box.y;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as CompareLayout;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.font = d.fonts.title;
    g.fillStyle = c.ink;
    d.title.forEach((l, i) => g.fillText(l, box.x, box.y + i * d.titleLH + d.titleLH / 2));
    const top = box.y + d.top;
    if (d.message) {
      const h = box.y + box.h - top;
      ctx.roundRect(box.x + 0.5, top + 0.5, box.w - 1, h - 1, theme.radius.md);
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
      g.font = d.fonts.label;
      g.fillStyle = c.muted;
      g.textAlign = "center";
      const y0 = top + h / 2 - ((d.message.length - 1) * d.lh) / 2;
      d.message.forEach((l, i) => g.fillText(l, box.x + box.w / 2, y0 + i * d.lh));
      return;
    }
    const bottom = box.y + box.h;
    const colX = (i: number) => box.x + d.labelW + i * d.colW;
    // The recommended option: a tinted, outlined column with a label on top.
    if (d.pick >= 0) {
      ctx.roundRect(colX(d.pick) + 2, top, d.colW - 4, bottom - top, theme.radius.md);
      fillTint(g, c.accent, 0.07);
      g.lineWidth = 1.5;
      g.strokeStyle = c.accent;
      g.stroke();
      g.font = d.fonts.badge;
      g.fillStyle = c.accent;
      g.textAlign = "center";
      g.fillText(d.badge, colX(d.pick) + d.colW / 2, top + PAD + 6);
    }
    // Option names.
    const nameTop = top + PAD + (d.pick >= 0 ? 22 : 0);
    g.font = d.fonts.name;
    g.fillStyle = c.ink;
    g.textAlign = "center";
    d.names.forEach((lines, i) => lines.forEach((l, j) => g.fillText(l, colX(i) + d.colW / 2, nameTop + j * d.lh + d.lh / 2)));
    // Rows: a rule above each, the label on the left, values centred.
    for (const r of d.rows) {
      g.fillStyle = c.line;
      g.fillRect(box.x, Math.round(r.y), box.w, 1);
      g.font = d.fonts.label;
      g.fillStyle = c.muted;
      g.textAlign = "left";
      // Side by side, the label is centred on the row; stacked, it heads the row and values sit under it.
      const labelH = r.label.length * d.lh;
      const ly = d.stacked ? r.y + PAD + d.lh / 2 : r.y + r.h / 2 - ((r.label.length - 1) * d.lh) / 2;
      r.label.forEach((l, j) => g.fillText(l, box.x, ly + j * d.lh));
      const valueTop = d.stacked ? r.y + PAD + labelH : r.y;
      const valueH = d.stacked ? r.h - PAD - labelH : r.h;
      r.cells.forEach((cell, i) => {
        const cx = colX(i) + d.colW / 2;
        if (cell.check !== undefined) {
          drawIcon(g, cell.check ? "check" : "minus", cx - 9, valueTop + valueH / 2 - 9, 18, cell.check ? c.good : c.muted);
          return;
        }
        g.font = cell.best ? d.fonts.name : d.fonts.cell;
        g.fillStyle = cell.best ? c.good : cell.lines[0] === EMPTY_CELL ? c.muted : c.ink;
        g.textAlign = "center";
        const cy = valueTop + valueH / 2 - ((cell.lines.length - 1) * d.lh) / 2;
        cell.lines.forEach((l, j) => g.fillText(l, cx, cy + j * d.lh));
      });
    }
  },
};

export const compareRow: ComponentDef = {
  type: "compare-row",
  category: "data",
  description: "One row of a comparison: an attribute and the field each option's value comes from.",
  text: { description: "The attribute's name. Defaults to the field name." },
  props: {
    field: { type: "name", required: true, description: "The field of each option to show, e.g. field=price. true and false show as a check and a dash." },
    format: { type: "enum", values: FORMATS, default: "text", description: "text, number (1,200.5) or money ($1,200.00)." },
    best: { type: "enum", values: BESTS, description: "low or high: mark the lowest or highest number in the row as the best. Leave out when neither is better." },
  },
  parents: ["compare"],
  example: `compare-row "Price a month" field=price format=money best=low`,
  // Rows have no box of their own: compare lays them out and draws them.
  layout(box) {
    box.h = 0;
  },
};
