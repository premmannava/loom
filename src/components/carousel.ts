/**
 * carousel: cards side by side, a page at a time, with arrows and dots to
 * move between pages. For a handful of options to browse: products, hotels,
 * recipes. How many show at once follows from the width (min=), so a phone
 * shows one card and a wide chat column two or three.
 *
 * The canvas has no scrolling regions, so it pages rather than scrolls; the
 * page lives in state (bind=) like a tab's selection.
 */
import type { ComponentDef, PressContext } from "../component";
import type { SayShapeNode } from "../types";
import { toNumber } from "../data";
import { drawIcon } from "../icons";
import { fillTint, gapProp, onProp, partBox, runOn } from "./util";

const BAR_H = 32, BAR_GAP = 10, ARROW = 32, DOT = 6, DOT_GAP = 8;

/** Pages per carousel, from its last layout, for the arrow keys. */
const pagesOf = new WeakMap<SayShapeNode, number>();

type CarouselLayout = { page: number; pages: number };

function pageOf(raw: unknown, pages: number): number {
  const n = Math.round(toNumber(raw as never));
  return Number.isFinite(n) ? Math.min(Math.max(0, n), Math.max(0, pages - 1)) : 0;
}

function goTo(ctx: PressContext, page: number): void {
  const key = ctx.props(ctx.target.node).raw("bind");
  if (!key) return;
  ctx.set(key, page);
  runOn(ctx);
}

export const carousel: ComponentDef = {
  type: "carousel",
  category: "layout",
  description: "Cards side by side, a page at a time, with arrows and dots: a few options to browse, like products, hotels or recipes. Put a card per option inside it (or each over a list).",
  props: {
    bind: { type: "state", required: true, description: "The state name holding the page shown, starting at 0." },
    min: { type: "number", default: 220, description: "The narrowest a card may be (default 220); as many fit side by side as the width allows." },
    gap: gapProp(12),
    on: onProp("after the page changes"),
  },
  children: "any",
  example: `state page=0
carousel bind=page
  card
    text "Desert Rose Inn" style=lead weight=semibold
    text "$189 a night · 4.6 stars" tone=muted
  card
    text "Saguaro Lodge" style=lead weight=semibold
    text "$149 a night · 4.3 stars" tone=muted
  card
    text "Camelback Suites" style=lead weight=semibold
    text "$229 a night · 4.8 stars" tone=muted`,
  minWidth: (node, ctx) => Math.min(ctx.props(node).num("min", 220), 260),
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const gap = p.num("gap", 12);
    const min = Math.max(120, p.num("min", 220));
    const kids = ctx.visibleChildren(box.node);
    const per = Math.max(1, Math.floor((box.w + gap) / (min + gap)));
    const cw = (box.w - gap * (per - 1)) / per;
    const pages = Math.max(1, Math.ceil(kids.length / per));
    const page = pageOf(p.bound(), pages);
    pagesOf.set(box.node, pages);
    let tallest = 0;
    kids.forEach((k, i) => {
      const shown = Math.floor(i / per) === page;
      // Cards on other pages aren't laid out, so they're neither painted nor pressed.
      if (!shown) return;
      const kb = ctx.layout(k, box.x + (i % per) * (cw + gap), box.y, cw);
      box.children.push(kb);
      tallest = Math.max(tallest, kb.h);
    });
    const data: CarouselLayout = { page, pages };
    box.data = data;
    box.h = tallest + (pages > 1 ? BAR_GAP + BAR_H : 0);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const { page, pages } = box.data as CarouselLayout;
    if (pages <= 1) return;
    const y = box.y + box.h - BAR_H;
    const arrow = (x: number, dir: "left" | "right", target: number, enabled: boolean) => {
      const part = partBox(box, x, y, ARROW, BAR_H);
      const detail = dir === "left" ? "prev" : "next";
      g.beginPath();
      g.arc(x + ARROW / 2, y + BAR_H / 2, ARROW / 2 - 1, 0, Math.PI * 2);
      if (enabled && ctx.isHovered(box.node, detail)) fillTint(g, c.accent, 0.08);
      g.lineWidth = 1;
      g.strokeStyle = c.line;
      g.stroke();
      drawIcon(g, dir === "left" ? "arrow-left" : "arrow-right", x + ARROW / 2 - 8, y + BAR_H / 2 - 8, 16, enabled ? c.ink : c.line);
      if (enabled) ctx.addHit(part, { detail: `${detail}:${target}` });
    };
    arrow(box.x, "left", page - 1, page > 0);
    arrow(box.x + box.w - ARROW, "right", page + 1, page < pages - 1);
    // Dots in the middle, the current page's longer and in the accent.
    const dotsW = pages * DOT + (pages - 1) * DOT_GAP + 8;
    let x = box.x + box.w / 2 - dotsW / 2;
    for (let i = 0; i < pages; i++) {
      const w = i === page ? DOT + 8 : DOT;
      ctx.roundRect(x, y + BAR_H / 2 - DOT / 2, w, DOT, DOT / 2);
      g.fillStyle = i === page ? c.accent : c.line;
      g.fill();
      x += w + DOT_GAP;
    }
  },
  press(ctx) {
    const d = ctx.target.detail;
    if (typeof d !== "string") return;
    const n = Number(d.split(":")[1]);
    if (Number.isFinite(n)) goTo(ctx, n);
  },
  key(ctx, k) {
    if (k !== "ArrowLeft" && k !== "ArrowRight") return false;
    const node = ctx.target.node;
    const pages = pagesOf.get(node) ?? 1;
    const page = pageOf(ctx.props(node).bound(), pages);
    goTo(ctx, Math.min(pages - 1, Math.max(0, page + (k === "ArrowRight" ? 1 : -1))));
    return true;
  },
};

