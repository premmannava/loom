/**
 * A stand-in for <canvas> and its 2D context, so the real SayShape engine can run
 * in Node. The context draws nothing; it records every drawing call together
 * with the style that was active, which is what tests need to check colors,
 * fonts and text.
 */

/** A drawing call that put something on screen, with the style in effect. */
export interface DrawOp {
  op: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
  font: string;
  globalAlpha: number;
  /** For text: where x is on the text (left, center, right, start or end). */
  textAlign: string;
}

/** Calls that mark pixels. Everything else (paths, transforms, state) only prepares. */
const DRAWING_OPS = new Set(["fill", "stroke", "fillRect", "strokeRect", "fillText", "strokeText", "drawImage"]);
const USES_FILL = new Set(["fill", "fillRect", "fillText"]);

interface Style {
  fillStyle: string;
  strokeStyle: string;
  font: string;
  globalAlpha: number;
  [key: string]: unknown;
}

const initialStyle = (): Style => ({ fillStyle: "#000000", strokeStyle: "#000000", font: "10px sans-serif", globalAlpha: 1 });

/** Width of text in a font, with a fixed advance per character (same rule as MonoMeasurer). */
export function monoWidth(text: string, font: string, advance = 0.55): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return text.length * size * advance;
}

/**
 * Create a recording 2D context. Unknown methods are accepted and recorded,
 * so components can use any canvas API without the stand-in needing updates.
 */
export function createRecordingContext(): { context: CanvasRenderingContext2D; take(): DrawOp[] } {
  let style = initialStyle();
  const stack: Style[] = [];
  let log: DrawOp[] = [];

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    save: () => { stack.push({ ...style }); },
    restore: () => { style = stack.pop() ?? style; },
    measureText: (text) => ({ width: monoWidth(String(text), style.font) }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getLineDash: () => [],
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };

  const target = {} as Record<string, unknown>;
  const context = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in methods) return methods[prop];
      if (prop in style) return style[prop];
      if (prop === "canvas") return undefined;
      return (...args: unknown[]) => {
        if (!DRAWING_OPS.has(prop)) return undefined;
        const fill = USES_FILL.has(prop);
        const colored = prop !== "drawImage";
        log.push({
          op: prop,
          args,
          fillStyle: colored && fill ? style.fillStyle : "",
          strokeStyle: colored && !fill ? style.strokeStyle : "",
          font: prop.endsWith("Text") ? style.font : "",
          globalAlpha: style.globalAlpha,
          textAlign: prop.endsWith("Text") ? String(style.textAlign ?? "start") : "",
        });
        return undefined;
      };
    },
    set(_t, prop, value) {
      if (typeof prop === "string") style[prop] = typeof value === "number" || typeof value === "string" ? value : String(value);
      return true;
    },
    has(_t, prop) {
      return typeof prop === "string" && prop in style;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    context,
    take() {
      const out = log;
      log = [];
      return out;
    },
  };
}

type Listener = (event: unknown) => void;

/** The parts of HTMLCanvasElement the engine uses, plus a way to send it events. */
export class FakeCanvas {
  width = 300;
  height = 150;
  tabIndex = -1;
  readonly style: Record<string, string> = {};
  readonly parentElement = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<Listener>>();
  private recorder = createRecordingContext();

  getContext(kind: string): CanvasRenderingContext2D | null {
    return kind === "2d" ? this.recorder.context : null;
  }

  /** Drawing calls since the last call to take(). */
  takeDrawOps(): DrawOp[] {
    return this.recorder.take();
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Deliver an event to the engine's listeners. Returns true if a listener called preventDefault. */
  dispatch(type: string, init: Record<string, unknown> = {}): boolean {
    let prevented = false;
    const event = { type, ...init, preventDefault: () => { prevented = true; } };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
    return prevented;
  }

  setPointerCapture(_id: number): void {}

  /** Whether the canvas itself has keyboard focus (rather than a text box over a field). */
  focused = false;
  focus(): void { this.focused = true; }
  blur(): void { this.focused = false; }
  releasePointerCapture(_id: number): void {}

  getBoundingClientRect() {
    return { left: 0, top: 0, x: 0, y: 0, right: this.width, bottom: this.height, width: this.width, height: this.height };
  }
}

/**
 * Path2D doesn't exist in Node. The map component builds country outlines
 * with it, so install an inert stand-in when it's missing. Point tests
 * (`isPointInPath`) always miss, so map clicks can't be tested in Node.
 */
export function ensurePath2D(): void {
  const g = globalThis as { Path2D?: unknown };
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {
      constructor(_d?: unknown) {}
      addPath(): void {}
      closePath(): void {}
      moveTo(): void {}
      lineTo(): void {}
      arc(): void {}
      rect(): void {}
    };
  }
}
