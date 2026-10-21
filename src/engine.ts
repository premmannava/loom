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
import { PropReader, type ComponentDef, type DragContext, type PaintContext, type PressContext } from "./component";
import { Emitter } from "./emitter";
import { createLayoutContext, isVisible } from "./layout";
import { parse, type ParseResult } from "./parser";
import { Registry } from "./registry";
import { Store } from "./state";
import { CanvasMeasurer, font as fontString, wrapText } from "./text";
import { darkTheme, lightTheme, themeFromCSS, type Theme } from "./theme";
import { Inspector } from "./inspector";
import { browserImageLoader, ImageCache, type ImageLoader, type ImagePolicy } from "./images";
import type { Box, Diagnostic, HitRegion, HitTarget, LoomNode, Value } from "./types";

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
    const warn = opts.onWarning ?? ((m: string) => { if (typeof console !== "undefined") console.warn(`Loom: ${m}`); });
    this.images = new ImageCache(() => this.imagePolicy(), opts.loadImage ?? browserImageLoader, () => this.invalidate("paint"), now, warn);

    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    // Vertical swipes scroll the page and pinches zoom; horizontal drags reach
    // the canvas (sliders). Also removes the tap delay, like "manipulation".
    canvas.style.touchAction = "pan-y pinch-zoom";
    if (!canvas.getAttribute("aria-label")) canvas.setAttribute("aria-label", "Generated interface");

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
    });
    for (const { key, value } of this.parsed.state) this.state.declare(key, value);
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
    const ctx = createLayoutContext(this.registry, this.theme, this.measurer, this.state.scope);
    this.rootBox = ctx.layout(this.parsed.root, 0, 0, width);
    const height = Math.max(this.rootBox.h, this.opts.minHeight ?? 0);
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
        if (!r) readers.set(node, (r = new PropReader(node, scope)));
        return r;
      },
      font: (w, s) => fontString(w, s, theme.font.family),
      roundRect: (x, y, w, h, r) => roundRectPath(g, x, y, w, h, r),
      addHit: (box, o = {}) => this.hits.push({ box, detail: o.detail, focusable: o.focusable ?? true }),
      isHovered: (n, d) => same(this.hover, n, d),
      isFocused: (n, d) => this.keyboardMode && same(this.focus, n, d),
      isPressed: (n, d) => same(this.pressed, n, d),
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
      scope: this.state.scope,
      props: (node) => {
        let r = readers.get(node);
        if (!r) readers.set(node, (r = new PropReader(node, this.state.scope)));
        return r;
      },
      set: (k, v) => this.state.set(k, v),
      run: (actions) => this.runActionString(actions, target.node),
    };
  }

  /** Press a target as if clicked. */
  activate(target: HitTarget): void {
    const def = this.registry.get(target.node.type);
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
      scope: this.state.scope,
      set: (k, v) => this.state.set(k, v),
      emit: (name, value) => this.events.emit("action", { name, value, node }),
      go: (screen) => this.go(screen),
      back: () => this.back(),
      notify: (text) => this.notify(text),
    });
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
      if (!found || !this.isShown(t.node)) return null;
      return { node: (found as Box).node, box: found, detail: t.detail };
    };
    this.focus = find(this.focus);
    this.hover = this.pointer ? find(this.hover) : null;
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
    const onDown = (e: PointerEvent) => {
      this.keyboardMode = false;
      const p = local(e);
      if (this.inspector.inspecting) return;
      this.pressed = this.targetAt(p.x, p.y);
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
      if (e.key === "Tab") {
        const list = this.focusables();
        if (!list.length) return;
        const idx = this.focus ? list.findIndex((h) => sameRegion(h, this.focus!)) : -1;
        const next = idx < 0 ? (e.shiftKey ? list.length - 1 : 0) : idx + (e.shiftKey ? -1 : 1);
        if (next < 0 || next >= list.length) {
          // Let the browser move focus out of the canvas.
          this.focus = null;
          this.invalidate("paint");
          return;
        }
        e.preventDefault();
        const h = list[next]!;
        this.focus = { node: h.box.node, box: h.box, detail: h.detail };
        this.keyboardMode = true;
        this.invalidate("paint");
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
      this.invalidate("paint");
    };
    const onBlur = () => { this.keyboardMode = false; this.invalidate("paint"); };
    // The browser took over the gesture (a scroll, say): finish the drag where it was.
    const onCancel = () => {
      this.pressed = null;
      if (this.dragging) this.dragTo("end", this.pointer?.x ?? 0, this.pointer?.y ?? 0);
    };

    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerleave", onLeave);
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onCancel);
    c.addEventListener("keydown", onKey);
    c.addEventListener("focus", onFocus);
    c.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
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
    const onScroll = () => { if (this.toast) this.invalidate("paint"); };
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
