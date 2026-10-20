import type { ComponentDef } from "../component";
import { gapProp, padProp, row as rowLayout, ROW_ALIGN, stack } from "./util";

export const column: ComponentDef = {
  type: "column",
  category: "layout",
  description: "Stacks its children vertically.",
  props: { gap: gapProp(8), pad: padProp(0) },
  children: "any",
  example: `column gap=6
  text "First"
  text "Second"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    stack(box, ctx, p.num("pad", 0), p.num("gap", 8));
  },
};

export const row: ComponentDef = {
  type: "row",
  category: "layout",
  description: "Places its children side by side, splitting the width equally.",
  props: {
    gap: gapProp(10),
    pad: padProp(0),
    align: { type: "enum", values: ROW_ALIGN, default: "center", description: "Vertical alignment of children: top, center or bottom." },
  },
  children: "any",
  example: `row gap=10
  button "Cancel" variant=secondary
  button "Save"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    rowLayout(box, ctx, p.num("pad", 0), p.num("gap", 10), p.oneOf("align", ROW_ALIGN, "center"));
  },
};

export const card: ComponentDef = {
  type: "card",
  category: "layout",
  description: "A surface that groups related content, stacked vertically.",
  props: { gap: gapProp(14), pad: padProp(22) },
  children: "any",
  example: `card
  text "Order summary" style=title
  text "2 items" tone=muted`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    stack(box, ctx, p.num("pad", ctx.theme.space.lg), p.num("gap", ctx.theme.space.md));
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
    g.fillStyle = theme.colors.surface;
    g.fill();
    g.strokeStyle = theme.colors.line;
    g.lineWidth = 1;
    g.stroke();
  },
};

export const divider: ComponentDef = {
  type: "divider",
  category: "layout",
  description: "A thin horizontal line separating sections.",
  props: {},
  example: "divider",
  layout(box) {
    box.h = 1;
  },
  paint(box, ctx) {
    ctx.g.fillStyle = ctx.theme.colors.line;
    ctx.g.fillRect(box.x, box.y, box.w, 1);
  },
};

export const spacer: ComponentDef = {
  type: "spacer",
  category: "layout",
  description: "Empty vertical space.",
  props: { size: { type: "number", default: 8, description: "Height in pixels (default 8)." } },
  example: "spacer size=16",
  layout(box, ctx) {
    box.h = Math.max(0, ctx.props(box.node).num("size", 8));
  },
};
