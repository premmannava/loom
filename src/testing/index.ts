/**
 * Test helpers for Loom (`loom-ui/testing`).
 *
 * `render()` runs the real engine (parse, layout, paint, hit testing,
 * pointer and keyboard handling) against a recording stand-in for the
 * canvas, so interaction tests run in Node with any test runner:
 *
 *   const ui = render(`state n=0\nbutton "Add" on=inc:n`);
 *   ui.press({ type: "button", text: "Add" });
 *   expect(ui.state.n).toBe(1);
 *
 * Nothing here is used by the engine itself, and it has no dependencies.
 */
import type { ComponentDef } from "../component";
import { coreComponents } from "../components";
import { Loom, type LoomEvents } from "../engine";
import { interpolate } from "../expr";
import { walkBoxes } from "../layout";
import { lightTheme, type Theme } from "../theme";
import type { Box, Diagnostic, HitRegion, LoomNode, Value } from "../types";
import { ensurePath2D, FakeCanvas, type DrawOp } from "./canvas";

export { createRecordingContext, FakeCanvas, monoWidth, type DrawOp } from "./canvas";

export interface RenderOptions {
  /** Components to register. Default: the core components (add `mapComponents` for maps). */
  components?: ComponentDef[];
  /** Layout width in CSS pixels. Default 600. */
  width?: number;
  /** Default: the light theme. */
  theme?: Theme;
  /** Padding around the screen. Default 20, like the engine. */
  padding?: number;
}

/** Which element to find. A string is shorthand for `{ type }`. */
export type Query =
  | string
  | {
      type?: string;
      /** Matches the element's text as written in the spec or as currently shown (with {expressions} filled in). */
      text?: string | RegExp;
      /** The spec line the element is on. */
      line?: number;
    };

export interface Found {
  node: LoomNode;
  /** The element's box, or null when it's hidden by `if=` or not laid out. */
  box: Box | null;
  /** The text as currently shown, with {expressions} filled in. */
  shownText: string | undefined;
}

export interface Emitted {
  name: string;
  value: Value | undefined;
}

export interface Rendered {
  /** The engine instance, for anything the helpers don't cover. */
  loom: Loom;
  /** The stand-in canvas, for sending raw events. */
  canvas: FakeCanvas;
  /** Current state, as a plain object. */
  readonly state: Record<string, Value>;
  readonly diagnostics: Diagnostic[];
  /** Every `emit:` the screen has sent, oldest first. */
  readonly emitted: Emitted[];
  /** Drawing calls from the most recent frame. */
  readonly drawOps: DrawOp[];
  /** Interactive regions from the most recent frame. */
  readonly hits: readonly HitRegion[];
  /** The element with keyboard focus, if any. */
  readonly focused: LoomNode | null;

  /** Elements matching a query, in spec order. Hidden elements are included with `box: null`. */
  findAll(query: Query): Found[];
  /** The single element matching a query. Throws if there are none or several. */
  find(query: Query): Found;
  /** Whether an element matching the query is laid out (not hidden by `if=`). */
  isShown(query: Query): boolean;
  /** Text drawn in the most recent frame, one entry per line of text. */
  text(): string[];

  /** Click the centre of an element through the real pointer path. Throws if it can't be pressed. */
  press(query: Query): void;
  /** Click at a point, in CSS pixels from the canvas's top-left corner. */
  click(x: number, y: number): void;
  /** Send a key press to the canvas, e.g. key("Tab"), key("Enter"), key("Tab", { shift: true }). */
  key(key: string, opts?: { shift?: boolean }): void;
  /** Move keyboard focus with Tab (or Shift+Tab when `back` is true). */
  tab(back?: boolean): void;
  /** Change a state value, as the host app might. */
  set(key: string, value: Value): void;

  /** Replace the spec. State is kept unless resetState is true. */
  setSpec(spec: string, opts?: { resetState?: boolean }): void;
  /** Stream a spec in chunks, rendering after each one, as a model's response would arrive. */
  stream(chunks: Iterable<string>, opts?: { keepState?: boolean }): void;

  /** Remove listeners. */
  destroy(): void;
}

export function render(spec: string, opts: RenderOptions = {}): Rendered {
  ensurePath2D();
  const canvas = new FakeCanvas();
  const loom = new Loom(canvas as unknown as HTMLCanvasElement, {
    components: opts.components ?? coreComponents,
    theme: opts.theme ?? lightTheme,
    width: opts.width ?? 600,
    padding: opts.padding,
    animate: false,
  });

  const emitted: Emitted[] = [];
  let drawOps: DrawOp[] = [];
  loom.on("action", (e: LoomEvents["action"]) => emitted.push({ name: e.name, value: e.value }));
  loom.on("render", () => { drawOps = canvas.takeDrawOps(); });

  const flush = () => loom.renderNow();
  loom.setSpec(spec);
  flush();

  const describeQuery = (q: Query) => (typeof q === "string" ? q : JSON.stringify(q, (_k, v) => (v instanceof RegExp ? String(v) : v)));

  const boxesById = () => {
    const map = new Map<string, Box>();
    if (loom.boxes) walkBoxes(loom.boxes, (b) => { if (!map.has(b.node.id)) map.set(b.node.id, b); });
    return map;
  };

  const findAll = (query: Query): Found[] => {
    const q = typeof query === "string" ? { type: query } : query;
    const boxes = boxesById();
    const out: Found[] = [];
    const scope = loom.state.scope;
    const walk = (n: LoomNode) => {
      if (n.id !== "root") {
        const shownText = n.text === undefined ? undefined : interpolate(n.text, scope);
        const textOk =
          q.text === undefined ||
          (q.text instanceof RegExp
            ? (n.text !== undefined && q.text.test(n.text)) || (shownText !== undefined && q.text.test(shownText))
            : n.text === q.text || shownText === q.text);
        if ((q.type === undefined || n.type === q.type) && (q.line === undefined || n.line === q.line) && textOk) {
          out.push({ node: n, box: boxes.get(n.id) ?? null, shownText });
        }
      }
      n.children.forEach(walk);
    };
    if (loom.tree) walk(loom.tree);
    return out;
  };

  const find = (query: Query): Found => {
    const all = findAll(query);
    if (all.length === 1) return all[0]!;
    if (!all.length) throw new Error(`No element matches ${describeQuery(query)}`);
    const where = all.map((f) => `line ${f.node.line}`).join(", ");
    throw new Error(`${all.length} elements match ${describeQuery(query)} (${where}). Add text or line to the query`);
  };

  const pointer = (type: string, x: number, y: number) => canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1 });

  const ui: Rendered = {
    loom,
    canvas,
    get state() { return loom.state.snapshot(); },
    get diagnostics() { return loom.diagnostics; },
    get emitted() { return emitted; },
    get drawOps() { return drawOps; },
    get hits() { return loom.hitRegions; },
    get focused() { return loom.focus?.node ?? null; },

    findAll,
    find,
    isShown: (query) => find(query).box !== null,
    text: () => drawOps.filter((d) => d.op === "fillText").map((d) => String(d.args[0])),

    press(query) {
      const found = find(query);
      const name = `"${found.node.type}" on line ${found.node.line}`;
      if (!found.box) throw new Error(`${name} is hidden, so it can't be pressed`);
      const region = loom.hitRegions.find((h) => h.box.node.id === found.node.id);
      if (!region) throw new Error(`${name} isn't pressable right now (it may be disabled or not interactive)`);
      const b = region.box;
      ui.click(b.x + b.w / 2, b.y + b.h / 2);
    },

    click(x, y) {
      pointer("pointermove", x, y);
      pointer("pointerdown", x, y);
      pointer("pointerup", x, y);
      flush();
    },

    key(key, o = {}) {
      canvas.dispatch("keydown", { key, shiftKey: !!o.shift });
      flush();
    },

    tab(back = false) {
      ui.key("Tab", { shift: back });
    },

    set(key, value) {
      loom.state.set(key, value);
      flush();
    },

    setSpec(next, o) {
      loom.setSpec(next, o);
      flush();
    },

    stream(chunks, o) {
      loom.beginStream(o);
      flush();
      for (const c of chunks) {
        loom.push(c);
        flush();
      }
      loom.endStream();
      flush();
    },

    destroy() {
      loom.destroy();
    },
  };
  return ui;
}
