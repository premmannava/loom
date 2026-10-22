/**
 * The Loom engine: owns a canvas and runs the pipeline
 *
 *   spec text → parse → tree → layout → boxes → paint → pixels
 *                                  ↑                    │
 *                state ←── actions ←── pointer/keyboard ┘
 *
 * Each stage only re-runs when its inputs change: editing the spec re-parses,
 * changing state re-lays out, hovering only repaints.
 */
import { parseActions, runActions } from "./actions";
import { PropReader, type ComponentDef, type DragContext, type LayoutContext, type PaintContext, type PopupContext, type PressContext } from "./component";
import { Emitter } from "./emitter";
import { locateOf, scopeOf } from "./each";
import { domEditorHost } from "./dom-editor";
import { noEditor, type EditorHost, type EditorSpec } from "./editor";
import { isList, makeList } from "./data";
import { getIn, placeOf, setIn } from "./paths";
import { createLayoutContext, isVisible } from "./layout";
import { placePopup, POPUP_MARGIN, type PopupState, type Viewport } from "./popup";
import { parse, type ParseResult } from "./parser";
import { Registry } from "./registry";
import { Store } from "./state";
import { CanvasMeasurer, font as fontString, wrapText } from "./text";
import { darkTheme, lightTheme, themeFromCSS, type Theme } from "./theme";
import { Inspector } from "./inspector";
import { browserImageLoader, ImageCache, type ImageLoader, type ImagePolicy } from "./images";
import type { Box, Diagnostic, HitRegion, HitTarget, LoomNode, Rect, Value } from "./types";

export interface Metrics {
  nodes: number;
  parseMs: number;
  layoutMs: number;
  paintMs: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface LoomEvents {
  /** An `emit:` action ran. This is how the host app (or a model) hears about user intent. */
  action: { name: string; value: Value | undefined; node: LoomNode };
  /** A state value changed. */
  change: { key: string; value: Value };
  /** A frame was painted. */
  render: Metrics;
  /** Parse diagnostics changed. */
  diagnostics: Diagnostic[];
  /** Inspect mode selected (or cleared) a node. */
  inspect: { node: LoomNode; box: Box } | null;
  /** A notify: action (or the host) showed a message. */
  notify: { text: string };
  /** The visible screen changed, through go:, back or the host. */
  navigate: { screen: string; from: string | undefined };
}

export interface LoomOptions {
  components: ComponentDef[];
  /** A fixed theme, or "auto" to follow light/dark mode and --loom-* CSS variables. */
  theme?: Theme | "auto";
  /** Fixed CSS width. Default: the canvas parent's width, tracked on resize. */
  width?: number;
  minHeight?: number;
  /** Padding around the whole screen. */
  padding?: number;
  /** Fade new elements in. Default true, off when the user prefers reduced motion. */
  animate?: boolean;
  /**
   * Hosts images may load from, besides the page's own origin, e.g.
   * ["cdn.example.com", "*.images.example.com"]. Other images are blocked and
   * show their description instead. Default: none.
   */
  imageHosts?: string[];
  /** Custom image loading (server rendering, tests, a CDN signer). Default: an <img> with CORS. */
  loadImage?: ImageLoader;
  /** Problems found while running, like a blocked image. Default: console.warn with a "Loom:" prefix. */
  onWarning?: (message: string) => void;
  /**
   * Places a real text box over a field while someone types in it. Default:
   * an <input> next to the canvas in browsers, nothing elsewhere.
   * loom-ui/testing passes a fake one.
   */
  editor?: EditorHost;
  /**
   * The part of the canvas people can see, in canvas CSS pixels, for placing
   * popups. Default: worked out from the canvas's place in the window (in
   * Node, everything from the top down).
   */
  viewport?: () => Viewport;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Loom {
  readonly canvas: HTMLCanvasElement;
  readonly registry: Registry;
  readonly state = new Store();
  readonly inspector: Inspector;
  private images: ImageCache;
  private events = new Emitter<LoomEvents>();
  private g: CanvasRenderingContext2D;
  private measurer: CanvasMeasurer;
  private opts: LoomOptions;
  theme: Theme;

  private source = "";
  private streaming = false;
  private parsed: ParseResult | null = null;
  private rootBox: Box | null = null;
  private hits: HitRegion[] = [];
  private seen = new Map<string, number>();
  /** Screens visited before the current one, for back. */
  private history: string[] = [];
  private toast: { text: string; shownAt: number } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = { parse: true, layout: true, paint: true };
  private frame = 0;
  private width = 0;
  private lastDiagKey = "";
  private cleanup: Array<() => void> = [];

  hover: HitTarget | null = null;
  /** The element being dragged, while the pointer is held on one that defines drag. */
  private dragging: HitTarget | null = null;
  focus: HitTarget | null = null;
  pressed: HitTarget | null = null;
  pointer: { x: number; y: number } | null = null;
  private keyboardMode = false;
  private warn: (message: string) => void;
  private editorHost: EditorHost;
  /** The field being typed into, if any. */
  editing: HitTarget | null = null;
  /** What was last typed and the value it wrote, so writing "1." (stored as 1) doesn't rewrite the field to "1". */
  private typed: { text: string; value: Value } | null = null;
  /** Layout warnings already reported for this spec, so a list problem isn't repeated every frame. */
  private warned = new Set<string>();
  /** The open popup, if any: its owner, its transient state, and where it was placed. */
  private popup: { owner: HitTarget; state: PopupState; area: Rect | null } | null = null;
  /** The open popup's hit regions from the latest frame, checked before the screen's. */
  private popupHits: HitRegion[] = [];
  /** Set when a press outside an open popup closed it, so its release does nothing either. */
  private swallowRelease = false;

  metrics: Metrics = { nodes: 0, parseMs: 0, layoutMs: 0, paintMs: 0, width: 0, height: 0, pixelWidth: 0, pixelHeight: 0 };

  constructor(canvas: HTMLCanvasElement, opts: LoomOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.registry = new Registry(opts.components);
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Loom needs a 2D canvas context");
    this.g = g;
    this.measurer = new CanvasMeasurer(g);
    this.theme = this.resolveTheme();
    this.inspector = new Inspector(this);
    this.editorHost = opts.editor ?? (typeof document !== "undefined" ? domEditorHost(canvas) : noEditor);
    const warn = (this.warn = opts.onWarning ?? ((m: string) => { if (typeof console !== "undefined") console.warn(`Loom: ${m}`); }));
    this.images = new ImageCache(() => this.imagePolicy(), opts.loadImage ?? browserImageLoader, () => this.invalidate("paint"), now, warn);

    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    // Vertical swipes scroll the page and pinches zoom; horizontal drags reach
    // the canvas (sliders). Also removes the tap delay, like "manipulation".
    canvas.style.touchAction = "pan-y pinch-zoom";
    if (!canvas.getAttribute("aria-label")) canvas.setAttribute("aria-label", "Generated interface");

    // A derived value that can't be worked out shows as nothing; say why, once per spec.
    this.state.onDerivedError = (d, error) => this.warnOnce(`derive ${d.name} on line ${d.line} couldn't be worked out, so it shows as nothing: ${error}`);
    this.state.subscribe((key, value) => {
      this.events.emit("change", { key, value });
      this.invalidate("layout");
    });
    this.bindInput();
    this.bindEnvironment();
  }

  // ---------------------------------------------------------------- spec

  /** Replace the whole spec. State is kept unless resetState is true. */
  setSpec(src: string, opts: { resetState?: boolean } = {}): void {
    if (opts.resetState) this.resetState();
    this.closePopup(false);
    this.source = src;
    this.streaming = false;
    this.invalidate("parse");
  }

  get spec(): string {
    return this.source;
  }

  /** Start a new streamed spec (e.g. a model response). Clears state by default. */
  beginStream(opts: { keepState?: boolean } = {}): void {
    if (!opts.keepState) this.resetState();
    this.closePopup(false);
    this.source = "";
    this.streaming = true;
    this.invalidate("parse");
  }

  /** Append streamed text. Only complete lines are rendered. */
  push(chunk: string): void {
    this.source += chunk;
    if (chunk.includes("\n")) this.invalidate("parse");
  }

  endStream(): void {
    this.streaming = false;
    this.invalidate("parse");
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  get tree(): LoomNode | null {
    return this.parsed?.root ?? null;
  }

  get boxes(): Box | null {
    return this.rootBox;
  }

  get diagnostics(): Diagnostic[] {
    return this.parsed?.diagnostics ?? [];
  }

  /** The interactive regions registered while painting the last frame, in paint order. */
  get hitRegions(): readonly HitRegion[] {
    return this.hits;
  }

  on<K extends keyof LoomEvents>(name: K, fn: (p: LoomEvents[K]) => void): () => void {
    return this.events.on(name, fn);
  }

  /** @internal used by the inspector */
  emitInspect(p: LoomEvents["inspect"]): void {
    this.events.emit("inspect", p);
  }

  setTheme(theme: Theme | "auto"): void {
    this.opts.theme = theme;
    this.theme = this.resolveTheme();
    this.invalidate("layout");
  }

  // ---------------------------------------------------------------- pipeline

  /** Mark a stage (and everything after it) dirty and schedule a frame. */
  invalidate(stage: "parse" | "layout" | "paint" = "paint"): void {
    if (stage === "parse") this.dirty.parse = this.dirty.layout = this.dirty.paint = true;
    else if (stage === "layout") this.dirty.layout = this.dirty.paint = true;
    else this.dirty.paint = true;
    if (!this.frame && typeof requestAnimationFrame !== "undefined") {
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderNow(); });
    }
  }

  /** Run any dirty stages synchronously. */
  renderNow(): void {
    if (this.dirty.parse) this.runParse();
    if (this.dirty.layout) this.runLayout();
    if (this.dirty.paint) this.runPaint();
  }

  private runParse(): void {
    const t = now();
    const s = this.theme.space;
    this.parsed = parse(this.source, this.registry, {
      partial: this.streaming,
      rootProps: { pad: String(this.opts.padding ?? 20), gap: String(s.md) },
      // State the app set itself counts as known, so reading it isn't flagged.
      knownNames: Object.keys(this.state.snapshot()),
    });
    for (const { key, value } of this.parsed.state) this.state.declare(key, value);
    this.warned.clear();
    this.state.derive(this.parsed.derived);
    this.syncScreen();
    this.metrics.parseMs = now() - t;
    this.metrics.nodes = this.parsed.nodeCount;
    this.dirty.parse = false;
    const key = JSON.stringify(this.parsed.diagnostics);
    if (key !== this.lastDiagKey) { this.lastDiagKey = key; this.events.emit("diagnostics", this.parsed.diagnostics); }
  }

  private runLayout(): void {
    if (!this.parsed) return;
    const t = now();
    const width = this.opts.width ?? (this.canvas.parentElement?.clientWidth || 600);
    this.width = width;
    const ctx = createLayoutContext(this.registry, this.theme, this.measurer, this.state.scope, (m) => this.warnOnce(m));
    this.rootBox = ctx.layout(this.parsed.root, 0, 0, width);
    let height = Math.max(this.rootBox.h, this.opts.minHeight ?? 0);
    // A popup that needs more room than the screen has makes the canvas taller while it's open.
    const area = this.placeOpenPopup(ctx, width);
    if (area) height = Math.max(height, area.y + area.h + POPUP_MARGIN);
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const pw = Math.round(width * dpr), ph = Math.round(height * dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    Object.assign(this.metrics, { width, height, pixelWidth: pw, pixelHeight: ph, layoutMs: now() - t });
    this.dirty.layout = false;
    this.refreshTargets();
  }

  /** Report a problem once per spec, however often layout runs into it. */
  private warnOnce(m: string): void {
    if (!this.warned.has(m)) { this.warned.add(m); this.warn(m); }
  }

  /** A write to a derived name: refused, with a reason. */
  private derivedWrite(path: string, key: string): boolean {
    const d = this.state.derivation(key);
    if (!d) return false;
    const item = path.replace(/^remove:/, "") !== key;
    this.warn(`Can't change ${path}: ${key} is derived (derive ${key} on line ${d.line}), so it changes only when what it's computed from changes.${item ? " To change items, loop over the list in state (each items=todos) and hide items with if=" : ""}`);
    return true;
  }

  private runPaint(): void {
    if (!this.rootBox) return;
    // Clear the flag first: painting can ask for another frame (a fade, a pulse),
    // and clearing it afterwards would drop that request and freeze the animation.
    this.dirty.paint = false;
    const t = now();
    const g = this.inspector.wrapContext(this.g);
    const dpr = this.canvas.width / Math.max(1, this.metrics.width);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.metrics.width, this.metrics.height);
    this.hits = [];
    const ctx = this.paintContext(g);
    this.paintBox(this.rootBox, ctx, 1);
    this.resolveFocus();
    if (this.focus && this.keyboardMode && !this.inspector.inspecting) this.paintFocusRing(g, this.focus.box);
    this.paintPopup(g, ctx);
    this.paintToast(g);
    this.inspector.paintOverlay(g, this.rootBox, this.hits);
    this.inspector.endCapture();
    this.metrics.paintMs = now() - t;
    this.events.emit("render", { ...this.metrics });
  }

  /**
   * Point focus at the hit region painted for it this frame (which may be a
   * part of an element, like one star of a rating). If nothing was painted
   * for it, because it was disabled or hidden, drop focus so the keyboard
   * can't activate it.
   */
  private resolveFocus(): void {
    if (!this.focus) return;
    const h = this.hits.find((r) => r.focusable && sameRegion(r, this.focus!));
    this.focus = h ? { node: h.box.node, box: h.box, detail: h.detail } : null;
  }

  private paintContext(g: CanvasRenderingContext2D): PaintContext {
    const theme = this.theme;
    const readers = new WeakMap<LoomNode, PropReader>();
    const scope = this.state.scope;
    const animate = this.opts.animate ?? !(typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const t = now();
    const same = (a: HitTarget | null, n: LoomNode, detail?: unknown) =>
      !!a && a.node.id === n.id && (detail === undefined || a.detail === detail);
    return {
      g,
      theme,
      scope,
      now: t,
      hover: this.hover,
      pointer: this.pointer,
      focus: this.focus,
      pressed: this.pressed,
      props: (node) => {
        let r = readers.get(node);
        if (!r) readers.set(node, (r = new PropReader(node, scopeOf(node, scope))));
        return r;
      },
      font: (w, s) => fontString(w, s, theme.font.family),
      roundRect: (x, y, w, h, r) => roundRectPath(g, x, y, w, h, r),
      addHit: (box, o = {}) => this.hits.push({ box, detail: o.detail, focusable: o.focusable ?? true }),
      isHovered: (n, d) => same(this.hover, n, d),
      isFocused: (n, d) => this.keyboardMode && same(this.focus, n, d),
      isPressed: (n, d) => same(this.pressed, n, d),
      isEditing: (n) => !!this.editing && this.editing.node.id === n.id,
      isPopupOpen: (n) => !!this.popup && this.popup.owner.node.id === n.id,
      motion: animate,
      appear: (n) => {
        if (!animate || n.id === "root") return 1;
        let first = this.seen.get(n.id);
        if (first === undefined) this.seen.set(n.id, (first = t));
        const a = Math.min(1, (t - first) / 240);
        if (a < 1) this.invalidate("paint");
        return a;
      },
      requestFrame: () => this.invalidate("paint"),
      image: (src) => this.images.get(src),
    };
  }

  private paintBox(box: Box, ctx: PaintContext, parentAlpha: number): void {
    const def = this.registry.get(box.node.type);
    const alpha = parentAlpha * ctx.appear(box.node);
    ctx.g.save();
    ctx.g.globalAlpha = alpha;
    def?.paint?.(box, ctx);
    ctx.g.restore();
    for (const k of box.children) this.paintBox(k, ctx, alpha);
    if (def?.paintOver) {
      ctx.g.save();
      ctx.g.globalAlpha = alpha;
      def.paintOver(box, ctx);
      ctx.g.restore();
    }
  }

  // ---------------------------------------------------------------- images

  private imagePolicy(): ImagePolicy {
    const hasLocation = typeof location !== "undefined" && /^https?:$/.test(location.protocol);
    const origin = hasLocation ? location.origin : "http://localhost";
    const base = typeof document !== "undefined" && document.baseURI ? document.baseURI : origin + "/";
    return { origin, base, hosts: this.opts.imageHosts ?? [] };
  }

  /** Resolves once every image requested so far has loaded or failed (then repaints). */
  async imagesLoaded(): Promise<void> {
    await this.images.settled();
    this.renderNow();
  }

  // ---------------------------------------------------------------- notifications

  /** Show a short message over the screen for a few seconds, replacing any current one. */
  notify(text: string): void {
    this.toast = { text, shownAt: now() };
    this.events.emit("notify", { text });
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    // Repaint once it has expired, so it disappears even without animation.
    this.toastTimer = setTimeout(() => { this.toastTimer = null; this.invalidate("paint"); }, TOAST_MS + 20);
    this.invalidate("paint");
  }

  /** The message currently shown, if any. */
  get notification(): string | null {
    return this.toast && now() - this.toast.shownAt < TOAST_MS ? this.toast.text : null;
  }

  private paintToast(g: CanvasRenderingContext2D): void {
    if (!this.toast) return;
    const age = now() - this.toast.shownAt;
    if (age >= TOAST_MS) { this.toast = null; return; }
    const animate = this.opts.animate ?? !(typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    let alpha = 1;
    if (animate) {
      alpha = Math.min(1, age / TOAST_FADE, (TOAST_MS - age) / TOAST_FADE);
      if (age < TOAST_FADE || age > TOAST_MS - TOAST_FADE) this.invalidate("paint");
    }
    const t = this.theme;
    const font = fontString(600, 14, t.font.family);
    const width = this.metrics.width;
    const maxW = Math.max(40, Math.min(420, width - 32));
    const lines = wrapText(this.toast.text, maxW - 32, font, this.measurer).slice(0, 3);
    g.font = font;
    const w = Math.min(maxW, Math.max(...lines.map((l) => g.measureText(l).width)) + 32);
    const lh = 20;
    const h = lines.length * lh + 20;
    const x = (width - w) / 2;
    const y = Math.max(8, this.visibleBottom() - h - 16);
    g.save();
    g.globalAlpha = alpha;
    roundRectPath(g, x, y, w, h, t.radius.md);
    g.fillStyle = t.colors.ink;
    g.fill();
    g.fillStyle = t.colors.surface;
    g.textAlign = "center";
    g.textBaseline = "middle";
    lines.forEach((l, i) => g.fillText(l, width / 2, y + 10 + lh * i + lh / 2 + 1, maxW - 24));
    g.restore();
  }

  /** The lowest point of the canvas the user can see, so a message isn't drawn off screen. */
  private visibleBottom(): number {
    const h = this.metrics.height;
    if (typeof window === "undefined" || !window.innerHeight) return h;
    const top = this.canvas.getBoundingClientRect().top;
    return Math.max(Math.min(h, 80), Math.min(h, window.innerHeight - top));
  }

  private paintFocusRing(g: CanvasRenderingContext2D, b: Box): void {
    g.save();
    g.strokeStyle = this.theme.colors.focus;
    g.lineWidth = 2;
    roundRectPath(g, b.x - 3, b.y - 3, b.w + 6, b.h + 6, this.theme.radius.md + 3);
    g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- input

  /** Find the interactive target at a point (CSS pixels relative to the canvas). */
  targetAt(x: number, y: number): HitTarget | null {
    // An open popup is on top: only its regions can be hit, and only inside it.
    if (this.popup) {
      const a = this.popup.area;
      if (!a || x < a.x || x > a.x + a.w || y < a.y || y > a.y + a.h) return null;
      for (let i = this.popupHits.length - 1; i >= 0; i--) {
        const h = this.popupHits[i]!;
        const b = h.box;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { node: b.node, box: b, detail: h.detail, layer: "popup" };
      }
      return null;
    }
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      const b = h.box;
      if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
      const def = this.registry.get(b.node.type);
      if (def?.hitTest) {
        const r = def.hitTest(b, x, y);
        if (!r) continue;
        return { node: b.node, box: b, detail: r.detail };
      }
      return { node: b.node, box: b, detail: h.detail };
    }
    return null;
  }

  private pressContext(target: HitTarget): PressContext {
    const readers = new WeakMap<LoomNode, PropReader>();
    return {
      target,
      scope: scopeOf(target.node, this.state.scope),
      props: (node) => {
        let r = readers.get(node);
        if (!r) readers.set(node, (r = new PropReader(node, scopeOf(node, this.state.scope))));
        return r;
      },
      set: (path, v) => this.writePath(target.node, path, v),
      run: (actions) => this.runActionString(actions, target.node),
      openPopup: (state) => this.openPopup(target, state),
      popupOpen: !!this.popup && this.popup.owner.node.id === target.node.id,
    };
  }

  // ---------------------------------------------------------------- popups

  /** The open popup, for tools and tests: its owner, where it is, its regions and transient state. */
  get openPopupInfo(): { owner: LoomNode; area: Rect | null; regions: readonly HitRegion[]; state: Readonly<PopupState> } | null {
    return this.popup && { owner: this.popup.owner.node, area: this.popup.area, regions: this.popupHits, state: this.popup.state };
  }

  private openPopup(owner: HitTarget, state: PopupState): void {
    if (!this.registry.get(owner.node.type)?.popup) return;
    this.endEdit();
    this.popup = { owner: { node: owner.node, box: owner.box }, state: { ...state }, area: null };
    this.popupHits = [];
    this.focus = { node: owner.node, box: owner.box };
    this.invalidate("layout");
  }

  /** Close the open popup, sending keyboard focus back to its owner when it's still shown. */
  closePopup(restoreFocus = true): void {
    const p = this.popup;
    if (!p) return;
    this.popup = null;
    this.popupHits = [];
    this.hover = null;
    if (restoreFocus) {
      const box = this.boxOf(p.owner.node);
      if (box) { this.focus = { node: box.node, box }; this.canvas.focus(); }
    }
    this.invalidate("layout");
  }

  /** What a popup's handlers get: its owner as the target, its state, and close. */
  private popupContext(target: HitTarget): PopupContext {
    const p = this.popup!;
    return { ...this.pressContext({ ...target, node: p.owner.node }), popup: p.state, area: p.area, close: (restore = true) => this.closePopup(restore) };
  }

  /** The visible part of the canvas, for placing popups. */
  private viewport(): Viewport {
    if (this.opts.viewport) return this.opts.viewport();
    if (typeof window === "undefined" || !window.innerHeight) return { top: 0, bottom: Infinity };
    const top = this.canvas.getBoundingClientRect().top;
    return { top: Math.max(0, -top), bottom: window.innerHeight - top };
  }

  /** After layout: place the open popup by its owner, or close it if the owner is gone. */
  private placeOpenPopup(ctx: LayoutContext, width: number): Rect | null {
    const p = this.popup;
    if (!p) return null;
    const box = this.boxOf(p.owner.node);
    const def = box && this.registry.get(box.node.type)?.popup;
    const size = box && def && this.isShown(box.node) ? def.measure(box, ctx, p.state) : null;
    if (!box || !size) {
      this.popup = null;
      this.popupHits = [];
      return null;
    }
    p.owner = { node: box.node, box };
    const placed = placePopup(box, size, this.viewport(), width);
    p.area = { x: placed.x, y: placed.y, w: placed.w, h: placed.h };
    return p.area;
  }

  /** Draw the open popup over everything, collecting its hit regions apart from the screen's. */
  private paintPopup(g: CanvasRenderingContext2D, ctx: PaintContext): void {
    const p = this.popup;
    const a = p?.area;
    const def = p && this.registry.get(p.owner.node.type)?.popup;
    if (!p || !a || !def) { this.popupHits = []; return; }
    const t = this.theme;
    const screenHits = this.hits;
    this.hits = [];
    g.save();
    // A soft edge under the panel, then the panel, then its content clipped to it.
    roundRectPath(g, a.x, a.y + 2, a.w, a.h, t.radius.md);
    g.globalAlpha = 0.12;
    g.fillStyle = t.colors.ink;
    g.fill();
    g.globalAlpha = 1;
    roundRectPath(g, a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1, t.radius.md);
    g.fillStyle = t.colors.surface;
    g.fill();
    g.strokeStyle = t.colors.line;
    g.lineWidth = 1;
    g.stroke();
    roundRectPath(g, a.x, a.y, a.w, a.h, t.radius.md);
    g.clip();
    def.paint(p.owner.box, a, ctx, p.state);
    g.restore();
    // Only regions inside the panel count.
    this.popupHits = this.hits.filter((h) => h.box.y + h.box.h > a.y && h.box.y < a.y + a.h);
    this.hits = screenHits;
  }

  /** Press a target as if clicked. */
  activate(target: HitTarget): void {
    const def = this.registry.get(target.node.type);
    if (target.layer === "popup") {
      if (this.popup && def?.popup) def.popup.press(this.popupContext(target));
      return;
    }
    if (def?.editor) { this.beginEdit(target); return; }
    if (def?.press) def.press(this.pressContext(target));
    // Draggable elements act through drag and key; Enter shouldn't fire their on=.
    else if (def?.drag) return;
    else if (target.node.props.on) this.runActionString(target.node.props.on, target.node);
  }

  /** Send a drag phase to the dragged element, using its region from the latest frame. */
  private dragTo(phase: DragContext["phase"], x: number, y: number): void {
    const t = this.dragging;
    if (!t) return;
    const region = this.hits.find((h) => sameRegion(h, t));
    const target = region ? { node: region.box.node, box: region.box, detail: region.detail } : t;
    this.dragging = phase === "end" ? null : target;
    const def = this.registry.get(target.node.type);
    def?.drag?.({ ...this.pressContext(target), x, y, phase });
    this.invalidate("paint");
  }

  /** Let the focused element handle a key. Returns true if it did. */
  private keyToFocus(key: string): boolean {
    if (!this.focus) return false;
    const def = this.registry.get(this.focus.node.type);
    return !!def?.key?.(this.pressContext(this.focus), key);
  }

  private resetState(): void {
    this.state.clear();
    this.seen.clear();
    this.history = [];
  }

  // ---------------------------------------------------------------- screens

  /** Names of the spec's screens, in order. */
  get screens(): string[] {
    return (this.parsed?.root.children ?? []).filter((n) => n.type === "screen").map((n) => n.props.name ?? "");
  }

  /** The visible screen's name, or undefined when the spec has no screens. */
  get currentScreen(): string | undefined {
    const v = this.state.get(SCREEN_KEY);
    return typeof v === "string" && this.screens.includes(v) ? v : undefined;
  }

  /** Show a screen by name, remembering the current one for back(). Unknown names are ignored. */
  go(screen: string): void {
    if (!this.screens.includes(screen)) return;
    const from = this.currentScreen;
    if (from === screen) return;
    if (from !== undefined) this.history.push(from);
    this.state.set(SCREEN_KEY, screen);
    this.events.emit("navigate", { screen, from });
  }

  /** Return to the previous screen. Does nothing on the first one. */
  back(): void {
    const from = this.currentScreen;
    let prev = this.history.pop();
    // Skip screens that are no longer in the spec.
    while (prev !== undefined && !this.screens.includes(prev)) prev = this.history.pop();
    if (prev === undefined) return;
    this.state.set(SCREEN_KEY, prev);
    this.events.emit("navigate", { screen: prev, from });
  }

  /** Whether back() has somewhere to go. */
  get canGoBack(): boolean {
    return this.history.some((s) => this.screens.includes(s));
  }

  /** Keep the `screen` state on a screen that exists: the first one, until the user moves. */
  private syncScreen(): void {
    const names = this.screens;
    if (!names.length) return;
    const v = this.state.get(SCREEN_KEY);
    if (typeof v !== "string" || !names.includes(v)) this.state.set(SCREEN_KEY, names[0]!);
  }

  private runActionString(src: string, node: LoomNode): void {
    const parsed = parseActions(src);
    if ("error" in parsed) return;
    runActions(parsed.actions, {
      // Inside each, actions read the item's loop variables first.
      scope: scopeOf(node, this.state.scope),
      set: (path, v) => this.writePath(node, path, v),
      removeAt: (path) => this.removeAt(node, path),
      warn: (m) => this.warn(m),
      emit: (name, value) => this.events.emit("action", { name, value, node }),
      go: (screen) => this.go(screen),
      back: () => this.back(),
      notify: (text) => this.notify(text),
    });
  }

  /**
   * Write a value at a path as seen from a node: a state name, or inside each
   * a path through the item (t.done), which rebuilds the list it lives in.
   */
  private writePath(node: LoomNode, path: string, value: Value): void {
    const place = placeOf(path, locateOf(node));
    if (!place) {
      this.warn(`Can't change ${path}: it isn't in state. Inside each, items= must name a list in state (like items=todos) for its items to change`);
      return;
    }
    if (this.derivedWrite(path, place.key)) return;
    if (!place.steps.length) { this.state.set(place.key, value); return; }
    const r = setIn(this.state.get(place.key), place.steps, value);
    if ("error" in r) this.warn(`Can't change ${path}: ${r.error}`);
    else this.state.set(place.key, r.value);
  }

  /** Remove the list item a path points at, like remove:t inside each as=t. */
  private removeAt(node: LoomNode, path: string): void {
    const place = placeOf(path, locateOf(node));
    const at = place?.steps.at(-1);
    if (!place || typeof at !== "number") {
      this.warn(`remove:${path} needs ${path} to be an item of a list in state, like remove:t inside each items=todos as=t. To remove by position, write remove:list:index`);
      return;
    }
    if (this.derivedWrite(`remove:${path}`, place.key)) return;
    const parent = place.steps.slice(0, -1);
    const root = this.state.get(place.key);
    const list = parent.length ? getIn(root, parent) : root;
    if (!isList(list)) return;
    const next = makeList(list.filter((_, i) => i !== at));
    if (!parent.length) { this.state.set(place.key, next); return; }
    const r = setIn(root, parent, next);
    if (!("error" in r)) this.state.set(place.key, r.value);
  }

  private focusables(): HitRegion[] {
    return this.hits.filter((h) => h.focusable);
  }

  /** After layout, point hover/focus at the new boxes for the same nodes. */
  private refreshTargets(): void {
    const find = (t: HitTarget | null): HitTarget | null => {
      if (!t || !this.rootBox) return null;
      let found: Box | null = null;
      const walk = (b: Box) => { if (found) return; if (b.node.id === t.node.id) found = b; else b.children.forEach(walk); };
      walk(this.rootBox);
      if (!found || !this.isShown((found as Box).node)) return null;
      return { node: (found as Box).node, box: found, detail: t.detail };
    };
    this.focus = find(this.focus);
    this.hover = this.pointer ? find(this.hover) : null;
    if (this.editing) {
      const t = find(this.editing);
      const spec = t && this.editorSpec(t.node);
      if (!t || !spec) this.endEdit();
      else { this.editing = t; this.editorHost.update(spec); }
    }
  }

  // ---------------------------------------------------------------- typing

  /** The laid-out box of a node, by id (copies inside each have their own). */
  private boxOf(node: LoomNode): Box | null {
    let found: Box | null = null;
    const walk = (b: Box) => { if (found) return; if (b.node.id === node.id) found = b; else b.children.forEach(walk); };
    if (this.rootBox) walk(this.rootBox);
    return found;
  }

  /** How the text box for a field should look, or null if it can't be typed in right now. */
  private editorSpec(node: LoomNode): EditorSpec | null {
    const def = this.registry.get(node.type);
    const box = this.boxOf(node);
    if (!def?.editor || !box || !node.props.bind) return null;
    const p = new PropReader(node, scopeOf(node, this.state.scope));
    if (p.cond("disabled")) return null;
    const spec = def.editor(box, p, this.theme);
    // Keep what the person typed while the stored value is still what it wrote.
    if (this.typed && p.bound() === this.typed.value) spec.value = this.typed.text;
    return spec;
  }

  /** Start typing in a field: place the text box over it and focus it, during the press itself. */
  beginEdit(target: HitTarget): void {
    if (this.editing && this.editing.node.id === target.node.id) return;
    this.endEdit();
    const spec = this.editorSpec(target.node);
    if (!spec) return;
    this.editing = target;
    this.focus = target;
    this.typed = null;
    const node = () => this.editing?.node ?? target.node;
    this.editorHost.open(spec, {
      input: (text) => this.typeInto(node(), text),
      key: (key, shift) => this.editorKey(node(), key, shift),
      blur: () => this.endEdit(),
    });
    this.invalidate("paint");
  }

  /** Stop typing; the canvas draws the field's value again. */
  endEdit(): void {
    if (!this.editing) return;
    this.editing = null;
    this.typed = null;
    this.editorHost.close();
    this.invalidate("paint");
  }

  /** Write what was typed to the field's bind=. */
  private typeInto(node: LoomNode, text: string): void {
    const bind = node.props.bind;
    const spec = this.editorSpec(node);
    if (!bind || !spec) return;
    text = text.slice(0, spec.max);
    let value: Value = text;
    if (spec.kind === "number") {
      const t = text.trim();
      if (t === "") value = null;
      else if (isFinite(Number(t))) value = Number(t);
      else return; // "-" or "1e" on the way to a number: wait for more
    }
    this.typed = { text, value };
    this.writePath(node, bind, value);
  }

  /** Enter runs on=, Tab moves to the next element, Escape stops typing. */
  private editorKey(node: LoomNode, key: string, shift: boolean): boolean {
    if (key === "Enter") {
      if (node.props.on) this.runActionString(node.props.on, node);
      return true;
    }
    if (key === "Escape") {
      this.endEdit();
      this.keyboardMode = true;
      this.canvas.focus();
      return true;
    }
    if (key === "Tab") return this.tabFrom(shift);
    return false;
  }

  /**
   * Move keyboard focus to the next (or previous) interactive element,
   * starting to type when it's a field. Returns false when focus should
   * leave the canvas, so the browser can move it on.
   */
  private tabFrom(back: boolean): boolean {
    const list = this.focusables();
    if (!list.length) return false;
    const idx = this.focus ? list.findIndex((h) => sameRegion(h, this.focus!)) : -1;
    const next = idx < 0 ? (back ? list.length - 1 : 0) : idx + (back ? -1 : 1);
    if (next < 0 || next >= list.length) {
      this.focus = null;
      this.invalidate("paint");
      return false;
    }
    const h = list[next]!;
    const target = { node: h.box.node, box: h.box, detail: h.detail };
    this.keyboardMode = true;
    if (this.registry.get(target.node.type)?.editor) this.beginEdit(target);
    else {
      this.endEdit();
      this.focus = target;
      this.canvas.focus();
    }
    this.invalidate("paint");
    return true;
  }

  private isShown(node: LoomNode): boolean {
    return isVisible(node, this.state.scope, this.registry);
  }

  private bindInput(): void {
    const c = this.canvas;
    const local = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const sameTarget = (a: HitTarget | null, b: HitTarget | null) =>
      a === b || (!!a && !!b && a.node.id === b.node.id && a.detail === b.detail);

    const onMove = (e: PointerEvent) => {
      this.pointer = local(e);
      if (this.dragging) { c.style.cursor = "grabbing"; this.dragTo("move", this.pointer.x, this.pointer.y); return; }
      if (this.inspector.inspecting) { this.inspector.pointerMove(this.pointer.x, this.pointer.y); return; }
      const t = this.targetAt(this.pointer.x, this.pointer.y);
      const def = t ? this.registry.get(t.node.type) : undefined;
      c.style.cursor = t ? def?.cursor?.(t) ?? "pointer" : "default";
      if (!sameTarget(t, this.hover)) { this.hover = t; this.invalidate("paint"); }
      else if (t?.detail !== undefined) this.invalidate("paint");
    };
    const onLeave = () => {
      if (this.dragging) return; // the pointer is captured; the drag ends on release
      this.pointer = null;
      if (this.hover || this.pressed) { this.hover = null; this.pressed = null; this.invalidate("paint"); }
      this.inspector.pointerLeave();
    };
    // Set while a press is focusing the canvas, so onFocus can tell a click from Tab.
    let pressing = false;
    const onDown = (e: PointerEvent) => {
      this.keyboardMode = false;
      pressing = true;
      setTimeout(() => { pressing = false; }, 0);
      const p = local(e);
      if (this.inspector.inspecting) return;
      if (this.popup) {
        const a = this.popup.area;
        if (!a || p.x < a.x || p.x > a.x + a.w || p.y < a.y || p.y > a.y + a.h) {
          // A press outside closes it and stops there: nothing underneath is pressed.
          this.swallowRelease = true;
          this.pressed = null;
          this.closePopup(true);
          return;
        }
      }
      this.pressed = this.targetAt(p.x, p.y);
      // Pressing inside a popup leaves keyboard focus on its owner.
      if (this.pressed?.layer === "popup") { this.invalidate("paint"); return; }
      if (this.pressed) { this.focus = this.pressed; this.invalidate("paint"); }
      if (this.pressed && this.registry.get(this.pressed.node.type)?.drag) {
        // Keep receiving moves when the pointer leaves the canvas mid-drag.
        try { c.setPointerCapture?.(e.pointerId); } catch { /* not capturable; moves outside are missed */ }
        this.dragging = this.pressed;
        this.dragTo("start", p.x, p.y);
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (this.swallowRelease) { this.swallowRelease = false; this.pressed = null; this.invalidate("paint"); return; }
      if (this.dragging) {
        this.pressed = null;
        this.dragTo("end", p.x, p.y);
        c.style.cursor = "default";
        return;
      }
      if (this.inspector.inspecting) { this.inspector.select(p.x, p.y); return; }
      const t = this.targetAt(p.x, p.y);
      const was = this.pressed;
      this.pressed = null;
      if (t && sameTarget(t, was)) this.activate(t);
      this.invalidate("paint");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.inspector.inspecting) { this.inspector.setInspecting(false); return; }
      // An open popup takes every key. Escape closes it; Tab closes it and moves on as usual.
      if (this.popup) {
        this.keyboardMode = true;
        if (e.key === "Tab") this.closePopup(true);
        else {
          e.preventDefault();
          if (e.key === "Escape") this.closePopup(true);
          else this.registry.get(this.popup.owner.node.type)?.popup?.key(this.popupContext(this.popup.owner), e.key);
          this.invalidate("paint");
          return;
        }
      }
      if (e.key === "Tab") {
        // Past the last element, let the browser move focus out of the canvas.
        if (this.tabFrom(e.shiftKey)) e.preventDefault();
        return;
      }
      if (this.focus && this.keyToFocus(e.key)) {
        e.preventDefault();
        this.keyboardMode = true;
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && this.focus) {
        e.preventDefault();
        this.keyboardMode = true;
        this.activate(this.focus);
      }
    };
    const onFocus = () => {
      if (!this.focus) {
        const first = this.focusables()[0];
        if (first) this.focus = { node: first.box.node, box: first.box, detail: first.detail };
      }
      // Tabbing onto the canvas when its first element is a field: start typing there.
      if (!pressing && !this.editing && this.focus && this.registry.get(this.focus.node.type)?.editor) {
        this.keyboardMode = true;
        this.beginEdit(this.focus);
      }
      this.invalidate("paint");
    };
    const onBlur = () => {
      this.keyboardMode = false;
      // Focus went elsewhere on the page (or another window): an open list goes with it.
      this.closePopup(false);
      this.invalidate("paint");
    };
    // The browser took over the gesture (a scroll, say): finish the drag where it was.
    const onCancel = () => {
      this.pressed = null;
      if (this.dragging) this.dragTo("end", this.pointer?.x ?? 0, this.pointer?.y ?? 0);
    };

    const onWheel = (e: WheelEvent) => {
      const p = this.popup;
      const a = p?.area;
      const at = local(e);
      if (!p || !a || at.x < a.x || at.x > a.x + a.w || at.y < a.y || at.y > a.y + a.h) return;
      e.preventDefault();
      this.registry.get(p.owner.node.type)?.popup?.wheel?.(this.popupContext(p.owner), e.deltaY);
      this.invalidate("paint");
    };
    c.addEventListener("wheel", onWheel as EventListener, { passive: false });
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerleave", onLeave);
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onCancel);
    c.addEventListener("keydown", onKey);
    c.addEventListener("focus", onFocus);
    c.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      c.removeEventListener("wheel", onWheel as EventListener);
      c.removeEventListener("pointermove", onMove);
      c.removeEventListener("pointerleave", onLeave);
      c.removeEventListener("pointerdown", onDown);
      c.removeEventListener("pointerup", onUp);
      c.removeEventListener("pointercancel", onCancel);
      c.removeEventListener("keydown", onKey);
      c.removeEventListener("focus", onFocus);
      c.removeEventListener("blur", onBlur);
    });
  }

  private bindEnvironment(): void {
    if (typeof window === "undefined") return;
    // A message sits at the bottom of the visible area, which moves when the page scrolls.
    // A press anywhere on the page outside the canvas closes an open popup too.
    const onPagePress = (e: Event) => { if (this.popup && e.target !== this.canvas) this.closePopup(false); };
    document.addEventListener("pointerdown", onPagePress, true);
    this.cleanup.push(() => document.removeEventListener("pointerdown", onPagePress, true));
    const onScroll = () => {
      if (this.toast) this.invalidate("paint");
      // An open popup is placed in the visible part of the canvas, which scrolling moves.
      if (this.popup) this.invalidate("layout");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    this.cleanup.push(() => window.removeEventListener("scroll", onScroll));
    if (this.opts.width === undefined && this.canvas.parentElement && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        const w = this.canvas.parentElement?.clientWidth || 0;
        if (w && w !== this.width) this.invalidate("layout");
      });
      ro.observe(this.canvas.parentElement);
      this.cleanup.push(() => ro.disconnect());
    }
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { if ((this.opts.theme ?? "auto") === "auto") { this.theme = this.resolveTheme(); this.invalidate("layout"); } };
    mq.addEventListener("change", onScheme);
    const mo = new MutationObserver(onScheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    this.cleanup.push(() => { mq.removeEventListener("change", onScheme); mo.disconnect(); });
    if (document.fonts) {
      const onFonts = () => { this.measurer.invalidate(); this.invalidate("layout"); };
      document.fonts.addEventListener("loadingdone", onFonts);
      document.fonts.ready.then(onFonts).catch(() => {});
      this.cleanup.push(() => document.fonts.removeEventListener("loadingdone", onFonts));
    }
  }

  private resolveTheme(): Theme {
    const t = this.opts.theme ?? "auto";
    if (t !== "auto") return t;
    if (typeof window === "undefined") return lightTheme;
    const root = document.documentElement;
    const explicit = root.getAttribute("data-theme");
    const dark = explicit ? explicit === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    return themeFromCSS(this.canvas, dark ? darkTheme : lightTheme);
  }

  /** Make this instance available in the browser console as window[name]. */
  expose(name = "loom"): this {
    if (typeof window !== "undefined") (window as unknown as Record<string, unknown>)[name] = this;
    return this;
  }

  destroy(): void {
    this.endEdit();
    this.popup = null;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    if (this.frame && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.frame);
    this.cleanup.forEach((f) => f());
    this.events.clear();
  }

  /** Find nodes by type (handy in the console: loom.find("button")). */
  find(type: string): LoomNode[] {
    const out: LoomNode[] = [];
    const walk = (n: LoomNode) => { if (n.type === type) out.push(n); n.children.forEach(walk); };
    if (this.parsed) walk(this.parsed.root);
    return out;
  }
}

/** Whether a hit region is the one a target refers to (same element, same part). */
function sameRegion(h: HitRegion, t: HitTarget): boolean {
  return h.box.node.id === t.node.id && h.detail === t.detail;
}

/** How long a notify: message stays up, and how long it takes to fade in or out. */
const TOAST_MS = 3000;
const TOAST_FADE = 180;

/** The state name that holds the visible screen. */
export const SCREEN_KEY = "screen";

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
