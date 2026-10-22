import type { ComponentDef, PaintContext } from "../component";
import type { Box } from "../types";
import { fillTint } from "./util";
import { fitText } from "./input";

const RATIOS = ["16:9", "4:3", "3:2", "1:1", "2:3", "3:4"] as const;
const FITS = ["cover", "contain"] as const;
const FADE_MS = 200;

/** Width over height, from a ratio like "4:3". */
export function ratioValue(r: (typeof RATIOS)[number]): number {
  const [w, h] = r.split(":").map(Number) as [number, number];
  return w / h;
}

/** The source rectangle to draw so the image covers, or fits inside, the box. */
export function fitRect(imgW: number, imgH: number, boxW: number, boxH: number, fit: (typeof FITS)[number]) {
  const scale = fit === "cover" ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * scale, h = imgH * scale;
  if (fit === "contain") return { sx: 0, sy: 0, sw: imgW, sh: imgH, dx: (boxW - w) / 2, dy: (boxH - h) / 2, dw: w, dh: h };
  // Cover: crop the overflow equally from both sides.
  const sw = boxW / scale, sh = boxH / scale;
  return { sx: (imgW - sw) / 2, sy: (imgH - sh) / 2, sw, sh, dx: 0, dy: 0, dw: boxW, dh: boxH };
}

/** A small picture glyph (a frame with a hill and a sun) for images that can't show. */
function glyph(ctx: PaintContext, cx: number, cy: number): void {
  const { g, theme } = ctx;
  g.save();
  g.strokeStyle = theme.colors.muted;
  g.lineWidth = 1.6;
  g.lineJoin = "round";
  ctx.roundRect(cx - 14, cy - 11, 28, 22, 4);
  g.stroke();
  g.beginPath();
  g.moveTo(cx - 10, cy + 7);
  g.lineTo(cx - 3, cy - 1);
  g.lineTo(cx + 2, cy + 4);
  g.lineTo(cx + 5, cy + 1);
  g.lineTo(cx + 10, cy + 7);
  g.stroke();
  g.beginPath();
  g.arc(cx + 6, cy - 5, 2.2, 0, Math.PI * 2);
  g.fillStyle = theme.colors.muted;
  g.fill();
  g.restore();
}

function placeholder(box: Box, ctx: PaintContext, alt: string): void {
  const { g, theme } = ctx;
  fillTint(g, theme.colors.line, 0.6);
  const showAlt = box.h >= 72 && alt;
  glyph(ctx, box.x + box.w / 2, box.y + box.h / 2 - (showAlt ? 12 : 0));
  if (!showAlt) return;
  g.font = ctx.font(400, 13);
  g.fillStyle = theme.colors.muted;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(fitText(g, alt, Math.max(0, box.w - 24)), box.x + box.w / 2, box.y + box.h / 2 + 18);
}

export const image: ComponentDef = {
  type: "image",
  category: "content",
  description: "A picture, such as a product photo. The quoted text says what it shows, and is displayed if the image can't load.",
  text: { description: "What the image shows, e.g. Blue trail runners from the side.", required: true },
  props: {
    src: { type: "string", required: true, description: "The image URL. Only the app's own site and hosts it allows will load." },
    ratio: { type: "enum", values: RATIOS, default: "16:9", description: "Width to height: 16:9, 4:3, 3:2, 1:1, 2:3 or 3:4. The space is kept while the image loads." },
    fit: { type: "enum", values: FITS, default: "cover", description: "cover fills the space and crops the edges; contain shows the whole image." },
  },
  example: `image "Ridgeline trail runners, side view" src="/images/ridgeline.jpg" ratio=4:3`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    box.h = Math.round(box.w / ratioValue(p.oneOf("ratio", RATIOS, "16:9")));
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const state = ctx.image(p.str("src"));
    g.save();
    ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.md);
    g.clip();
    if (state.status === "ready" && state.image) {
      const img = state.image;
      const fit = p.oneOf("fit", FITS, "cover");
      if (fit === "contain") fillTint(g, theme.colors.line, 0.4);
      const age = ctx.now - (state.readyAt ?? 0);
      if (ctx.motion && age < FADE_MS) {
        g.globalAlpha *= Math.max(0, age / FADE_MS);
        ctx.requestFrame();
      }
      const r = fitRect(img.width || 1, img.height || 1, box.w, box.h, fit);
      g.drawImage(img.source, r.sx, r.sy, r.sw, r.sh, box.x + r.dx, box.y + r.dy, r.dw, r.dh);
    } else if (state.status === "loading") {
      fillTint(g, theme.colors.line, 0.6);
    } else {
      placeholder(box, ctx, p.text());
    }
    g.restore();
  },
};
