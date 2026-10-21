/**
 * The component contract. Everything the engine knows about an element
 * (how it is described to models, how it measures, paints and responds)
 * lives in one ComponentDef, so adding a component never touches the engine.
 */
import { evaluate, interpolate, type Scope } from "./expr";
import { literal } from "./actions";
import type { Theme } from "./theme";
import type { TextMeasurer } from "./text";
import type { Box, HitTarget, LoomNode, Value } from "./types";

/** `name` is a plain identifier (letters, digits, _), like a screen name that go: refers to. */
export type PropType = "number" | "string" | "boolean" | "enum" | "condition" | "action" | "state" | "name";

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
  /** Children whose `if` condition currently passes. */
  visibleChildren(node: LoomNode): LoomNode[];
  /** Move a box and its whole subtree. */
  shift(box: Box, dx: number, dy: number): void;
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
  /** False when animation is off (option or reduced motion): draw a still frame. */
  motion: boolean;
  /** Fade-in opacity for a node that just appeared (0..1). */
  appear(node: LoomNode): number;
  /** Ask for another frame (for animation). */
  requestFrame(): void;
}

export interface PressContext {
  target: HitTarget;
  scope: Scope;
  props(node: LoomNode): PropReader;
  set(key: string, value: Value): void;
  /** Run an action string such as "inc:count;emit:saved". */
  run(actions: string): void;
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
   * Whether an element is shown, beyond its `if=` prop. Hidden elements aren't
   * laid out or painted (only the active screen is, for example).
   */
  visible?(node: LoomNode, scope: Scope): boolean;
  /** Keyboard activation; default is the same as press. */
  cursor?(target: HitTarget): string;
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
    const m = /^\{(.*)\}$/s.exec(raw);
    if (m) {
      const r = evaluate(m[1]!, this.scope);
      return r.ok ? r.value : undefined;
    }
    return literal(raw);
  }

  num(name: string, fallback: number): number {
    const v = this.value(name);
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return isFinite(n) ? n : fallback;
  }

  str(name: string, fallback = ""): string {
    const raw = this.node.props[name];
    if (raw === undefined) return fallback;
    if (/^\{.*\}$/s.test(raw)) {
      const v = this.value(name);
      return v === undefined || v === null ? fallback : String(v);
    }
    return interpolate(raw, this.scope);
  }

  bool(name: string, fallback = false): boolean {
    const v = this.value(name);
    return v === undefined ? fallback : !!v;
  }

  /** Read a condition prop (`disabled=done` or `disabled={count>3}`) as a boolean. */
  cond(name: string, fallback = false): boolean {
    const raw = this.node.props[name];
    if (raw === undefined) return fallback;
    const r = evaluate(raw.replace(/^\{([\s\S]*)\}$/, "$1"), this.scope);
    return r.ok ? !!r.value : fallback;
  }

  oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
    const v = this.str(name, fallback);
    return (values as readonly string[]).includes(v) ? (v as T) : fallback;
  }

  /** The positional text, with `{expressions}` filled in. */
  text(fallback = ""): string {
    return this.node.text === undefined ? fallback : interpolate(this.node.text, this.scope);
  }
}
