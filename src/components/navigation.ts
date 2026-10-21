import { literal } from "../actions";
import type { ComponentDef, LayoutContext, PropReader } from "../component";
import type { Box, LoomNode, Value } from "../types";
import { wrapText } from "../text";
import { chevron, fillTint, gapProp, onProp, partBox, runOn, stack, themeFont } from "./util";

// ---------------------------------------------------------------- tabs

const BAR_H = 42, TAB_PAD = 16;

/** The value a tab stands for: its value= prop, or its label. */
function tabValue(node: LoomNode, props: (n: LoomNode) => PropReader): Value {
  const p = props(node);
  return p.has("value") ? literal(p.raw("value")!) : p.text();
}

/** Which visible tab is selected: the one matching bind=, or the first. */
function selectedTab(tabs: LoomNode[], current: Value | undefined, props: (n: LoomNode) => PropReader): LoomNode | undefined {
  return tabs.find((t) => tabValue(t, props) === current) ?? tabs[0];
}

interface TabCell { node: LoomNode; label: string; value: Value; x: number; w: number }

export const tabs: ComponentDef = {
  type: "tabs",
  category: "navigation",
  description: "A row of tabs that switches between sections. Only the selected tab's content is shown.",
  props: {
    bind: { type: "state", required: true, description: "The state name holding the selected tab's value." },
    on: onProp("after the user switches tabs"),
  },
  children: ["tab"],
  example: `state view=overview
tabs bind=view
  tab "Overview" value=overview
    text "Light, quick-drying trail runners."
  tab "Specs" value=specs
    text "280 g, 6 mm drop."`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const kids = ctx.visibleChildren(box.node);
    const current = ctx.scope(p.raw("bind") ?? "");
    const selected = selectedTab(kids, current, ctx.props);
    const font = themeFont(ctx.theme, 600, 14);
    const natural = kids.map((k) => ctx.measure.width(ctx.props(k).text(), font) + TAB_PAD * 2);
    const total = natural.reduce((a, b) => a + b, 0);
    const scale = total > box.w ? box.w / total : 1;
    let x = box.x;
    const cells: TabCell[] = kids.map((k, i) => {
      const w = natural[i]! * scale;
      const cell = { node: k, label: ctx.props(k).text(), value: tabValue(k, ctx.props), x, w };
      x += w;
      return cell;
    });
    box.data = { cells, font, selected: selected?.id };
    const top = box.y + BAR_H + 14;
    let h = BAR_H;
    for (const k of kids) {
      if (k === selected) {
        const kb = ctx.layout(k, box.x, top, box.w);
        box.children.push(kb);
        h = BAR_H + 14 + kb.h;
      } else {
        // Unselected tabs keep an empty box, so their content isn't laid out or painted.
        box.children.push({ node: k, x: box.x, y: box.y + BAR_H, w: box.w, h: 0, children: [] });
      }
    }
    box.h = h;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const { cells, font, selected } = box.data as { cells: TabCell[]; font: string; selected?: string };
    g.fillStyle = c.line;
    g.fillRect(box.x, box.y + BAR_H - 1, box.w, 1);
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const cell of cells) {
      const on = cell.node.id === selected;
      const part = partBox(box, cell.x, box.y, cell.w, BAR_H);
      if (!on && ctx.isHovered(box.node, cell.value)) {
        ctx.roundRect(part.x + 2, part.y + 4, part.w - 4, part.h - 10, theme.radius.sm);
        fillTint(g, c.accent, 0.06);
      }
      g.fillStyle = on ? c.ink : c.muted;
      g.fillText(cell.label, cell.x + cell.w / 2, box.y + BAR_H / 2, Math.max(0, cell.w - 8));
      if (on) {
        g.fillStyle = c.accent;
        g.fillRect(cell.x + 6, box.y + BAR_H - 3, Math.max(0, cell.w - 12), 3);
      }
      ctx.addHit(part, { detail: cell.value });
    }
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key || ctx.target.detail === undefined) return;
    ctx.set(key, ctx.target.detail as Value);
    runOn(ctx);
  },
};

export const tab: ComponentDef = {
  type: "tab",
  category: "navigation",
  description: "One tab inside tabs: its label, and the content shown while it is selected.",
  text: { description: "The tab's label.", required: true },
  props: {
    value: { type: "string", description: "What the tabs' bind= holds while this tab is selected (default: the label)." },
    gap: gapProp(12),
  },
  children: "any",
  parents: ["tabs"],
  example: `tab "Reviews" value=reviews
  text "4.8 out of 5 from 212 hikers."`,
  layout(box, ctx) {
    stack(box, ctx, 0, ctx.props(box.node).num("gap", 12));
  },
};

// ---------------------------------------------------------------- breadcrumb

const CRUMB_H = 22, SEP = " / ";

interface Crumb { text: string; x: number; y: number; w: number; last: boolean }

/** Lay crumbs out left to right, wrapping onto a new line when one doesn't fit. */
function flowCrumbs(box: Box, ctx: LayoutContext, items: string[], font: string): { crumbs: Crumb[]; sepW: number; height: number } {
  const sepW = ctx.measure.width(SEP, font);
  const crumbs: Crumb[] = [];
  let x = box.x, y = box.y;
  items.forEach((text, i) => {
    const w = Math.min(box.w, ctx.measure.width(text, font));
    if (x > box.x && x + w > box.x + box.w) { x = box.x; y += CRUMB_H; }
    crumbs.push({ text, x, y, w, last: i === items.length - 1 });
    x += w + sepW;
  });
  return { crumbs, sepW, height: crumbs.length ? y - box.y + CRUMB_H : CRUMB_H };
}

export const breadcrumb: ComponentDef = {
  type: "breadcrumb",
  category: "navigation",
  description: "Where the user is, as a path like Shop / Shoes / Trail runners. Earlier steps can be pressed to go back.",
  text: { description: "The steps, separated by slashes. The last one is the current page.", required: true },
  props: {
    bind: { type: "state", description: "State that receives the pressed step's text." },
    on: onProp("after a step is pressed"),
  },
  example: `state at="Trail runners"
breadcrumb "Shop / Shoes / Trail runners" bind=at`,
  layout(box, ctx) {
    const items = ctx.props(box.node).text().split("/").map((s) => s.trim()).filter(Boolean);
    const font = themeFont(ctx.theme, 400, 14);
    const { crumbs, sepW, height } = flowCrumbs(box, ctx, items, font);
    box.data = { crumbs, sepW, font };
    box.h = height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const { crumbs, font } = box.data as { crumbs: Crumb[]; sepW: number; font: string };
    const pressable = p.has("bind") || p.has("on");
    g.textAlign = "left";
    g.textBaseline = "middle";
    for (const cr of crumbs) {
      const active = pressable && !cr.last;
      g.font = cr.last ? ctx.font(600, 14) : font;
      g.fillStyle = cr.last ? c.ink : active ? c.accent : c.muted;
      g.fillText(cr.text, cr.x, cr.y + CRUMB_H / 2, box.x + box.w - cr.x);
      if (!cr.last) {
        g.font = font;
        g.fillStyle = c.muted;
        g.fillText(SEP, cr.x + cr.w, cr.y + CRUMB_H / 2);
      }
      if (active) {
        if (ctx.isHovered(box.node, cr.text)) { g.fillStyle = c.accent; g.fillRect(cr.x, cr.y + CRUMB_H - 3, cr.w, 1.5); }
        ctx.addHit(partBox(box, cr.x, cr.y, cr.w, CRUMB_H), { detail: cr.text });
      }
    }
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (key && typeof ctx.target.detail === "string") ctx.set(key, ctx.target.detail);
    runOn(ctx);
  },
};

// ---------------------------------------------------------------- pagination

const PAGE = 36, PAGE_GAP = 4;

/** The slots to show: page numbers and gaps ("…"), at most 7 between the arrows. */
export function pageSlots(current: number, pages: number): Array<number | "…"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", pages];
  if (current >= pages - 3) return [1, "…", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, "…", current - 1, current, current + 1, "…", pages];
}

function pageState(p: PropReader, scope: (k: string) => Value | undefined) {
  const pages = Math.max(1, Math.min(100000, Math.round(p.num("pages", 1))));
  const raw = Math.round(Number(scope(p.raw("bind") ?? "")));
  const current = Number.isFinite(raw) ? Math.max(1, Math.min(pages, raw)) : 1;
  return { pages, current };
}

export const pagination: ComponentDef = {
  type: "pagination",
  category: "navigation",
  description: "Previous, next and page-number buttons for moving through pages of results.",
  props: {
    bind: { type: "state", required: true, description: "The number state holding the current page, starting at 1." },
    pages: { type: "number", required: true, description: "How many pages there are." },
    on: onProp("after the page changes"),
  },
  example: `state page=3
pagination bind=page pages=12`,
  layout(box) {
    box.h = PAGE;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const { pages, current } = pageState(p, ctx.scope);
    const slots: Array<{ kind: "prev" | "next" | "page" | "gap"; page?: number }> = [
      { kind: "prev" },
      ...pageSlots(current, pages).map((s) => (s === "…" ? { kind: "gap" as const } : { kind: "page" as const, page: s })),
      { kind: "next" },
    ];
    const size = Math.max(16, Math.min(PAGE, (box.w - PAGE_GAP * (slots.length - 1)) / slots.length));
    const y = box.y + (box.h - size) / 2;
    g.textAlign = "center";
    g.textBaseline = "middle";
    slots.forEach((slot, i) => {
      const x = box.x + i * (size + PAGE_GAP);
      const part = partBox(box, x, y, size, size);
      const target = slot.kind === "prev" ? current - 1 : slot.kind === "next" ? current + 1 : slot.page;
      const enabled = target !== undefined && target >= 1 && target <= pages && target !== current;
      const detail = slot.kind === "page" ? slot.page : slot.kind;
      if (slot.kind === "page" && slot.page === current) {
        ctx.roundRect(x, y, size, size, theme.radius.sm);
        g.fillStyle = c.accent;
        g.fill();
      } else if (enabled && ctx.isHovered(box.node, detail)) {
        ctx.roundRect(x, y, size, size, theme.radius.sm);
        fillTint(g, c.accent, 0.1);
      }
      if (slot.kind === "prev" || slot.kind === "next") {
        g.save();
        if (!enabled) g.globalAlpha *= 0.35;
        chevron(g, x + size / 2, y + size / 2, 10, slot.kind === "prev" ? "left" : "right", c.ink);
        g.restore();
      } else {
        g.font = ctx.font(slot.page === current ? 700 : 500, 14);
        g.fillStyle = slot.page === current ? c.onAccent : slot.kind === "gap" ? c.muted : c.ink;
        g.fillText(slot.kind === "gap" ? "…" : String(slot.page), x + size / 2, y + size / 2 + 1, size - 4);
      }
      if (enabled) ctx.addHit(part, { detail });
    });
  },
  press(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    const { pages, current } = pageState(p, ctx.scope);
    const d = ctx.target.detail;
    const next = d === "prev" ? current - 1 : d === "next" ? current + 1 : typeof d === "number" ? d : current;
    ctx.set(key, Math.max(1, Math.min(pages, next)));
    runOn(ctx);
  },
};

// ---------------------------------------------------------------- screen

/** The state name holding the visible screen (kept in sync by the engine). */
const SCREEN_STATE = "screen";

export const screen: ComponentDef = {
  type: "screen",
  category: "navigation",
  description: "One screen of a multi-screen interface. Only one screen shows at a time: the first, until a button runs go:name or back.",
  props: {
    name: { type: "name", required: true, description: "The screen's name, used by go:name. The visible screen's name is in {screen}." },
    title: { type: "string", description: "A heading shown at the top of the screen." },
    gap: gapProp(14),
  },
  children: "any",
  parents: ["root"],
  example: `screen name=cart title="Your cart"
  text "2 items"
  button "Checkout" on=go:checkout
screen name=checkout title="Checkout"
  text "Pay with card"
  button "Back to cart" variant=secondary on=back`,
  visible(node, scope) {
    return scope(SCREEN_STATE) === node.props.name;
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const gap = Math.max(0, p.num("gap", 14));
    const t = ctx.theme;
    let y = box.y;
    if (p.has("title")) {
      const font = themeFont(t, 700, t.text.title);
      const lh = Math.round(t.text.title * 1.35);
      const lines = wrapText(p.str("title"), box.w, font, ctx.measure);
      box.data = { lines, font, lh };
      y += lines.length * lh + gap;
    }
    ctx.visibleChildren(box.node).forEach((k, i) => {
      if (i) y += gap;
      const kb = ctx.layout(k, box.x, y, box.w);
      box.children.push(kb);
      y += kb.h;
    });
    box.h = y - box.y;
  },
  paint(box, ctx) {
    const d = box.data as { lines: string[]; font: string; lh: number } | undefined;
    if (!d) return;
    const { g, theme } = ctx;
    g.font = d.font;
    g.fillStyle = theme.colors.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    d.lines.forEach((l, i) => g.fillText(l, box.x, box.y + d.lh * i + d.lh / 2 + 1));
  },
};
