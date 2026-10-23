import type { ComponentDef } from "../component";
import { wrapText } from "../text";
import { drawIcon, isIconName } from "../icons";
import { chevron, fillTint, gapProp, iconProblems, iconProp, onProp, padProp, partBox, row as rowLayout, ROW_ALIGN, rowMinWidth, runOn, stack, themeFont } from "./util";

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
  description: "Places its children side by side, splitting the width equally. On a narrow screen, children that don't fit move onto the next line.",
  props: {
    gap: gapProp(10),
    pad: padProp(0),
    align: { type: "enum", values: ROW_ALIGN, default: "center", description: "Vertical alignment of children: top, center or bottom." },
    wrap: { type: "boolean", default: true, description: "Move children onto more lines when they don't fit side by side (default true). Set false to always keep them on one line." },
  },
  children: "any",
  example: `row gap=10
  button "Cancel" variant=secondary
  button "Save"`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    rowLayout(box, ctx, p.num("pad", 0), p.num("gap", 10), p.oneOf("align", ROW_ALIGN, "center"), p.bool("wrap", true));
  },
  minWidth(node, ctx) {
    const p = ctx.props(node);
    return rowMinWidth(node, ctx, p.num("pad", 0), p.num("gap", 10), p.bool("wrap", true));
  },
};

export const each: ComponentDef = {
  type: "each",
  category: "layout",
  description: "Repeats what's inside it once per item of a list, in place, with no look of its own. Inside, the current item is called item (or the name given by as=).",
  props: {
    items: { type: "expression", required: true, description: "The list to repeat over, like todos or {cart}." },
    as: { type: "name", default: "item", description: "Name for the current item, used inside: as=t makes {t.text} work." },
    index: { type: "name", description: "Name for the item's position, counting from 0." },
    key: { type: "expression", description: "A value unique to each item, like {t.id}, so focus stays with the item when the list changes. Defaults to the position." },
  },
  children: "any",
  example: `state gear=[{name: "Tent", kg: 2.1}, {name: "Stove", kg: 0.4}, {name: "Headlamp", kg: 0.1}]
column gap=6
  each items=gear as=g index=i key={g.name}
    text "{i + 1}. {g.name}, {g.kg} kg"`,
  // Containers replace each with its copies before laying out, so this only
  // runs if an each is laid out directly; it takes no space then.
  layout(box) {
    box.h = 0;
  },
};

export const card: ComponentDef = {
  type: "card",
  category: "layout",
  description: "A surface that groups related content, stacked vertically. Give it on= to make the whole card pressable.",
  props: { gap: gapProp(14), pad: padProp(22), on: onProp("when the card is pressed") },
  children: "any",
  example: `card
  text "Order summary" style=title
  text "2 items" tone=muted
card on=emit:open_order
  text "Trail runner socks" weight=semibold
  text "Arrives Thursday" tone=muted`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    stack(box, ctx, p.num("pad", ctx.theme.space.lg), p.num("gap", ctx.theme.space.md));
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
    g.fillStyle = theme.colors.surface;
    g.fill();
    const pressable = ctx.props(box.node).has("on");
    if (pressable && ctx.isHovered(box.node)) fillTint(g, theme.colors.accent, ctx.isPressed(box.node) ? 0.1 : 0.05);
    g.strokeStyle = pressable && ctx.isHovered(box.node) ? theme.colors.accent : theme.colors.line;
    g.lineWidth = 1;
    g.stroke();
    if (pressable) ctx.addHit(box);
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

export const grid: ComponentDef = {
  type: "grid",
  category: "layout",
  description: "Places children in as many equal columns as fit, so the same screen works on a phone and a desktop.",
  props: {
    min: { type: "number", default: 200, description: "Narrowest a column may be, in pixels (default 200)." },
    gap: gapProp(14),
  },
  children: "any",
  example: `grid min=140 gap=10
  stat label="Orders" value=12
  stat label="Returns" value=1
  stat label="Rating" value=4.8`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const gap = Math.max(0, p.num("gap", 14));
    const kids = ctx.visibleChildren(box.node);
    // A column is never narrower than its widest child needs, whatever min= says.
    const min = Math.max(1, p.num("min", 200), ...kids.map((k) => Math.min(box.w, ctx.minWidth(k))));
    const cols = Math.max(1, Math.min(kids.length || 1, Math.floor((box.w + gap) / (min + gap))));
    const cw = Math.max(0, (box.w - gap * (cols - 1)) / cols);
    let y = box.y;
    for (let start = 0; start < kids.length; start += cols) {
      if (start) y += gap;
      let tallest = 0;
      kids.slice(start, start + cols).forEach((k, i) => {
        const kb = ctx.layout(k, box.x + i * (cw + gap), y, cw);
        box.children.push(kb);
        tallest = Math.max(tallest, kb.h);
      });
      y += tallest;
    }
    box.h = y - box.y;
  },
};

export const list: ComponentDef = {
  type: "list",
  category: "layout",
  description: "A bordered list of rows, separated by lines. Use list-item children.",
  props: {},
  children: ["list-item"],
  example: `list
  list-item "Trail runner socks" detail="Merino blend" trailing="$24"
  list-item "Rain shell" detail="Packs into its pocket" trailing="$129" on=emit:open_shell`,
  layout(box, ctx) {
    stack(box, ctx, 0, 0);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
    g.fillStyle = theme.colors.surface;
    g.fill();
  },
  paintOver(box, ctx) {
    const { g, theme } = ctx;
    g.fillStyle = theme.colors.line;
    box.children.slice(1).forEach((k) => g.fillRect(k.x + 16, k.y, k.w - 16, 1));
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
    g.strokeStyle = theme.colors.line;
    g.lineWidth = 1;
    g.stroke();
  },
};

const ITEM_PAD_X = 16, ITEM_PAD_Y = 12;
const ITEM_ICON = 20, ITEM_ICON_GAP = 12;

export const listItem: ComponentDef = {
  type: "list-item",
  category: "layout",
  description: "One row of a list: a title, an optional detail line and an optional value on the right. Give it on= to make it pressable.",
  text: { description: "The row's title.", required: true },
  props: {
    detail: { type: "string", description: "A second, quieter line under the title." },
    trailing: { type: "string", description: "A short value on the right, like a price or a count." },
    icon: iconProp,
    on: onProp("when the row is pressed"),
  },
  parents: ["list"],
  example: `list-item "Rain shell" detail="Packs into its pocket" trailing="$129" icon=package on=emit:open_shell`,
  check: (props) => iconProblems(props.icon, "icon"),
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const titleFont = themeFont(t, 600, t.text.body), detailFont = themeFont(t, 400, 13);
    const trailing = p.str("trailing");
    const trailingW = trailing ? ctx.measure.width(trailing, titleFont) + 12 : 0;
    const chevronW = p.has("on") ? 20 : 0;
    const iconW = isIconName(p.str("icon")) ? ITEM_ICON + ITEM_ICON_GAP : 0;
    const textW = Math.max(40, box.w - ITEM_PAD_X * 2 - trailingW - chevronW - iconW);
    const title = wrapText(p.text(), textW, titleFont, ctx.measure);
    const detail = p.has("detail") ? wrapText(p.str("detail"), textW, detailFont, ctx.measure) : [];
    const titleLH = Math.round(t.text.body * 1.35), detailLH = 18;
    box.data = { title, detail, titleFont, detailFont, titleLH, detailLH, trailing, iconW };
    box.h = ITEM_PAD_Y * 2 + title.length * titleLH + (detail.length ? 2 + detail.length * detailLH : 0);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as { title: string[]; detail: string[]; titleFont: string; detailFont: string; titleLH: number; detailLH: number; trailing: string; iconW: number };
    const p = ctx.props(box.node);
    const pressable = p.has("on");
    if (pressable && ctx.isHovered(box.node)) {
      g.beginPath();
      g.rect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
      fillTint(g, c.accent, ctx.isPressed(box.node) ? 0.1 : 0.05);
    }
    // A leading icon in the accent, level with the title's first line.
    const name = p.str("icon");
    if (d.iconW && isIconName(name)) drawIcon(g, name, box.x + ITEM_PAD_X, box.y + ITEM_PAD_Y + (d.titleLH - ITEM_ICON) / 2, ITEM_ICON, c.accent);
    const tx = box.x + ITEM_PAD_X + d.iconW;
    g.textAlign = "left";
    g.textBaseline = "middle";
    let y = box.y + ITEM_PAD_Y;
    g.font = d.titleFont;
    g.fillStyle = c.ink;
    for (const l of d.title) { g.fillText(l, tx, y + d.titleLH / 2); y += d.titleLH; }
    if (d.detail.length) {
      y += 2;
      g.font = d.detailFont;
      g.fillStyle = c.muted;
      for (const l of d.detail) { g.fillText(l, tx, y + d.detailLH / 2); y += d.detailLH; }
    }
    const right = box.x + box.w - ITEM_PAD_X - (pressable ? 20 : 0);
    if (d.trailing) {
      g.font = d.titleFont;
      g.textAlign = "right";
      g.fillStyle = c.ink;
      g.fillText(d.trailing, right, box.y + ITEM_PAD_Y + d.titleLH / 2);
    }
    if (pressable) {
      chevron(g, box.x + box.w - ITEM_PAD_X - 4, box.y + box.h / 2, 10, "right", c.muted);
      ctx.addHit(box);
    }
  },
};

const HEADER_H = 48;

export const accordion: ComponentDef = {
  type: "accordion",
  category: "layout",
  description: "A heading that shows or hides the content under it when pressed. Stack several for an FAQ.",
  text: { description: "The heading.", required: true },
  props: {
    bind: { type: "state", required: true, description: "A true/false state name: true while open." },
    gap: gapProp(10),
    on: onProp("after it opens or closes"),
  },
  children: "any",
  example: `state returns=true
accordion "Returns" bind=returns
  text "Free returns within 30 days, unworn."
accordion "Shipping" bind=shipping
  text "Ships in two business days."`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const open = !!p.bound();
    const t = ctx.theme;
    const font = themeFont(t, 600, t.text.body);
    const lines = wrapText(p.text(), Math.max(40, box.w - 32), font, ctx.measure);
    const lh = Math.round(t.text.body * 1.35);
    const headerH = Math.max(HEADER_H, lines.length * lh + 24);
    box.data = { lines, font, lh, headerH, open };
    if (!open) { box.h = headerH; return; }
    const gap = Math.max(0, p.num("gap", 10));
    let y = box.y + headerH;
    ctx.visibleChildren(box.node).forEach((k, i) => {
      if (i) y += gap;
      const kb = ctx.layout(k, box.x, y, box.w);
      box.children.push(kb);
      y += kb.h;
    });
    box.h = y - box.y + (box.children.length ? 14 : 0);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as { lines: string[]; font: string; lh: number; headerH: number; open: boolean };
    const header = partBox(box, box.x, box.y, box.w, d.headerH);
    if (ctx.isHovered(box.node, "header")) {
      ctx.roundRect(header.x, header.y + 2, header.w, header.h - 4, theme.radius.sm);
      fillTint(g, c.accent, 0.05);
    }
    g.font = d.font;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const top = box.y + (d.headerH - d.lines.length * d.lh) / 2;
    d.lines.forEach((l, i) => g.fillText(l, box.x, top + d.lh * i + d.lh / 2));
    chevron(g, box.x + box.w - 10, box.y + d.headerH / 2, 10, d.open ? "up" : "down", c.muted);
    g.fillStyle = c.line;
    g.fillRect(box.x, box.y + box.h - 1, box.w, 1);
    ctx.addHit(header, { detail: "header" });
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key) return;
    ctx.set(key, !ctx.props(ctx.target.node).bound());
    runOn(ctx);
  },
};
