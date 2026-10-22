/**
 * date-picker: one calendar date, in a field that opens a month calendar in
 * a popup (src/popup.ts, the same layer as select).
 *
 *   state due=""
 *   date-picker "Due date" bind=due min="2026-01-01" max="2027-12-31"
 *
 * Rules (also in the README):
 * - The value is YYYY-MM-DD text, a calendar day with no time or time zone,
 *   or "" for none. Dates are worked out in src/dates.ts, never with
 *   JavaScript's Date, so they never shift by a day.
 * - min= and max= are inclusive. One that isn't a real date is ignored, and
 *   if min is after max both are ignored (each with a warning).
 * - A bound value that isn't a real date shows "Invalid date"; one outside
 *   min and max still shows, but can't be chosen again. Either is reported
 *   once; state is never changed by drawing.
 * - The calendar opens on the chosen date's month, or else on today's
 *   (moved inside min and max). "Today" is the engine's today option, so
 *   tests can fix it.
 * - Which month is shown and which day the keyboard is on belong to the
 *   popup, never to state. Choosing writes bind=, closes the calendar, and
 *   runs on= if the date changed. Clear (unless required=true) writes "".
 * - US English month and day names; weeks start on Sunday.
 */
import type { ComponentDef, LayoutContext, PaintContext, PopupContext, PressContext, PropReader } from "../component";
import {
  addDays, addMonths, clampDate, compareDates, daysInMonth, displayDate, FIRST_DATE, formatDate, LAST_DATE, MONTHS, parseDate, WEEKDAYS, weekday,
  type CivilDate,
} from "../dates";
import type { PopupState } from "../popup";
import type { Box, Rect } from "../types";
import { FIELD_PAD, FIELD_TEXT, fieldBox, fitText, LABEL_SIZE } from "./input";
import { chevron, fillTint, onProp, partBox, runOn } from "./util";

const PAD = 8;
const HEAD_H = 40;
const WEEK_H = 24;
const FOOT_H = 40;
/** The widest a day cell gets; narrower screens shrink the calendar. */
const CELL = 40;
const CAL_W = 7 * CELL + 2 * PAD;

export interface Bounds { min: CivilDate | null; max: CivilDate | null }

/** min= and max= as dates: an invalid one is ignored, and both are if min is after max. */
export function readBounds(p: PropReader): Bounds & { problems: string[] } {
  const problems: string[] = [];
  const read = (name: "min" | "max") => {
    if (!p.has(name)) return null;
    const raw = p.str(name);
    const d = parseDate(raw);
    if (!d) problems.push(`${name}="${raw}" isn't a real date, so it's ignored. Write it as YYYY-MM-DD, like ${name}="2026-01-31"`);
    return d;
  };
  let min = read("min"), max = read("max");
  if (min && max && compareDates(min, max) > 0) {
    problems.push(`min (${formatDate(min)}) is after max (${formatDate(max)}), so neither is used`);
    min = max = null;
  }
  return { min, max, problems };
}

const inRange = (c: CivilDate, b: Bounds) => (!b.min || compareDates(c, b.min) >= 0) && (!b.max || compareDates(c, b.max) <= 0);

/** The bound value: none (""/null/unset), a date, or something that isn't one. */
function valueOf(p: PropReader): { kind: "none" } | { kind: "date"; date: CivilDate; iso: string } | { kind: "invalid"; raw: string } {
  const v = p.bound();
  if (v === undefined || v === null || v === "") return { kind: "none" };
  const d = parseDate(v);
  return d ? { kind: "date", date: d, iso: formatDate(d) } : { kind: "invalid", raw: typeof v === "string" ? v : JSON.stringify(v) };
}

/** Where the keyboard starts: the chosen date, or today, kept inside the bounds. */
export function startDate(p: PropReader, today: string): CivilDate {
  const b = readBounds(p);
  const v = valueOf(p);
  const base = v.kind === "date" ? v.date : parseDate(today) ?? { y: 2000, m: 1, d: 1 };
  return clampDate(clampDate(base, b.min, b.max), FIRST_DATE, LAST_DATE);
}

const monthStart = (c: CivilDate): CivilDate => ({ y: c.y, m: c.m, d: 1 });

/** Where the parts of the calendar sit in its popup area. */
export function calendarLayout(area: Rect) {
  const cw = (area.w - 2 * PAD) / 7;
  const ch = Math.min(CELL, cw);
  const x = area.x + PAD;
  const headY = area.y + PAD;
  const weekY = headY + HEAD_H;
  const gridY = weekY + WEEK_H;
  const footY = gridY + 6 * ch;
  return { x, cw, ch, headY, weekY, gridY, footY, w: area.w - 2 * PAD };
}

/** The cell of a day in a month's grid: weeks start on Sunday, six rows always. */
function cellOf(c: CivilDate, l: ReturnType<typeof calendarLayout>): Rect {
  const i = weekday(monthStart(c)) + c.d - 1;
  return { x: l.x + (i % 7) * l.cw, y: l.gridY + Math.floor(i / 7) * l.ch, w: l.cw, h: l.ch };
}

// ---------------------------------------------------------------- popup state

/** The month shown and the day the keyboard is on, both YYYY-MM-DD. */
function shown(state: PopupState): { month: CivilDate; focus: CivilDate } {
  const focus = parseDate(state.focus) ?? { y: 2000, m: 1, d: 1 };
  return { month: parseDate(state.month) ?? monthStart(focus), focus };
}

function moveFocus(ctx: PopupContext, to: CivilDate): void {
  const b = readBounds(ctx.props(ctx.target.node));
  const c = clampDate(clampDate(to, b.min, b.max), FIRST_DATE, LAST_DATE);
  ctx.popup.focus = formatDate(c);
  ctx.popup.month = formatDate(monthStart(c));
}

/** Commit a date (or "" to clear): write bind=, close, then run on= if it changed. */
function commit(ctx: PopupContext | PressContext, iso: string, close?: () => void): void {
  const p = ctx.props(ctx.target.node);
  const bind = p.raw("bind");
  if (!bind) return;
  const before = p.bound();
  const changed = before !== iso;
  if (changed) ctx.set(bind, iso);
  close?.();
  if (changed) runOn(ctx);
}

function open(ctx: PressContext): void {
  const p = ctx.props(ctx.target.node);
  if (p.cond("disabled") || !p.raw("bind")) return;
  const start = startDate(p, ctx.today());
  ctx.openPopup({ month: formatDate(monthStart(start)), focus: formatDate(start) });
}

// ---------------------------------------------------------------- painting

/** A small calendar glyph at the right of the field. */
function calendarIcon(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.beginPath();
  g.rect(x - 7, y - 6, 14, 13);
  g.moveTo(x - 7, y - 2);
  g.lineTo(x + 7, y - 2);
  g.moveTo(x - 3.5, y - 8);
  g.lineTo(x - 3.5, y - 4.5);
  g.moveTo(x + 3.5, y - 8);
  g.lineTo(x + 3.5, y - 4.5);
  g.stroke();
  g.restore();
}

function paintCalendar(owner: Box, area: Rect, ctx: PaintContext, state: PopupState): void {
  const p = ctx.props(owner.node);
  const { g, theme } = ctx;
  const c = theme.colors;
  const b = readBounds(p);
  const v = valueOf(p);
  const today = parseDate(ctx.today());
  const { month, focus } = shown(state);
  const l = calendarLayout(area);
  const prev = addMonths(month, -1), next = addMonths(month, 1);
  const canPrev = compareDates(month, FIRST_DATE) > 0 && (!b.min || compareDates({ ...prev, d: daysInMonth(prev.y, prev.m) }, b.min) >= 0);
  const canNext = compareDates({ ...month, d: daysInMonth(month.y, month.m) }, LAST_DATE) < 0 && (!b.max || compareDates(next, b.max) <= 0);

  // Header: previous, the month, next.
  const btn = (dir: "prev" | "next", live: boolean) => {
    const box = partBox(owner, dir === "prev" ? l.x : l.x + l.w - HEAD_H, l.headY, HEAD_H, HEAD_H);
    if (live) {
      ctx.addHit(box, { detail: dir, focusable: false });
      if (ctx.isHovered(owner.node, dir)) { ctx.roundRect(box.x + 4, box.y + 4, box.w - 8, box.h - 8, theme.radius.sm); fillTint(g, c.ink, 0.06); }
    }
    chevron(g, box.x + box.w / 2, box.y + box.h / 2, 10, dir === "prev" ? "left" : "right", live ? c.ink : c.line);
  };
  btn("prev", canPrev);
  btn("next", canNext);
  g.font = ctx.font(600, 15);
  g.fillStyle = c.ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`${MONTHS[month.m - 1]} ${month.y}`, l.x + l.w / 2, l.headY + HEAD_H / 2);

  // Weekday names, Sunday first.
  g.font = ctx.font(600, 12);
  g.fillStyle = c.muted;
  WEEKDAYS.forEach((name, i) => g.fillText(name.slice(0, 2), l.x + l.cw * (i + 0.5), l.weekY + WEEK_H / 2));

  // Days.
  const days = daysInMonth(month.y, month.m);
  for (let d = 1; d <= days; d++) {
    const day: CivilDate = { y: month.y, m: month.m, d };
    const iso = formatDate(day);
    const cell = cellOf(day, l);
    const enabled = inRange(day, b);
    const detail = `day:${iso}`;
    const chosen = v.kind === "date" && v.iso === iso;
    const isFocus = compareDates(day, focus) === 0;
    const r = Math.min(cell.w, cell.h) / 2 - 2;
    const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
    if (enabled) ctx.addHit(partBox(owner, cell.x, cell.y, cell.w, cell.h), { detail, focusable: false });
    const circle = () => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); };
    if (chosen) { circle(); g.fillStyle = c.accent; g.fill(); }
    else if (isFocus && enabled) { circle(); fillTint(g, c.accent, 0.16); }
    else if (enabled && ctx.isHovered(owner.node, detail)) { circle(); fillTint(g, c.ink, 0.06); }
    if (isFocus) { circle(); g.strokeStyle = c.focus; g.lineWidth = 2; g.stroke(); }
    const isToday = !!today && compareDates(day, today) === 0;
    g.font = ctx.font(chosen || isToday ? 700 : 400, 14);
    g.fillStyle = chosen ? c.onAccent : !enabled ? c.line : isToday ? c.accent : c.ink;
    g.fillText(String(d), cx, cy + 1);
  }

  // Footer: Today and Clear.
  const footer = (label: string, detail: string, left: boolean) => {
    g.font = ctx.font(600, 14);
    const w = g.measureText(label).width + 24;
    const box = partBox(owner, left ? l.x : l.x + l.w - w, l.footY + 4, w, FOOT_H - 8);
    ctx.addHit(box, { detail, focusable: false });
    if (ctx.isHovered(owner.node, detail)) { ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.sm); fillTint(g, c.accent, 0.1); }
    g.fillStyle = c.accent;
    g.textAlign = "center";
    g.fillText(label, box.x + box.w / 2, box.y + box.h / 2 + 1);
  };
  if (today && inRange(today, b)) footer("Today", "today", true);
  if (!p.bool("required") && v.kind !== "none") footer("Clear", "clear", false);
}

// ---------------------------------------------------------------- the component

export const datePicker: ComponentDef = {
  type: "date-picker",
  category: "input",
  description:
    "A field that opens a month calendar to pick one date, kept in bind= as YYYY-MM-DD text (\"\" for none). For deadlines, bookings or report filters.",
  text: { description: "The label above the field." },
  props: {
    bind: { type: "state", required: true, description: "State that holds the date as YYYY-MM-DD, like due or t.date. Start it as \"\" for no date." },
    min: { type: "string", description: "The earliest date that can be chosen, YYYY-MM-DD, included." },
    max: { type: "string", description: "The latest date that can be chosen, YYYY-MM-DD, included." },
    placeholder: { type: "string", default: "Choose a date", description: "Shown while no date is chosen." },
    required: { type: "boolean", default: false, description: "When true, the calendar has no Clear button." },
    disabled: { type: "condition", description: "Expression; when true the field is greyed out and doesn't open." },
    on: onProp("after the date changes, with bind= already set"),
  },
  example: `state due=""
date-picker "Due date" bind=due min="2026-01-01" max="2027-12-31"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    box.h = fieldBox(box, p, ctx.theme.control.height).y - box.y + ctx.theme.control.height;
    warnAbout(box, p, ctx);
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const disabled = p.cond("disabled");
    const isOpen = ctx.isPopupOpen(box.node);
    const field = fieldBox(box, p, theme.control.height);
    const v = valueOf(p);
    g.save();
    if (disabled) g.globalAlpha *= 0.45;
    const label = p.text();
    if (label) {
      g.font = ctx.font(600, LABEL_SIZE);
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = c.ink;
      g.fillText(fitText(g, label, box.w), box.x, box.y);
    }
    ctx.roundRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1, theme.radius.md);
    g.fillStyle = c.surface;
    g.fill();
    g.strokeStyle = isOpen ? c.accent : !disabled && ctx.isHovered(box.node) ? c.muted : c.line;
    g.lineWidth = isOpen ? 1.5 : 1;
    g.stroke();
    const text = v.kind === "date" ? displayDate(v.date) : v.kind === "invalid" ? "Invalid date" : p.str("placeholder", "Choose a date");
    g.font = ctx.font(400, FIELD_TEXT);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = v.kind === "date" ? c.ink : v.kind === "invalid" ? c.bad : c.muted;
    g.fillText(fitText(g, text, field.w - FIELD_PAD * 2 - 28), field.x + FIELD_PAD, field.y + field.h / 2 + 1);
    calendarIcon(g, field.x + field.w - FIELD_PAD - 8, field.y + field.h / 2, disabled ? c.line : c.muted);
    g.restore();
    if (!disabled) ctx.addHit(field);
  },
  press(ctx) {
    if (!ctx.popupOpen) open(ctx);
  },
  key(ctx, key) {
    if (key === "ArrowDown" || key === "ArrowUp") { open(ctx); return true; }
    // Delete or Backspace on the field clears it, unless a date is required.
    if ((key === "Delete" || key === "Backspace") && !ctx.props(ctx.target.node).bool("required")) { commit(ctx, ""); return true; }
    return false;
  },
  cursor: () => "pointer",
  popup: {
    measure(owner, ctx) {
      const p = ctx.props(owner.node);
      if (p.cond("disabled") || !p.raw("bind")) return null;
      const field = fieldBox(owner, p, ctx.theme.control.height);
      const w = Math.min(CAL_W, Math.max(field.w, 7 * 30 + 2 * PAD));
      const ch = Math.min(CELL, (w - 2 * PAD) / 7);
      // The footer only when it has a button: Today (in range) or Clear (a date to clear).
      const today = parseDate(ctx.today());
      const footer = (!!today && inRange(today, readBounds(p))) || (!p.bool("required") && valueOf(p).kind !== "none");
      const h = 2 * PAD + HEAD_H + WEEK_H + 6 * ch + (footer ? FOOT_H : PAD);
      return { w, h, minH: h, ownWidth: true };
    },
    paint: paintCalendar,
    press(ctx) {
      const detail = ctx.target.detail;
      if (typeof detail !== "string") return;
      const { month, focus } = shown(ctx.popup);
      if (detail === "prev" || detail === "next") {
        const n = detail === "prev" ? -1 : 1;
        const b = readBounds(ctx.props(ctx.target.node));
        const m = addMonths(month, n);
        ctx.popup.month = formatDate(monthStart(m));
        // Keep the keyboard's day in the month shown, as near its day as allowed.
        const f = clampDate(clampDate(addMonths(focus, n), b.min, b.max), FIRST_DATE, LAST_DATE);
        if (f.y === m.y && f.m === m.m) ctx.popup.focus = formatDate(f);
        return;
      }
      if (detail === "clear") { commit(ctx, "", () => ctx.close(true)); return; }
      const iso = detail === "today" ? ctx.today() : detail.startsWith("day:") ? detail.slice(4) : null;
      const day = parseDate(iso);
      if (!day || !inRange(day, readBounds(ctx.props(ctx.target.node)))) return;
      commit(ctx, formatDate(day), () => ctx.close(true));
    },
    key(ctx, key) {
      const { focus } = shown(ctx.popup);
      const by: Record<string, () => CivilDate> = {
        ArrowLeft: () => addDays(focus, -1),
        ArrowRight: () => addDays(focus, 1),
        ArrowUp: () => addDays(focus, -7),
        ArrowDown: () => addDays(focus, 7),
        PageUp: () => addMonths(focus, -1),
        PageDown: () => addMonths(focus, 1),
        Home: () => addDays(focus, -weekday(focus)),
        End: () => addDays(focus, 6 - weekday(focus)),
      };
      const move = by[key];
      if (move) {
        // Past the first or last date there is, stay put rather than wrapping.
        const to = compareDates(focus, FIRST_DATE) <= 0 && (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") ? focus
          : compareDates(focus, LAST_DATE) >= 0 && (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown") ? focus : move();
        moveFocus(ctx, to);
        return true;
      }
      if (key === "Enter" || key === " ") {
        if (inRange(focus, readBounds(ctx.props(ctx.target.node)))) commit(ctx, formatDate(focus), () => ctx.close(true));
        return true;
      }
      return false;
    },
  },
};

/** Problems a model can fix, said once per spec by the engine. */
function warnAbout(box: Box, p: PropReader, ctx: LayoutContext): void {
  const warn = (m: string) => ctx.warn?.(`date-picker on line ${box.node.line}: ${m}`);
  const b = readBounds(p);
  b.problems.forEach(warn);
  const v = valueOf(p);
  if (v.kind === "invalid") warn(`bind= holds ${JSON.stringify(v.raw)}, which isn't a real date, so it shows "Invalid date". Dates are YYYY-MM-DD text, like "2026-03-14"`);
  if (v.kind === "date" && !inRange(v.date, b)) warn(`bind= holds ${v.iso}, which is outside min and max. It's shown, but can't be chosen again`);
}
