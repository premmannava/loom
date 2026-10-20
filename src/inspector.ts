/**
 * Debugging tools for a canvas, where browser DevTools can't see elements:
 *
 *  - layout boxes overlay (every box with type and size)
 *  - hit regions overlay (what is actually clickable)
 *  - inspect mode (hover to highlight, click to select; reports the spec line)
 *  - frame capture (the exact list of canvas calls for one frame)
 */
import { boxAt, walkBoxes } from "./layout";
import type { Loom } from "./engine";
import type { Box, HitRegion, LoomNode } from "./types";

export interface DrawCall {
  op: string;
  args: unknown[];
}

const HIT_HUES = [190, 280, 30, 130, 330, 60];

export class Inspector {
  showBoxes = false;
  showHits = false;
  inspecting = false;
  hovered: Box | null = null;
  selected: Box | null = null;
  private capture: DrawCall[] | null = null;
  private captureDone: ((calls: DrawCall[]) => void) | null = null;

  constructor(private loom: Loom) {}

  setBoxes(on: boolean): void { this.showBoxes = on; this.loom.invalidate("paint"); }
  setHits(on: boolean): void { this.showHits = on; this.loom.invalidate("paint"); }

  setInspecting(on: boolean): void {
    this.inspecting = on;
    if (!on) this.hovered = null;
    this.loom.canvas.style.cursor = on ? "crosshair" : "default";
    this.loom.invalidate("paint");
  }

  pointerMove(x: number, y: number): void {
    const root = this.loom.boxes;
    const b = root ? boxAt(root, x, y) : null;
    const next = b && b.node.id !== "root" ? b : null;
    if (next !== this.hovered) { this.hovered = next; this.loom.invalidate("paint"); }
  }

  pointerLeave(): void {
    if (this.hovered) { this.hovered = null; this.loom.invalidate("paint"); }
  }

  select(x: number, y: number): void {
    const root = this.loom.boxes;
    const b = root ? boxAt(root, x, y) : null;
    this.selectBox(b && b.node.id !== "root" ? b : null);
  }

  /** Select the box created by a given spec line (used by editors). */
  selectLine(line: number): Box | null {
    const b = this.boxForLine(line);
    this.selectBox(b);
    return b;
  }

  boxForLine(line: number): Box | null {
    let found: Box | null = null;
    if (this.loom.boxes) walkBoxes(this.loom.boxes, (b) => { if (!found && b.node.line === line) found = b; });
    return found;
  }

  private selectBox(b: Box | null): void {
    this.selected = b;
    this.loom.emitInspect(b ? { node: b.node, box: b } : null);
    this.loom.invalidate("paint");
  }

  /** A plain summary of a node, for panels and the console. */
  describe(node: LoomNode): Record<string, unknown> {
    const box = this.findBox(node);
    return {
      type: node.type,
      line: node.line,
      ...(node.text !== undefined ? { text: node.text } : {}),
      props: node.props,
      box: box ? { x: round(box.x), y: round(box.y), width: round(box.w), height: round(box.h) } : null,
      children: node.children.length,
    };
  }

  private findBox(node: LoomNode): Box | null {
    let found: Box | null = null;
    if (this.loom.boxes) walkBoxes(this.loom.boxes, (b) => { if (!found && b.node.id === node.id) found = b; });
    return found;
  }

  /** Record every canvas call made while painting the next frame. */
  captureFrame(): Promise<DrawCall[]> {
    return new Promise((resolve) => {
      this.capture = [];
      this.captureDone = resolve;
      this.loom.invalidate("paint");
    });
  }

  /** @internal */
  wrapContext(g: CanvasRenderingContext2D): CanvasRenderingContext2D {
    const log = this.capture;
    if (!log) return g;
    return new Proxy(g, {
      get(target, prop, _recv) {
        const v = Reflect.get(target, prop, target);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          log.push({ op: String(prop), args: args.map(simplify) });
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
      set(target, prop, value) {
        log.push({ op: `set ${String(prop)}`, args: [simplify(value)] });
        return Reflect.set(target, prop, value, target);
      },
    });
  }

  /** @internal */
  endCapture(): void {
    if (this.capture && this.captureDone) {
      const calls = this.capture, done = this.captureDone;
      this.capture = null;
      this.captureDone = null;
      done(calls);
    }
  }

  /** @internal */
  paintOverlay(g: CanvasRenderingContext2D, root: Box, hits: HitRegion[]): void {
    const c = this.loom.theme.colors;
    const mono = this.loom.theme.font.mono;
    g.save();
    if (this.showHits) {
      hits.forEach((h, i) => {
        const hue = HIT_HUES[i % HIT_HUES.length]!;
        g.fillStyle = `hsla(${hue}, 85%, 55%, 0.22)`;
        g.strokeStyle = `hsla(${hue}, 85%, 45%, 0.9)`;
        g.lineWidth = 1;
        g.fillRect(h.box.x, h.box.y, h.box.w, h.box.h);
        g.strokeRect(h.box.x + 0.5, h.box.y + 0.5, h.box.w - 1, h.box.h - 1);
      });
    }
    if (this.showBoxes) {
      walkBoxes(root, (b) => {
        if (b.node.id === "root") return;
        g.setLineDash([4, 3]);
        g.strokeStyle = c.debug;
        g.lineWidth = 1;
        g.strokeRect(b.x + 0.5, b.y + 0.5, Math.max(1, b.w - 1), Math.max(1, b.h - 1));
        g.setLineDash([]);
        label(g, `${b.node.type} ${round(b.w)}×${round(b.h)}`, b.x, b.y, c.debug, c.surface, mono);
      });
    }
    for (const [b, solid] of [[this.hovered, false], [this.selected, true]] as const) {
      if (!b) continue;
      if (!solid) {
        g.fillStyle = c.focus;
        g.globalAlpha = 0.12;
        g.fillRect(b.x, b.y, b.w, b.h);
        g.globalAlpha = 1;
      }
      g.strokeStyle = c.focus;
      g.lineWidth = solid ? 2 : 1;
      g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, Math.max(1, b.h - 1));
      label(g, `${b.node.type} · line ${b.node.line} · ${round(b.w)}×${round(b.h)}`, b.x, b.y, c.focus, c.surface, mono);
    }
    g.restore();
  }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string, mono: string): void {
  g.font = `500 10px ${mono}`;
  const w = g.measureText(text).width + 8;
  const ly = y >= 13 ? y - 13 : y;
  g.fillStyle = bg;
  g.fillRect(x, ly, w, 13);
  g.fillStyle = fg;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(text, x + 4, ly + 6.5);
}

const round = (n: number) => Math.round(n * 10) / 10;

function simplify(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 100) / 100;
  if (v && typeof v === "object") return `[${v.constructor?.name ?? "object"}]`;
  return v;
}
