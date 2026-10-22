/**
 * select: one choice from a list, shown as a field that opens a list of
 * options in a popup (src/popup.ts).
 *
 *   state departments=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}] department=""
 *   select "Department" items=departments value=id label=name bind=department placeholder="Choose a department"
 *
 * Options come from items=, a list of records (value= and label= name their
 * fields) or of plain text and numbers (each is its own value and label).
 *
 * Rules (also in the README):
 * - A value is text or a finite number, 0 included. Items without one, or
 *   repeating an earlier option's value, aren't offered (with a warning).
 * - unavailable= names a field that, when true, shows an option greyed out;
 *   it can't be chosen by pointer or keyboard.
 * - bind= holds the chosen value. A value no option has shows the
 *   placeholder (with a warning, unless it's "" or null); state is left as is.
 * - At most MAX_SELECT_OPTIONS options; more, none, or items that aren't a
 *   list show a message in the field, which then doesn't open.
 * - Which option is highlighted and how far the list is scrolled are the
 *   popup's own, kept by the engine, never in state. Choosing writes bind=,
 *   closes the list (focus back on the field), then runs on=.
 */
import type { ComponentDef, LayoutContext, PaintContext, PopupContext, PressContext, PropReader } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import type { PopupState } from "../popup";
import type { Box, Rect, Value } from "../types";
import { FIELD_PAD, FIELD_TEXT, fieldBox, fitText, LABEL_SIZE } from "./input";
import { chevron, fillTint, onProp, partBox, runOn } from "./util";

/** The most options one select offers. Narrow longer lists with filter() or search(). */
export const MAX_SELECT_OPTIONS = 200;
/** Option rows shown at once before the list scrolls. */
export const VISIBLE_OPTIONS = 8;
const ROW_H = 40;
const PANEL_PAD = 4;
/** The strips at the top and bottom of a long list that scroll it. */
const MORE_H = 24;
const LOCALE = "en-US";

export interface SelectOption {
  value: string | number;
  label: string;
  available: boolean;
  /** The value as a hit-region detail key: "n:0" or "s:eng". */
  key: string;
}

export interface SelectOptions {
  options: SelectOption[];
  /** Why there's nothing to choose from, when that's so. */
  problem?: "not-list" | "empty" | "too-many";
  /** Items left out: no usable value, or a value an earlier option has. */
  missing: number;
  duplicates: number;
}

export const optionKey = (v: string | number) => `${typeof v === "number" ? "n" : "s"}:${v}`;
const asText = (v: Value | undefined): string | null =>
  typeof v === "string" ? v : typeof v === "number" && isFinite(v) ? new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(v) : null;

/** The options a select offers, from its props, in list order. Never changes the data. */
export function selectOptions(items: Value | undefined, valueField: string, labelField: string, unavailableField: string): SelectOptions {
  if (!isList(items)) return { options: [], problem: "not-list", missing: 0, duplicates: 0 };
  if (!items.length) return { options: [], problem: "empty", missing: 0, duplicates: 0 };
  if (items.length > MAX_SELECT_OPTIONS) return { options: [], problem: "too-many", missing: 0, duplicates: 0 };
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  let missing = 0, duplicates = 0;
  for (const item of items) {
    const record = isRecord(item);
    const raw = record ? (valueField ? fieldOf(item, valueField) : undefined) : item;
    const value = typeof raw === "string" || (typeof raw === "number" && isFinite(raw)) ? raw : null;
    if (value === null) { missing++; continue; }
    const key = optionKey(value);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const label = (record && labelField ? asText(fieldOf(item, labelField)) : null) ?? asText(value) ?? String(value);
    const available = !(record && unavailableField && fieldOf(item, unavailableField) === true);
    options.push({ value, label, available, key });
  }
  return { options, missing, duplicates, problem: options.length ? undefined : "empty" };
}

function readOptions(p: PropReader): SelectOptions {
  return selectOptions(p.expr("items"), p.str("value"), p.str("label"), p.str("unavailable"));
}

/** What the field shows: the chosen option's label, the placeholder, or why it can't open. */
function fieldText(p: PropReader, o: SelectOptions): { text: string; muted: boolean; openable: boolean } {
  if (o.problem === "too-many") return { text: "Too many options", muted: true, openable: false };
  if (o.problem) return { text: "No options", muted: true, openable: false };
  const chosen = p.bound();
  const match = o.options.find((x) => x.value === chosen);
  if (match) return { text: match.label, muted: false, openable: true };
  return { text: p.str("placeholder", "Choose…"), muted: true, openable: true };
}

// ---------------------------------------------------------------- the list

/** How an option list fits a popup area: rows shown at once, and room for the scroll strips. */
export function listLayout(area: Rect, count: number): { visible: number; moreH: number; top: number } {
  const inner = area.h - 2 * PANEL_PAD;
  const fitsAll = count * ROW_H <= inner + 0.5;
  const moreH = fitsAll ? 0 : MORE_H;
  const visible = fitsAll ? count : Math.max(1, Math.floor((inner - 2 * moreH) / ROW_H));
  return { visible, moreH, top: area.y + PANEL_PAD + moreH };
}

const indexOf = (o: SelectOptions, key: Value | undefined) => o.options.findIndex((x) => x.key === key);

/** The first row shown: as scrolled, or (before any scrolling) with the highlight in view. Never past the ends. */
export function scrollOf(state: PopupState, o: SelectOptions, visible: number): number {
  const max = Math.max(0, o.options.length - visible);
  const hi = indexOf(o, state.highlight);
  const s = typeof state.scroll === "number" ? state.scroll : hi < 0 ? 0 : hi - Math.floor((visible - 1) / 2);
  return Math.max(0, Math.min(max, s));
}

/** The highlighted option's index: as kept, or the first available one when that's gone. */
function highlightOf(state: PopupState, o: SelectOptions): number {
  const i = indexOf(o, state.highlight);
  return i >= 0 && o.options[i]!.available ? i : o.options.findIndex((x) => x.available);
}

/** The next available option from i in a direction, or i when there's none. */
function step(o: SelectOptions, i: number, dir: 1 | -1, by = 1): number {
  let found = i, moved = 0;
  for (let j = i + dir; j >= 0 && j < o.options.length; j += dir) {
    if (!o.options[j]!.available) continue;
    found = j;
    if (++moved >= by) break;
  }
  return found;
}

/** Highlight an option and scroll just enough to show it. */
function highlight(state: PopupState, o: SelectOptions, i: number, visible: number): void {
  if (i < 0) return;
  const s = scrollOf(state, o, visible);
  state.highlight = o.options[i]!.key;
  state.scroll = i < s ? i : i >= s + visible ? i - visible + 1 : s;
}

function choose(ctx: PopupContext, option: SelectOption): void {
  const bind = ctx.props(ctx.target.node).raw("bind");
  if (!bind || !option.available) return;
  ctx.set(bind, option.value);
  ctx.close(true);
  runOn(ctx);
}

/** Open the list with the chosen option (or the first available one) highlighted. */
function open(ctx: PressContext): void {
  const p = ctx.props(ctx.target.node);
  if (p.cond("disabled")) return;
  const o = readOptions(p);
  if (!fieldText(p, o).openable) return;
  const chosen = o.options.find((x) => x.value === p.bound() && x.available);
  ctx.openPopup({ highlight: (chosen ?? o.options.find((x) => x.available))?.key ?? null, scroll: null });
}

function paintList(owner: Box, area: Rect, ctx: PaintContext, state: PopupState): void {
  const p = ctx.props(owner.node);
  const o = readOptions(p);
  const { g, theme } = ctx;
  const c = theme.colors;
  const { visible, moreH, top } = listLayout(area, o.options.length);
  const scroll = scrollOf(state, o, visible);
  const hi = highlightOf(state, o);
  const chosen = p.bound();
  const inset = PANEL_PAD;

  if (moreH) {
    // Scroll strips, pressable only when there's more that way, so every option can be reached.
    const strips: Array<["up" | "down", number, boolean]> = [
      ["up", area.y + PANEL_PAD, scroll > 0],
      ["down", area.y + area.h - PANEL_PAD - moreH, scroll + visible < o.options.length],
    ];
    for (const [dir, y, live] of strips) {
      const strip = partBox(owner, area.x + inset, y, area.w - 2 * inset, moreH);
      if (live) {
        ctx.addHit(strip, { detail: `more:${dir}`, focusable: false });
        if (ctx.isHovered(owner.node, `more:${dir}`)) { ctx.roundRect(strip.x, strip.y, strip.w, strip.h, theme.radius.sm); fillTint(g, c.ink, 0.05); }
      }
      chevron(g, strip.x + strip.w / 2, y + moreH / 2, 9, dir, live ? c.ink : c.line);
    }
  }

  g.font = ctx.font(400, FIELD_TEXT);
  g.textBaseline = "middle";
  g.textAlign = "left";
  for (let i = scroll; i < Math.min(o.options.length, scroll + visible); i++) {
    const opt = o.options[i]!;
    const row = partBox(owner, area.x + inset, top + (i - scroll) * ROW_H, area.w - 2 * inset, ROW_H);
    const detail = `opt:${opt.key}`;
    if (opt.available) ctx.addHit(row, { detail, focusable: false });
    const isChosen = opt.value === chosen;
    if (i === hi || (opt.available && ctx.isHovered(owner.node, detail))) {
      ctx.roundRect(row.x, row.y + 1, row.w, row.h - 2, theme.radius.sm);
      fillTint(g, i === hi ? c.accent : c.ink, i === hi ? 0.14 : 0.05);
    }
    g.font = ctx.font(isChosen ? 600 : 400, FIELD_TEXT);
    g.fillStyle = opt.available ? c.ink : c.muted;
    const markW = 22;
    g.fillText(fitText(g, opt.label, row.w - FIELD_PAD * 2 - markW), row.x + FIELD_PAD, row.y + ROW_H / 2 + 1);
    if (isChosen) {
      // A check mark beside the chosen option.
      const cx = row.x + row.w - FIELD_PAD - 7, cy = row.y + ROW_H / 2;
      g.beginPath();
      g.moveTo(cx - 6, cy);
      g.lineTo(cx - 2, cy + 4);
      g.lineTo(cx + 6, cy - 5);
      g.strokeStyle = c.accent;
      g.lineWidth = 2;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.stroke();
    }
  }
}

export const select: ComponentDef = {
  type: "select",
  category: "input",
  description:
    "A field that opens a list to pick one option from, for choices like a department, status or filter; compact where radio buttons would take too much room. bind= holds the chosen option's value.",
  text: { description: "The label above the field." },
  props: {
    items: { type: "expression", required: true, description: `The options: a list of records, or of text or numbers. At most ${MAX_SELECT_OPTIONS}.` },
    value: { type: "name", description: "For records, the field holding each option's value (text or a number), e.g. value=id. Options without one, or repeating one, are left out." },
    label: { type: "name", description: "For records, the field shown for each option, e.g. label=name. Default: the value." },
    bind: { type: "state", required: true, description: "State that holds the chosen value, like department or t.status." },
    placeholder: { type: "string", default: "Choose…", description: "Shown while nothing (or a value no option has) is chosen." },
    unavailable: { type: "name", description: "A field that, when true, greys an option out so it can't be chosen, e.g. unavailable=full." },
    disabled: { type: "condition", description: "Expression; when true the field is greyed out and doesn't open." },
    on: onProp("after an option is chosen, with bind= already set"),
  },
  example: `state teams=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}] team=""
select "Team" items=teams value=id label=name bind=team placeholder="Choose a team"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    box.h = fieldBox(box, p, ctx.theme.control.height).y - box.y + ctx.theme.control.height;
    warnAbout(box, p, ctx);
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const o = readOptions(p);
    const shown = fieldText(p, o);
    const disabled = p.cond("disabled") || !shown.openable;
    const isOpen = ctx.isPopupOpen(box.node);
    const field = fieldBox(box, p, theme.control.height);
    const hot = !disabled && ctx.isHovered(box.node);
    g.save();
    if (p.cond("disabled")) g.globalAlpha *= 0.45;
    const label = p.text();
    if (label) {
      g.font = ctx.font(600, LABEL_SIZE);
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = c.ink;
      g.fillText(label, box.x, box.y, box.w);
    }
    ctx.roundRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1, theme.radius.md);
    g.fillStyle = c.surface;
    g.fill();
    g.strokeStyle = isOpen ? c.accent : hot ? c.muted : c.line;
    g.lineWidth = isOpen ? 1.5 : 1;
    g.stroke();
    g.font = ctx.font(400, FIELD_TEXT);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = shown.muted ? c.muted : c.ink;
    const arrowRoom = 24;
    g.fillText(fitText(g, shown.text, field.w - FIELD_PAD * 2 - arrowRoom), field.x + FIELD_PAD, field.y + field.h / 2 + 1);
    chevron(g, field.x + field.w - FIELD_PAD - 6, field.y + field.h / 2, 10, isOpen ? "up" : "down", disabled ? c.line : c.muted);
    g.restore();
    if (!disabled) ctx.addHit(field);
  },
  press(ctx) {
    if (!ctx.popupOpen) open(ctx);
  },
  key(ctx, key) {
    if (key !== "ArrowDown" && key !== "ArrowUp") return false;
    open(ctx);
    return true;
  },
  cursor: () => "pointer",
  popup: {
    measure(owner, ctx) {
      const p = ctx.props(owner.node);
      const o = readOptions(p);
      if (p.cond("disabled") || !fieldText(p, o).openable) return null;
      const n = o.options.length;
      const rows = (k: number) => Math.min(n, k) * ROW_H + 2 * PANEL_PAD + (n > k ? 2 * MORE_H : 0);
      const field = fieldBox(owner, p, ctx.theme.control.height);
      // Shorter than wanted means scrolling, so the strips are part of the base.
      return { w: Math.max(field.w, 180), h: rows(VISIBLE_OPTIONS), minH: rows(3), snap: { base: 2 * PANEL_PAD + 2 * MORE_H, step: ROW_H } };
    },
    paint: paintList,
    press(ctx) {
      const detail = ctx.target.detail;
      if (typeof detail !== "string") return;
      const o = readOptions(ctx.props(ctx.target.node));
      if (detail.startsWith("more:")) {
        if (!ctx.area) return;
        const { visible } = listLayout(ctx.area, o.options.length);
        const s = scrollOf(ctx.popup, o, visible);
        ctx.popup.scroll = Math.max(0, s + (detail === "more:up" ? -1 : 1) * Math.max(1, visible - 1));
        return;
      }
      const option = o.options.find((x) => `opt:${x.key}` === detail);
      if (option) choose(ctx, option);
    },
    key(ctx, key) {
      const o = readOptions(ctx.props(ctx.target.node));
      const visible = ctx.area ? listLayout(ctx.area, o.options.length).visible : VISIBLE_OPTIONS;
      const hi = highlightOf(ctx.popup, o);
      const first = o.options.findIndex((x) => x.available);
      const last = o.options.length - 1 - [...o.options].reverse().findIndex((x) => x.available);
      const go = (i: number) => { highlight(ctx.popup, o, i, visible); return true; };
      switch (key) {
        case "ArrowDown": return go(hi < 0 ? first : step(o, hi, 1));
        case "ArrowUp": return go(hi < 0 ? last : step(o, hi, -1));
        case "Home": return go(first);
        case "End": return go(last);
        case "PageDown": return go(hi < 0 ? first : step(o, hi, 1, Math.max(1, visible - 1)));
        case "PageUp": return go(hi < 0 ? last : step(o, hi, -1, Math.max(1, visible - 1)));
        case "Enter":
        case " ": {
          const option = o.options[hi];
          if (option) choose(ctx, option);
          return true;
        }
        default: return false;
      }
    },
    wheel(ctx, dy) {
      if (!ctx.area || !dy) return;
      const o = readOptions(ctx.props(ctx.target.node));
      const { visible } = listLayout(ctx.area, o.options.length);
      const rows = Math.max(1, Math.round(Math.abs(dy) / ROW_H));
      ctx.popup.scroll = Math.max(0, Math.min(Math.max(0, o.options.length - visible), scrollOf(ctx.popup, o, visible) + Math.sign(dy) * rows));
    },
  },
};

/** Problems a model can fix, said once per spec by the engine. */
function warnAbout(box: Box, p: PropReader, ctx: LayoutContext): void {
  const warn = (m: string) => ctx.warn?.(`select on line ${box.node.line}: ${m}`);
  const items = p.expr("items");
  const o = readOptions(p);
  if (o.problem === "not-list" && p.has("items")) warn(`items is not a list. Use a list of records with value= and label=, or a list of text`);
  if (o.problem === "too-many" && isList(items)) warn(`${items.length} options is more than the ${MAX_SELECT_OPTIONS} a select offers. Narrow the list with filter() or search()`);
  if (o.missing) warn(`${o.missing} items have no text or number ${p.has("value") ? `in "${p.str("value")}"` : "to use as a value (records need value=)"}, so they aren't offered`);
  if (o.duplicates) warn(`${o.duplicates} items repeat an earlier option's value, so only the first is offered. Values should be unique`);
  const chosen = p.bound();
  if (!o.problem && chosen !== undefined && chosen !== null && chosen !== "" && !o.options.some((x) => x.value === chosen)) {
    warn(`bind= holds ${JSON.stringify(chosen)}, which none of its options has, so it shows the placeholder`);
  }
}
