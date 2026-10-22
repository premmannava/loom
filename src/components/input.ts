import { toNumber } from "../data";
import type { ComponentDef, PropReader } from "../component";
import type { Box } from "../types";
import { INPUT_KINDS } from "../editor";
import { fillTint, onProp, partBox, runOn, themeFont } from "./util";

const VARIANTS = ["primary", "secondary", "danger"] as const;

export const button: ComponentDef = {
  type: "button",
  category: "input",
  description: "A pressable button that runs actions. Use emit: to tell the app what the user chose.",
  text: { description: "The button label.", required: true },
  props: {
    on: { type: "action", description: "What happens when pressed, e.g. inc:count, set:done:true, emit:book. Separate several with ;" },
    variant: { type: "enum", values: VARIANTS, default: "primary", description: "primary (filled), secondary (outlined) or danger." },
    disabled: { type: "condition", description: "Expression; when true the button is greyed out and can't be pressed." },
  },
  example: `button "Book now" on=emit:book
button "Back" variant=secondary on=dec:step`,
  layout(box, ctx) {
    box.h = ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const variant = p.oneOf("variant", VARIANTS, "primary");
    const disabled = p.cond("disabled");
    const hot = !disabled && ctx.isHovered(box.node);
    const down = !disabled && ctx.isPressed(box.node);
    const color = variant === "danger" ? c.bad : c.accent;
    if (disabled) g.globalAlpha *= 0.45;
    const inset = down ? 1 : 0;
    ctx.roundRect(box.x + 0.5 + inset, box.y + 0.5 + inset, box.w - 1 - inset * 2, box.h - 1 - inset * 2, theme.radius.md);
    if (variant === "secondary") {
      g.fillStyle = c.surface;
      g.fill();
      if (hot) { g.save(); g.globalAlpha *= 0.1; g.fillStyle = color; g.fill(); g.restore(); }
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.stroke();
    } else {
      g.fillStyle = color;
      g.fill();
      if (hot) { g.save(); g.globalAlpha *= 0.14; g.fillStyle = c.onAccent; g.fill(); g.restore(); }
    }
    g.font = ctx.font(600, 14);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = variant === "secondary" ? color : c.onAccent;
    g.fillText(p.text(), box.x + box.w / 2, box.y + box.h / 2 + 1, box.w - 16);
    if (!disabled) ctx.addHit(box);
  },
};

export const check: ComponentDef = {
  type: "check",
  category: "input",
  description: "A checkbox that toggles a true/false state value.",
  text: { description: "The label next to the box.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The state name this checkbox reads and writes." },
  },
  example: `state agreed=false
check "I agree to the terms" bind=agreed`,
  layout(box) {
    box.h = 26;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const on = !!p.bound();
    const hot = ctx.isHovered(box.node);
    ctx.roundRect(box.x + 0.5, box.y + 4.5, 18, 18, theme.radius.sm);
    if (on) {
      g.fillStyle = c.accent;
      g.fill();
      g.strokeStyle = c.onAccent;
      g.lineWidth = 2.2;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(box.x + 5, box.y + 13.5);
      g.lineTo(box.x + 8.5, box.y + 17);
      g.lineTo(box.x + 14.5, box.y + 10);
      g.stroke();
    } else {
      g.fillStyle = c.surface;
      g.fill();
      g.strokeStyle = hot ? c.accent : c.muted;
      g.lineWidth = 1.4;
      g.stroke();
    }
    g.font = ctx.font(400, theme.text.body);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = c.ink;
    g.fillText(p.text(), box.x + 30, box.y + 14, box.w - 30);
    ctx.addHit(box);
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (key) ctx.set(key, !ctx.props(ctx.target.node).bound());
  },
};

export const switchToggle: ComponentDef = {
  type: "switch",
  category: "input",
  description: "An on/off switch with a label, for settings that take effect right away.",
  text: { description: "The label for the setting.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The true/false state name this switch reads and writes." },
    on: onProp("after it is switched"),
  },
  example: `state updates=true
switch "Email me order updates" bind=updates`,
  layout(box) {
    box.h = 28;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const on = !!p.bound();
    const tw = 40, th = 24, tx = box.x + box.w - tw, ty = box.y + (box.h - th) / 2;
    g.font = ctx.font(400, theme.text.body);
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(p.text(), box.x, box.y + box.h / 2 + 1, Math.max(0, box.w - tw - 12));
    ctx.roundRect(tx, ty, tw, th, th / 2);
    g.fillStyle = on ? c.accent : c.line;
    g.fill();
    if (ctx.isHovered(box.node)) fillTint(g, c.ink, 0.08);
    g.beginPath();
    g.arc(on ? tx + tw - th / 2 : tx + th / 2, ty + th / 2, th / 2 - 3, 0, Math.PI * 2);
    g.fillStyle = on ? c.onAccent : c.surface;
    g.fill();
    ctx.addHit(box);
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key) return;
    ctx.set(key, !ctx.props(ctx.target.node).bound());
    runOn(ctx);
  },
};

export const radio: ComponentDef = {
  type: "radio",
  category: "input",
  description: "One choice among several. Give each radio in a group the same bind= and its own value=.",
  text: { description: "The label for this choice.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The state name the group shares; it holds the chosen value." },
    value: { type: "string", required: true, description: "What bind= is set to when this radio is chosen." },
    on: onProp("after it is chosen"),
  },
  example: `state size=m
radio "Small" bind=size value=s
radio "Medium" bind=size value=m
radio "Large" bind=size value=l`,
  layout(box) {
    box.h = 26;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const chosen = p.bound() === (p.value("value") ?? "");
    const cx = box.x + 9.5, cy = box.y + box.h / 2;
    g.beginPath();
    g.arc(cx, cy, 9, 0, Math.PI * 2);
    g.fillStyle = c.surface;
    g.fill();
    g.strokeStyle = chosen || ctx.isHovered(box.node) ? c.accent : c.muted;
    g.lineWidth = chosen ? 2 : 1.4;
    g.stroke();
    if (chosen) {
      g.beginPath();
      g.arc(cx, cy, 4.5, 0, Math.PI * 2);
      g.fillStyle = c.accent;
      g.fill();
    }
    g.font = ctx.font(400, theme.text.body);
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(p.text(), box.x + 30, cy + 1, Math.max(0, box.w - 30));
    ctx.addHit(box);
  },
  press(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    ctx.set(key, p.value("value") ?? "");
    runOn(ctx);
  },
};

const STEP_W = 42, VALUE_W = 52;

/** A stepper's limits and current value, read the same way when painting and pressing. */
function stepperState(p: PropReader) {
  const min = p.num("min", 0);
  const max = p.has("max") ? p.num("max", Infinity) : Infinity;
  const step = Math.abs(p.num("step", 1)) || 1;
  const raw = toNumber(p.bound());
  const value = Number.isFinite(raw) ? raw : min;
  return { min, max, step, value };
}

export const stepper: ComponentDef = {
  type: "stepper",
  category: "input",
  description: "A number with minus and plus buttons, for small counts like a quantity.",
  text: { description: "An optional label on the left." },
  props: {
    bind: { type: "state", required: true, description: "The number state this stepper reads and writes." },
    min: { type: "number", default: 0, description: "Smallest value (default 0)." },
    max: { type: "number", description: "Largest value (no limit if left out)." },
    step: { type: "number", default: 1, description: "How much each press changes the value (default 1)." },
    on: onProp("after the value changes"),
  },
  example: `state qty=2
stepper "Quantity" bind=qty min=1 max=10`,
  layout(box, ctx) {
    box.h = ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const { min, max, value } = stepperState(p);
    const total = STEP_W * 2 + VALUE_W;
    const label = p.text();
    const x0 = label ? box.x + Math.max(0, box.w - total) : box.x;
    if (label) {
      g.font = ctx.font(400, theme.text.body);
      g.fillStyle = c.ink;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(label, box.x, box.y + box.h / 2 + 1, Math.max(0, box.w - total - 12));
    }
    ctx.roundRect(x0 + 0.5, box.y + 0.5, total - 1, box.h - 1, theme.radius.md);
    g.fillStyle = c.surface;
    g.fill();
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = c.line;
    g.fillRect(x0 + STEP_W, box.y + 8, 1, box.h - 16);
    g.fillRect(x0 + STEP_W + VALUE_W, box.y + 8, 1, box.h - 16);
    const parts = [
      { name: "dec", x: x0, enabled: value - 1e-9 > min, sign: "−" },
      { name: "inc", x: x0 + STEP_W + VALUE_W, enabled: value + 1e-9 < max, sign: "+" },
    ];
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const part of parts) {
      const pb = partBox(box, part.x, box.y, STEP_W, box.h);
      if (part.enabled && ctx.isHovered(box.node, part.name)) {
        ctx.roundRect(pb.x + 3, pb.y + 3, pb.w - 6, pb.h - 6, theme.radius.sm);
        fillTint(g, c.accent, 0.1);
      }
      g.save();
      if (!part.enabled) g.globalAlpha *= 0.35;
      g.font = ctx.font(600, 20);
      g.fillStyle = c.accent;
      g.fillText(part.sign, pb.x + STEP_W / 2, box.y + box.h / 2 + 1);
      g.restore();
      if (part.enabled) ctx.addHit(pb, { detail: part.name });
    }
    g.font = ctx.font(600, theme.text.body);
    g.fillStyle = c.ink;
    g.fillText(String(Math.round(value * 1000) / 1000), x0 + STEP_W + VALUE_W / 2, box.y + box.h / 2 + 1, VALUE_W - 6);
  },
  press(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    const { min, max, step, value } = stepperState(p);
    const next = ctx.target.detail === "inc" ? value + step : value - step;
    ctx.set(key, Math.round(Math.min(max, Math.max(min, next)) * 1e6) / 1e6);
    runOn(ctx);
  },
};

const STAR = 20, STAR_GAP = 4;

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

export const rating: ComponentDef = {
  type: "rating",
  category: "data",
  description: "A star rating. Shows value= as stars, or with bind= lets the user pick a rating.",
  props: {
    value: { type: "number", description: "The rating to show, e.g. 4.5. Ignored when bind= is set." },
    max: { type: "number", default: 5, description: "How many stars (default 5)." },
    bind: { type: "state", description: "A number state the user sets by pressing a star." },
    on: onProp("after the user picks a rating"),
  },
  example: `state stars=4
rating value=4.5
rating bind=stars`,
  layout(box) {
    box.h = STAR + 4;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const max = Math.max(1, Math.min(10, Math.round(p.num("max", 5))));
    const bind = p.raw("bind");
    let value = bind ? toNumber(p.bound()) || 0 : p.num("value", 0);
    if (bind && ctx.hover && ctx.hover.node.id === box.node.id && typeof ctx.hover.detail === "number") value = ctx.hover.detail;
    for (let i = 0; i < max; i++) {
      const x = box.x + i * (STAR + STAR_GAP);
      const cy = box.y + box.h / 2;
      starPath(g, x + STAR / 2, cy, STAR / 2);
      // Muted rather than the line color, which almost vanishes on dark surfaces.
      fillTint(g, c.muted, 0.35);
      const fill = Math.max(0, Math.min(1, value - i));
      if (fill > 0) {
        g.save();
        g.beginPath();
        g.rect(x, box.y, STAR * fill, box.h);
        g.clip();
        starPath(g, x + STAR / 2, cy, STAR / 2);
        g.fillStyle = c.warn;
        g.fill();
        g.restore();
      }
      if (bind) ctx.addHit(partBox(box, x - STAR_GAP / 2, box.y, STAR + STAR_GAP, box.h), { detail: i + 1 });
    }
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key || typeof ctx.target.detail !== "number") return;
    ctx.set(key, ctx.target.detail);
    runOn(ctx);
  },
};

export const link: ComponentDef = {
  type: "link",
  category: "input",
  description: "Pressable text for a secondary action, lighter than a button.",
  text: { description: "The link text.", required: true },
  props: {
    on: { type: "action", required: true, description: "What happens when pressed, e.g. emit:size_guide." },
  },
  example: `link "Size guide" on=emit:size_guide`,
  layout(box, ctx) {
    box.h = Math.round(ctx.theme.text.body * 1.35);
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    g.font = ctx.font(600, theme.text.body);
    const label = p.text();
    const w = Math.min(box.w, g.measureText(label).width);
    g.fillStyle = theme.colors.accent;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(label, box.x, box.y + box.h / 2 + 1, box.w);
    if (ctx.isHovered(box.node)) g.fillRect(box.x, box.y + box.h - 3, w, 1.5);
    ctx.addHit(partBox(box, box.x, box.y, w, box.h));
  },
};

const THUMB_R = 10, TRACK_H = 6, SLIDER_AREA = 32;

/** A slider's range and current value, read the same way when painting, dragging and on keys. */
function sliderState(p: PropReader) {
  const min = p.num("min", 0);
  const max = Math.max(min, p.num("max", 100));
  const step = Math.abs(p.num("step", 1)) || 1;
  const raw = toNumber(p.bound());
  const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : min;
  return { min, max, step, value };
}

/** Snap to the nearest step from min, keep within range, and drop float noise. */
function snap(v: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((v - min) / step) * step;
  return Math.round(Math.min(max, Math.max(min, stepped)) * 1e6) / 1e6;
}

/** Where the thumb's centre may travel: inset by its radius so it never pokes out. */
function travel(box: Box) {
  return { left: box.x + THUMB_R, width: Math.max(1, box.w - THUMB_R * 2) };
}

export const slider: ComponentDef = {
  type: "slider",
  category: "input",
  description: "Picks a number in a range by dragging a handle, or with the arrow keys. Good for prices, distances and amounts.",
  text: { description: "An optional label above the slider. Show the value with an {expression}." },
  props: {
    bind: { type: "state", required: true, description: "The number state this slider reads and writes." },
    min: { type: "number", default: 0, description: "Smallest value (default 0)." },
    max: { type: "number", default: 100, description: "Largest value (default 100)." },
    step: { type: "number", default: 1, description: "The value moves in steps of this size (default 1)." },
    on: onProp("after the user lets go, or after each arrow key"),
  },
  example: `state maxPrice=120
slider "Up to \${maxPrice}" bind=maxPrice min=20 max=300 step=10`,
  layout(box, ctx) {
    const label = ctx.props(box.node).text();
    box.h = (label ? Math.round(ctx.theme.text.body * 1.35) + 4 : 0) + SLIDER_AREA;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const { min, max, value } = sliderState(p);
    const label = p.text();
    let y = box.y;
    if (label) {
      const lh = Math.round(theme.text.body * 1.35);
      g.font = ctx.font(400, theme.text.body);
      g.fillStyle = c.ink;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(label, box.x, y + lh / 2 + 1, box.w);
      y += lh + 4;
    }
    const area = partBox(box, box.x, y, box.w, SLIDER_AREA);
    const { left, width } = travel(area);
    const frac = max > min ? (value - min) / (max - min) : 0;
    const cx = left + frac * width, cy = y + SLIDER_AREA / 2;
    ctx.roundRect(box.x, cy - TRACK_H / 2, box.w, TRACK_H, TRACK_H / 2);
    g.fillStyle = c.line;
    g.fill();
    ctx.roundRect(box.x, cy - TRACK_H / 2, Math.max(TRACK_H, cx - box.x), TRACK_H, TRACK_H / 2);
    g.fillStyle = c.accent;
    g.fill();
    const active = ctx.isPressed(box.node) || ctx.isHovered(box.node);
    if (active) {
      g.beginPath();
      g.arc(cx, cy, THUMB_R + 6, 0, Math.PI * 2);
      fillTint(g, c.accent, 0.14);
    }
    g.beginPath();
    g.arc(cx, cy, THUMB_R, 0, Math.PI * 2);
    g.fillStyle = c.surface;
    g.fill();
    g.strokeStyle = c.accent;
    g.lineWidth = 2;
    g.stroke();
    ctx.addHit(area, { detail: "track" });
  },
  cursor: () => "grab",
  drag(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    const { min, max, step, value } = sliderState(p);
    const { left, width } = travel(ctx.target.box);
    const frac = Math.min(1, Math.max(0, (ctx.x - left) / width));
    const next = snap(min + frac * (max - min), min, max, step);
    if (next !== value) ctx.set(key, next);
    if (ctx.phase === "end") runOn(ctx);
  },
  key(ctx, k) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return false;
    const { min, max, step, value } = sliderState(p);
    const big = Math.max(step, snap((max - min) / 10, 0, Infinity, step));
    const moves: Record<string, number> = {
      ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step,
      PageUp: value + big, PageDown: value - big, Home: min, End: max,
    };
    if (!(k in moves)) return false;
    ctx.set(key, snap(moves[k]!, min, max, step));
    runOn(ctx);
    return true;
  },
};

/** Field text size: at least 16 px, or phones zoom the page when the field is focused. */
export const FIELD_TEXT = 16;
export const FIELD_PAD = 12;
export const LABEL_SIZE = 13;
const LABEL_GAP = 6;

/** The field's box, under its label if it has one. */
export function fieldBox(box: Box, p: PropReader, controlHeight: number): Box {
  const top = p.text() ? LABEL_SIZE + 4 + LABEL_GAP : 0;
  return partBox(box, box.x, box.y + top, box.w, controlHeight);
}

/** The bound value as text for editing: numbers plainly, nothing for null. */
function fieldValue(p: PropReader): string {
  const v = p.bound();
  return v === undefined || v === null ? "" : typeof v === "object" ? "" : String(v);
}

/** Cut text to fit a width, ending with an ellipsis. */
export function fitText(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

export const input: ComponentDef = {
  type: "input",
  category: "input",
  description: "A text field people type into, such as a name, an email, a search or a new item. Each keystroke writes its bind= state.",
  text: { description: "The label above the field. Leave it out only when the screen makes the purpose obvious." },
  props: {
    bind: { type: "state", required: true, description: "The state name or path it reads and writes, like task or t.title." },
    placeholder: { type: "string", description: "A hint shown while the field is empty, like e.g. Sunscreen." },
    kind: { type: "enum", values: INPUT_KINDS, default: "text", description: "text, email, number, password or search. Picks the phone keyboard and autofill; number writes a number, or null while empty." },
    on: onProp("when Enter is pressed, after the value is written"),
    disabled: { type: "condition", description: "Expression; when true the field is greyed out and can't be typed in." },
    max: { type: "number", default: 500, description: "Longest value in characters (at most 10000)." },
  },
  example: `state task="" todos=[]
input "New item" bind=task placeholder="e.g. Sunscreen" on="add:todos:{task};set:task:''"
text "{plural(len(todos), 'item')}" tone=muted`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    box.h = fieldBox(box, p, ctx.theme.control.height).y - box.y + ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const disabled = p.cond("disabled");
    const field = fieldBox(box, p, theme.control.height);
    const editing = ctx.isEditing(box.node);
    const hot = !disabled && ctx.isHovered(box.node);
    g.save();
    if (disabled) g.globalAlpha *= 0.45;
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
    g.strokeStyle = editing ? c.accent : hot ? c.muted : c.line;
    g.lineWidth = editing ? 1.5 : 1;
    g.stroke();
    if (!editing) {
      const value = fieldValue(p);
      const kind = p.oneOf("kind", INPUT_KINDS, "text");
      const shown = value ? (kind === "password" ? "•".repeat(value.length) : value) : p.str("placeholder");
      g.font = ctx.font(400, FIELD_TEXT);
      g.textBaseline = "middle";
      g.fillStyle = value ? c.ink : c.muted;
      g.fillText(fitText(g, shown, field.w - FIELD_PAD * 2), field.x + FIELD_PAD, field.y + field.h / 2 + 1);
    }
    g.restore();
    if (!disabled) ctx.addHit(field);
  },
  editor(box, p, theme) {
    const field = fieldBox(box, p, theme.control.height);
    const max = Math.min(10_000, Math.max(1, Math.round(p.num("max", 500))));
    return {
      rect: { x: field.x + FIELD_PAD, y: field.y + 1, w: Math.max(0, field.w - FIELD_PAD * 2), h: field.h - 2 },
      font: themeFont(theme, 400, FIELD_TEXT),
      color: theme.colors.ink,
      accent: theme.colors.accent,
      muted: theme.colors.muted,
      kind: p.oneOf("kind", INPUT_KINDS, "text"),
      value: fieldValue(p).slice(0, max),
      placeholder: p.str("placeholder"),
      label: p.text() || p.str("placeholder"),
      max,
    };
  },
  cursor: () => "text",
};
