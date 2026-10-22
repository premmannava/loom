/**
 * The component contract. Everything the engine knows about an element
 * (how it is described to models, how it measures, paints and responds)
 * lives in one ComponentDef, so adding a component never touches the engine.
 */
import { toNumber } from "./data";
import { bareExpression, evaluate, formatValue, interpolate, wholeExpression, type Scope } from "./expr";
import { literal } from "./actions";
import type { EditorSpec } from "./editor";
import type { ImageState } from "./images";
import type { Theme } from "./theme";
import type { TextMeasurer } from "./text";
import type { PopupSize, PopupState } from "./popup";
import type { Box, HitTarget, LoomNode, Rect, Value } from "./types";

/**
 * `name` is a plain identifier (letters, digits, _), like a screen name that go: refers to.
 * `condition` and `expression` are read as an expression even without braces (`if=done`, `items=todos`).
 */
export type PropType = "number" | "string" | "boolean" | "enum" | "condition" | "expression" | "action" | "state" | "name";

export interface PropDef {
  type: PropType;
  description: string;
  values?: readonly string[];
  default?: Value;
  required?: boolean;
}

export type Category = "layout" | "content" | "data" | "input" | "navigation" | "feedback";

/** Categories in the order docs list them. */
export const CATEGORIES: readonly Category[] = ["layout", "content", "data", "input", "navigation", "feedback"];

export interface LayoutContext {
  theme: Theme;
  measure: TextMeasurer;
  scope: Scope;
  props(node: LoomNode): PropReader;
  /** Lay out a child at a position with an available width; returns its box. */
  layout(node: LoomNode, x: number, y: number, width: number): Box;
  /** Children to lay out: those whose `if` passes, with every `each` replaced by its copies. */
  visibleChildren(node: LoomNode): LoomNode[];
  /** Move a box and its whole subtree. */
  shift(box: Box, dx: number, dy: number): void;
  /**
   * Report a problem in the data a model can fix (not a list, a missing
   * field). The engine shows each message once per spec, not every frame.
   */
  warn?(message: string): void;
}

export interface PaintContext {
  g: CanvasRenderingContext2D;
  theme: Theme;
  scope: Scope;
  now: number;
  props(node: LoomNode): PropReader;
  font(weight: number | string, size: number): string;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  /**
   * Register a region the pointer and keyboard can target. To make a part of
   * an element pressable on its own (a star, a page number), pass a box
   * covering just that part, with the element's node, and a `detail` naming it.
   * Each part is then a separate Tab stop, and press() sees the detail.
   */
  addHit(box: Box, opts?: { detail?: unknown; focusable?: boolean }): void;
  hover: HitTarget | null;
  /** Pointer position in canvas CSS pixels, or null when outside. */
  pointer: { x: number; y: number } | null;
  focus: HitTarget | null;
  pressed: HitTarget | null;
  /** Pass `detail` to ask about one part of an element (the one given to addHit). */
  isHovered(node: LoomNode, detail?: unknown): boolean;
  /** True only while the keyboard is in use, when a focus style should show. */
  isFocused(node: LoomNode, detail?: unknown): boolean;
  isPressed(node: LoomNode, detail?: unknown): boolean;
  /** Whether a real text box is over this element right now; it then draws the text, so don't. */
  isEditing(node: LoomNode): boolean;
  /** Whether this element's popup is open (to draw it as open). */
  isPopupOpen(node: LoomNode): boolean;
  /** False when animation is off (option or reduced motion): draw a still frame. */
  motion: boolean;
  /** Fade-in opacity for a node that just appeared (0..1). */
  appear(node: LoomNode): number;
  /** Ask for another frame (for animation). */
  requestFrame(): void;
  /**
   * An image by its spec src: loading, ready (with the image), error, or
   * blocked by the image policy. The engine repaints when a load settles.
   */
  image(src: string): ImageState;
}

export interface PressContext {
  target: HitTarget;
  scope: Scope;
  props(node: LoomNode): PropReader;
  /**
   * Write a value to a state name or path, as seen from the pressed element:
   * pass its bind= as written (count, or t.done inside each).
   */
  set(path: string, value: Value): void;
  /** Run an action string such as "inc:count;emit:saved". */
  run(actions: string): void;
  /** Open this element's popup (its ComponentDef.popup), with its starting transient state. */
  openPopup(state: PopupState): void;
  /** Whether this element's popup is open. */
  popupOpen: boolean;
}

/** Pressing or typing in an open popup. ctx.target.node is the popup's owner. */
export interface PopupContext extends PressContext {
  /** The popup's transient state (highlight, scroll): change it freely. Never app state. */
  popup: PopupState;
  /** Where the popup is drawn now, or null before it's first placed. */
  area: Rect | null;
  /** Close the popup; keyboard focus goes back to its owner unless restoreFocus is false. */
  close(restoreFocus?: boolean): void;
}

/** A panel an element opens above the rest of the screen; see src/popup.ts. */
export interface PopupDef {
  /** The size it wants, from the owner's box. null closes it (nothing to show any more). */
  measure(owner: Box, ctx: LayoutContext, state: PopupState): PopupSize | null;
  /** Draw inside area (already clipped, on a surface panel), registering hit regions with ctx.addHit. */
  paint(owner: Box, area: Rect, ctx: PaintContext, state: PopupState): void;
  /** One of its hit regions was pressed (ctx.target.detail says which). */
  press(ctx: PopupContext): void;
  /** A key while it's open, other than Escape and Tab (which close it). Return true if handled. */
  key(ctx: PopupContext, key: string): boolean;
  /** The wheel turned over it, by dy pixels. */
  wheel?(ctx: PopupContext, dy: number): void;
}

export interface DragContext extends PressContext {
  /** Pointer position in canvas CSS pixels. */
  x: number;
  y: number;
  /** start on press, move while held, end on release (or when the browser cancels). */
  phase: "start" | "move" | "end";
}

export interface ComponentDef {
  type: string;
  category: Category;
  /** One or two sentences. Shown in docs and in the model prompt. */
  description: string;
  /** The positional quoted text, if this component takes one. */
  text?: { description: string; required?: boolean };
  props: Record<string, PropDef>;
  /** Which child types are allowed. Omit for leaf components. */
  children?: "any" | readonly string[];
  /** Restrict where this component may appear. */
  parents?: readonly string[];
  /** A short spec snippet for docs and the model prompt. */
  example?: string;

  /** Set box.h (and box.children for containers). box.x/y/w are given. */
  layout(box: Box, ctx: LayoutContext): void;
  /** Paint before children. */
  paint?(box: Box, ctx: PaintContext): void;
  /** Paint after children (overlays, pins on a map...). */
  paintOver?(box: Box, ctx: PaintContext): void;
  /** Refine a hit inside a registered region. Return null to fall through. */
  hitTest?(box: Box, x: number, y: number): { detail?: unknown } | null;
  /** Default: run the `on` prop. */
  press?(ctx: PressContext): void;
  /**
   * Follow the pointer while it's held down on this element (a slider's
   * thumb). An element with drag isn't pressed on release: drag gets an end
   * phase instead.
   */
  drag?(ctx: DragContext): void;
  /**
   * A key pressed while this element has focus, other than Tab. Return true
   * if it was handled. Enter and Space still press the element when not handled.
   */
  key?(ctx: PressContext, key: string): boolean;
  /**
   * Whether an element is shown, beyond its `if=` prop. Hidden elements aren't
   * laid out or painted (only the active screen is, for example).
   */
  visible?(node: LoomNode, scope: Scope): boolean;
  /** Keyboard activation; default is the same as press. */
  cursor?(target: HitTarget): string;
  /**
   * For elements people type into: where the text sits and how it looks.
   * Pressing or tabbing to the element then places a real text box over it
   * (see src/editor.ts), and each change is written to its bind=.
   */
  editor?(box: Box, props: PropReader, theme: Theme): EditorSpec;
  /** A panel this element opens over the screen, like a select's options. Open it with ctx.openPopup in press or key. */
  popup?: PopupDef;
}

/** Props every component accepts. */
export const COMMON_PROPS: Record<string, PropDef> = {
  if: { type: "condition", description: "Show only when this expression is true, e.g. if=done or if={count>0}." },
};

/**
 * Reads a node's raw prop strings as typed values, evaluating `{expressions}`
 * and interpolating text against current state.
 */
export class PropReader {
  constructor(private node: LoomNode, private scope: Scope) {}

  has(name: string): boolean {
    return name in this.node.props;
  }

  raw(name: string): string | undefined {
    return this.node.props[name];
  }

  value(name: string): Value | undefined {
    const raw = this.node.props[name];
    if (raw === undefined) return undefined;
    const whole = wholeExpression(raw);
    if (whole !== null) {
      const r = evaluate(whole, this.scope);
      return r.ok ? r.value : undefined;
    }
    // Text with {expressions} in it, like value="{done} of {total}".
    return raw.includes("{") ? interpolate(raw, this.scope) : literal(raw);
  }

  num(name: string, fallback: number): number {
    const v = this.value(name);
    const n = typeof v === "number" || typeof v === "string" ? toNumber(v) : NaN;
    return isFinite(n) ? n : fallback;
  }

  str(name: string, fallback = ""): string {
    const raw = this.node.props[name];
    if (raw === undefined) return fallback;
    if (wholeExpression(raw) !== null) {
      const v = this.value(name);
      return v === undefined || v === null ? fallback : formatValue(v);
    }
    return interpolate(raw, this.scope);
  }

  bool(name: string, fallback = false): boolean {
    const v = this.value(name);
    return v === undefined ? fallback : !!v;
  }

  /**
   * Read an expression prop, with or without braces (`items=sales` or
   * `items={filter(sales, 'open')}`), as each does. Undefined when missing or
   * when it can't be evaluated.
   */
  expr(name: string): Value | undefined {
    const raw = this.node.props[name];
    if (raw === undefined) return undefined;
    const r = evaluate(bareExpression(raw), this.scope);
    return r.ok ? r.value : undefined;
  }

  /** Read a condition prop (`disabled=done` or `disabled={count>3}`) as a boolean. */
  cond(name: string, fallback = false): boolean {
    const raw = this.node.props[name];
    if (raw === undefined) return fallback;
    const r = evaluate(bareExpression(raw), this.scope);
    return r.ok ? !!r.value : fallback;
  }

  oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
    const v = this.str(name, fallback);
    return (values as readonly string[]).includes(v) ? (v as T) : fallback;
  }

  /**
   * The current value of a state name or path prop such as bind= (count, or
   * t.done inside each), or undefined when it isn't set.
   */
  bound(name = "bind"): Value | undefined {
    const raw = this.node.props[name];
    if (raw === undefined) return undefined;
    const r = evaluate(raw, this.scope);
    return r.ok ? r.value : undefined;
  }

  /** The positional text, with `{expressions}` filled in. */
  text(fallback = ""): string {
    return this.node.text === undefined ? fallback : interpolate(this.node.text, this.scope);
  }
}
