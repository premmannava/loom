/**
 * timeline and step: things in order, each marked done, current or upcoming,
 * joined by a line down the left. For order tracking, itineraries, project
 * history and how-to guides.
 *
 *   timeline
 *     step "Ordered" detail="Oct 18" status=done
 *     step "Out for delivery" status=current
 *     step "Delivered" status=upcoming
 *
 * The timeline draws the markers and the line, since it knows each step's
 * neighbours; a step lays out and paints its own words.
 */
import type { ComponentDef } from "../component";
import { drawIcon, isIconName } from "../icons";
import { wrapText } from "../text";
import type { Box } from "../types";
import { gapProp, iconProblems, iconProp, stack, themeFont } from "./util";

const STATUSES = ["done", "current", "upcoming"] as const;
/** "plain" is a step with no status: a plan or itinerary, where nothing is done yet or tracked. */
type Status = (typeof STATUSES)[number] | "plain";

/** The marker's size, and where a step's words start. */
const MARK = 22, TEXT_X = MARK + 12;

type StepLayout = {
  title: string[];
  detail: string[];
  time: string;
  titleFont: string;
  detailFont: string;
  timeFont: string;
  titleLH: number;
  detailLH: number;
  status: Status;
};

export const timeline: ComponentDef = {
  type: "timeline",
  category: "layout",
  description: "Steps in order with a line joining them: itineraries, how-to guides, order tracking, project history. Give steps a status only to show progress, like where an order is or which step the person has reached.",
  props: {
    gap: gapProp(20),
  },
  children: ["step"],
  example: `timeline
  step "Day 1: Sedona" detail="Cathedral Rock at sunrise"
  step "Day 2: Flagstaff" detail="Lowell Observatory at night"
  step "Day 3: Grand Canyon" detail="South Rim, Mather Point"
# Showing progress: a status on every step
timeline
  step "Ordered" time="Oct 18" status=done
  step "Out for delivery" detail="Arrives by 8 PM" status=current
  step "Delivered" status=upcoming`,
  minWidth: () => 160,
  layout(box, ctx) {
    stack(box, ctx, 0, ctx.props(box.node).num("gap", 20));
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const steps = box.children.filter((k) => k.node.type === "step" && k.h > 0);
    const statusOf = (k: Box): Status => ((k.data as StepLayout | undefined)?.status ?? "plain");
    const centerY = (k: Box) => k.y + ((k.data as StepLayout | undefined)?.titleLH ?? MARK) / 2;
    const cx = box.x + MARK / 2;
    // The line between markers: accent up to the current step, then the line color.
    g.lineWidth = 2;
    g.lineCap = "round";
    steps.forEach((k, i) => {
      const next = steps[i + 1];
      if (!next) return;
      g.beginPath();
      g.moveTo(cx, centerY(k) + MARK / 2 + 3);
      g.lineTo(cx, centerY(next) - MARK / 2 - 3);
      g.strokeStyle = statusOf(k) === "done" && statusOf(next) !== "upcoming" ? c.accent : c.line;
      g.stroke();
    });
    for (const k of steps) {
      const status = statusOf(k);
      const y = centerY(k);
      const icon = ctx.props(k.node).str("icon");
      g.beginPath();
      g.arc(cx, y, MARK / 2 - 1, 0, Math.PI * 2);
      if (status === "done") {
        g.fillStyle = c.accent;
        g.fill();
        drawIcon(g, isIconName(icon) ? icon : "check", cx - 7, y - 7, 14, c.onAccent);
      } else {
        g.fillStyle = c.surface;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = status === "current" ? c.accent : c.line;
        g.stroke();
        if (isIconName(icon)) drawIcon(g, icon, cx - 7, y - 7, 14, status === "current" ? c.accent : c.muted);
        else if (status !== "upcoming") {
          // Current: an accent dot. Plain (no status): a small muted dot, so nothing looks finished or pending.
          g.beginPath();
          g.arc(cx, y, status === "current" ? 4 : 3, 0, Math.PI * 2);
          g.fillStyle = status === "current" ? c.accent : c.muted;
          g.fill();
        }
      }
    }
  },
};

export const step: ComponentDef = {
  type: "step",
  category: "layout",
  description: "One step of a timeline: a title, an optional detail line and time, and whether it's done, current or upcoming.",
  text: { description: "The step's title, e.g. Shipped.", required: true },
  props: {
    status: {
      type: "enum", values: STATUSES,
      description: "Only to show progress: done for finished steps, current for where the person is now, upcoming for what's left (muted). Leave it out on every step for a plan, itinerary or how-to that hasn't started.",
    },
    detail: { type: "string", description: "A quieter line under the title, like a place or a note." },
    time: { type: "string", description: "A short date or time on the right, e.g. Oct 18 or 9:12 AM." },
    icon: { ...iconProp, description: "An icon in the step's marker instead of the check or dot, by name from icon's list, e.g. icon=truck." },
  },
  parents: ["timeline"],
  example: `step "Shipped" detail="Left the Phoenix warehouse" time="Oct 19" status=done icon=truck`,
  check: (props) => iconProblems(props.icon, "icon"),
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme, m = ctx.measure;
    const titleFont = themeFont(t, 600, t.text.body), detailFont = themeFont(t, 400, t.text.caption + 1), timeFont = themeFont(t, 400, t.text.caption);
    const titleLH = Math.max(MARK, Math.round(t.text.body * 1.4)), detailLH = Math.round((t.text.caption + 1) * 1.45);
    const time = p.str("time");
    const timeW = time ? Math.min(box.w * 0.35, m.width(time, timeFont)) + t.space.sm : 0;
    const textW = Math.max(40, box.w - TEXT_X - timeW);
    const title = wrapText(p.text(), textW, titleFont, m);
    const detail = p.has("detail") ? wrapText(p.str("detail"), Math.max(40, box.w - TEXT_X), detailFont, m) : [];
    const data: StepLayout = { title, detail, time, titleFont, detailFont, timeFont, titleLH, detailLH, status: p.has("status") ? p.oneOf("status", STATUSES, "upcoming") : "plain" };
    box.data = data;
    box.h = title.length * titleLH + (detail.length ? detail.length * detailLH : 0);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as StepLayout;
    const x = box.x + TEXT_X;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = d.titleFont;
    g.fillStyle = d.status === "upcoming" ? c.muted : c.ink;
    d.title.forEach((l, i) => g.fillText(l, x, box.y + i * d.titleLH + d.titleLH / 2));
    let y = box.y + d.title.length * d.titleLH;
    g.font = d.detailFont;
    g.fillStyle = c.muted;
    for (const l of d.detail) { g.fillText(l, x, y + d.detailLH / 2 - 2); y += d.detailLH; }
    if (d.time) {
      g.font = d.timeFont;
      g.textAlign = "right";
      g.fillText(fitWidth(g, d.time, box.w * 0.35), box.x + box.w, box.y + d.titleLH / 2);
    }
  },
};

/** Cut text to a width with an ellipsis, using the canvas's own measurement. */
function fitWidth(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + "…").width > width) s = s.slice(0, -1);
  return s + "…";
}
