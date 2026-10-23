/**
 * segmented: a few options side by side in one track, one of them chosen.
 * The everyday way to switch a view (Chart | Table) or a period
 * (Week | Month | Year), lighter than tabs or a select.
 */
import type { ComponentDef, PressContext } from "../component";
import { fitText } from "./input";
import { fillTint, onProp, partBox, runOn, themeFont } from "./util";

const H = 36, PAD = 14, INSET = 3;
const MAX_OPTIONS = 6;

/** The options as written: comma-separated, trimmed, at most MAX_OPTIONS. */
function optionsOf(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
}

function choose(ctx: PressContext, value: string): void {
  const key = ctx.props(ctx.target.node).raw("bind");
  if (!key) return;
  ctx.set(key, value);
  runOn(ctx);
}

export const segmented: ComponentDef = {
  type: "segmented",
  category: "input",
  description: "Two to six short options in one track, one chosen, like Week | Month | Year or Chart | Table. Show different content for each with if=.",
  props: {
    bind: { type: "state", required: true, description: "The state name holding the chosen option's text." },
    options: { type: "string", required: true, description: "The options, comma-separated, e.g. options=\"Week,Month,Year\". At most 6, one or two words each." },
    on: onProp("after the choice changes"),
  },
  example: `state view="Chart"
segmented bind=view options="Chart,Table"
text "Showing the {lower(view)}" tone=muted`,
  check(props) {
    const n = optionsOf(props.options ?? "").length;
    const all = (props.options ?? "").split(",").filter((s) => s.trim()).length;
    if (props.options !== undefined && n < 2) return ["segmented needs at least two options, like options=\"Week,Month\""];
    if (all > MAX_OPTIONS) return [`segmented shows at most ${MAX_OPTIONS} options; use a select for more`];
    return [];
  },
  minWidth(node, ctx) {
    const n = Math.max(1, optionsOf(ctx.props(node).str("options")).length);
    return n * 56 + INSET * 2;
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const options = optionsOf(p.str("options"));
    const font = themeFont(ctx.theme, 600, 13);
    const natural = options.map((o) => ctx.measure.width(o, font) + PAD * 2);
    const total = natural.reduce((a, b) => a + b, 0) + INSET * 2;
    // As wide as its labels need, up to the whole width; squeezed evenly when there's less room.
    const width = Math.min(box.w, Math.max(total, 0));
    const scale = total > box.w ? (box.w - INSET * 2) / (total - INSET * 2) : 1;
    let x = INSET;
    const cells = options.map((o, i) => {
      const w = natural[i]! * scale;
      const cell = { option: o, x, w };
      x += w;
      return cell;
    });
    box.data = { cells, font, width };
    box.h = H;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const p = ctx.props(box.node);
    const { cells, font, width } = box.data as { cells: Array<{ option: string; x: number; w: number }>; font: string; width: number };
    const chosen = p.bound();
    const current = cells.some((cell) => cell.option === chosen) ? chosen : cells[0]?.option;
    ctx.roundRect(box.x, box.y, width, H, theme.radius.md);
    fillTint(g, c.ink, 0.06);
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const cell of cells) {
      const on = cell.option === current;
      const part = partBox(box, box.x + cell.x, box.y + INSET, cell.w, H - INSET * 2);
      if (on) {
        ctx.roundRect(part.x, part.y, part.w, part.h, Math.max(2, theme.radius.md - INSET));
        g.fillStyle = c.surface;
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = c.line;
        g.stroke();
      } else if (ctx.isHovered(box.node, cell.option)) {
        ctx.roundRect(part.x, part.y, part.w, part.h, Math.max(2, theme.radius.md - INSET));
        fillTint(g, c.ink, 0.05);
      }
      g.fillStyle = on ? c.ink : c.muted;
      g.fillText(fitText(g, cell.option, Math.max(0, cell.w - 10)), part.x + part.w / 2, part.y + part.h / 2 + 1);
      ctx.addHit(part, { detail: cell.option });
    }
  },
  press(ctx) {
    if (typeof ctx.target.detail === "string") choose(ctx, ctx.target.detail);
  },
  key(ctx, k) {
    if (k !== "ArrowLeft" && k !== "ArrowRight") return false;
    const p = ctx.props(ctx.target.node);
    const options = optionsOf(p.str("options"));
    const at = Math.max(0, options.indexOf(String(p.bound() ?? options[0])));
    const next = options[Math.min(options.length - 1, Math.max(0, at + (k === "ArrowRight" ? 1 : -1)))];
    if (next !== undefined) choose(ctx, next);
    return true;
  },
};
