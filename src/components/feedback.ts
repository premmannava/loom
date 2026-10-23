import type { ComponentDef } from "../component";
import { wrapText } from "../text";
import { fillTint, onProp, partBox, themeFont } from "./util";
import { fitText } from "./input";
import { paintGhost } from "../ghost";

const SHAPES = ["text", "block", "circle"] as const;
const LINE_H = 12, LINE_GAP = 10;

export const skeleton: ComponentDef = {
  type: "skeleton",
  category: "feedback",
  description: "A grey placeholder shown while content loads: lines of text, a block or a circle.",
  props: {
    shape: { type: "enum", values: SHAPES, default: "text", description: "text (lines), block or circle." },
    lines: { type: "number", default: 3, description: "How many lines, for shape=text (default 3)." },
    height: { type: "number", default: 120, description: "Height of a block, or diameter of a circle (default 120 and 48)." },
  },
  example: `skeleton lines=2
skeleton shape=block height=80`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const shape = p.oneOf("shape", SHAPES, "text");
    if (shape === "text") {
      const n = Math.max(1, Math.min(20, Math.round(p.num("lines", 3))));
      box.h = n * LINE_H + (n - 1) * LINE_GAP;
    } else {
      box.h = Math.max(0, Math.min(shape === "circle" ? box.w : Infinity, p.num("height", shape === "circle" ? 48 : 120)));
    }
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { theme } = ctx;
    const shape = p.oneOf("shape", SHAPES, "text");
    // A highlight sweeps across while animation is on; a still tint otherwise.
    paintGhost(ctx, box, (s) => {
      if (shape === "circle") s.circle(box.x + box.h / 2, box.y + box.h / 2, box.h / 2);
      else if (shape === "block") s.rect(box.x, box.y, box.w, box.h, theme.radius.md);
      else {
        const n = Math.round((box.h + LINE_GAP) / (LINE_H + LINE_GAP));
        for (let i = 0; i < n; i++) s.pill(box.x, box.y + i * (LINE_H + LINE_GAP), i === n - 1 && n > 1 ? box.w * 0.6 : box.w, LINE_H);
      }
    });
  },
};

const ICON = 40, BUTTON_H = 42;

export const empty: ComponentDef = {
  type: "empty",
  category: "feedback",
  description: "A friendly message for when there is nothing to show, with an optional button to move on.",
  text: { description: "The message, e.g. No orders yet.", required: true },
  props: {
    detail: { type: "string", description: "A line explaining what to do next." },
    action: { type: "string", description: "Label for a button under the message." },
    on: onProp("when the button is pressed"),
  },
  example: `empty "No results" detail="Try a wider price range." action="Clear filters" on=emit:clear_filters`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const titleFont = themeFont(t, 600, t.text.lead), detailFont = themeFont(t, 400, t.text.body);
    const w = Math.max(40, box.w - 32);
    const title = wrapText(p.text(), w, titleFont, ctx.measure);
    const detail = p.has("detail") ? wrapText(p.str("detail"), w, detailFont, ctx.measure) : [];
    const titleLH = Math.round(t.text.lead * 1.35), detailLH = Math.round(t.text.body * 1.4);
    const hasAction = p.has("action");
    box.data = { title, detail, titleFont, detailFont, titleLH, detailLH };
    box.h = 24 + ICON + 14 + title.length * titleLH + (detail.length ? 4 + detail.length * detailLH : 0) + (hasAction ? 18 + BUTTON_H : 0) + 24;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as { title: string[]; detail: string[]; titleFont: string; detailFont: string; titleLH: number; detailLH: number };
    const cx = box.x + box.w / 2;
    let y = box.y + 24;
    // An empty tray: a rounded box with an open top edge.
    g.beginPath();
    g.arc(cx, y + ICON / 2, ICON / 2, 0, Math.PI * 2);
    fillTint(g, c.accent, 0.1);
    g.beginPath();
    g.moveTo(cx - 10, y + 15);
    g.lineTo(cx - 10, y + 25);
    g.lineTo(cx + 10, y + 25);
    g.lineTo(cx + 10, y + 15);
    g.strokeStyle = c.accent;
    g.lineWidth = 1.8;
    g.lineJoin = "round";
    g.stroke();
    y += ICON + 14;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = d.titleFont;
    g.fillStyle = c.ink;
    for (const l of d.title) { g.fillText(l, cx, y + d.titleLH / 2); y += d.titleLH; }
    if (d.detail.length) {
      y += 4;
      g.font = d.detailFont;
      g.fillStyle = c.muted;
      for (const l of d.detail) { g.fillText(l, cx, y + d.detailLH / 2); y += d.detailLH; }
    }
    if (!p.has("action")) return;
    y += 18;
    const label = p.str("action");
    g.font = ctx.font(600, 14);
    const w = Math.min(box.w, g.measureText(label).width + 40);
    const btn = partBox(box, cx - w / 2, y, w, BUTTON_H);
    ctx.roundRect(btn.x + 0.5, btn.y + 0.5, btn.w - 1, btn.h - 1, theme.radius.md);
    g.fillStyle = c.surface;
    g.fill();
    if (ctx.isHovered(box.node, "action")) fillTint(g, c.accent, 0.1);
    g.strokeStyle = c.accent;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = c.accent;
    g.fillText(fitText(g, label, w - 16), cx, btn.y + BUTTON_H / 2 + 1);
    if (p.has("on")) ctx.addHit(btn, { detail: "action" });
  },
};
