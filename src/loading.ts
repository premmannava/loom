/**
 * Data that is on its way. A host that fills state itself (a chat app loading
 * a database query's rows, say) names what it's still fetching, and elements
 * that read it draw a placeholder shaped like themselves instead of "No data".
 * When the data arrives they draw in (bars grow, lines run, rows appear), and
 * reveal() says how far along that is.
 *
 * "Awaiting" covers the time before the host even knows the names: while a
 * spec streams in, any name an element reads that has no value yet is treated
 * as loading, so a chart whose rows come later never flashes an empty state.
 *
 * Names reach elements through derive lines too: derive top={take(sales, 5)}
 * is loading while sales is.
 */
import type { DerivedDef } from "./parser";
import { identifiers, splitTemplate, wholeExpression, type Scope } from "./expr";
import type { Registry } from "./registry";
import type { SayShapeNode } from "./types";

/** How long the draw-in takes once data arrives. */
export const REVEAL_MS = 700;

/** Names the engine fills in itself: never loading. */
const ENGINE_NAMES = new Set(["screen"]);

export interface LoadingView {
  /** Whether this element reads data that hasn't arrived. */
  isLoading(node: SayShapeNode, scope: Scope): boolean;
  /** Whether a state or derived name is still loading (or may be, while awaiting). */
  waitsFor(name: string): boolean;
  /** 0..1, how far the element has drawn in since its data arrived; 1 when nothing is animating. */
  reveal(node: SayShapeNode, now: number): number;
}

const IDLE: LoadingView = { waitsFor: () => false, isLoading: () => false, reveal: () => 1 };

export class Loading {
  private names = new Set<string>();
  private awaiting = false;
  /** When each name stopped loading, for the draw-in. */
  private arrived = new Map<string, number>();
  private reads = new WeakMap<SayShapeNode, string[]>();

  constructor(private registry: Registry) {}

  get loadingNames(): readonly string[] {
    return [...this.names];
  }

  get isAwaiting(): boolean {
    return this.awaiting;
  }

  /** Replace the names still loading. Names that drop out start drawing in. Returns whether anything changed. */
  set(names: Iterable<string>, now: number): boolean {
    // Draw-ins long finished are forgotten, so an idle engine skips this work entirely.
    for (const [n, at] of this.arrived) if (now - at > REVEAL_MS) this.arrived.delete(n);
    const next = new Set(names);
    let changed = next.size !== this.names.size;
    for (const n of this.names) {
      if (!next.has(n)) { this.arrived.set(n, now); changed = true; }
    }
    for (const n of next) if (!this.names.has(n)) { this.arrived.delete(n); changed = true; }
    this.names = next;
    return changed;
  }

  setAwaiting(on: boolean): boolean {
    const changed = on !== this.awaiting;
    this.awaiting = on;
    return changed;
  }

  /** Forget every name and draw-in, for a new spec. */
  clear(): void {
    this.names.clear();
    this.arrived.clear();
    this.awaiting = false;
  }

  /** The names an element's text and props read. */
  readsOf(node: SayShapeNode): string[] {
    let out = this.reads.get(node);
    if (out) return out;
    const def = this.registry.get(node.type);
    const names = new Set<string>();
    const add = (src: string) => { for (const n of identifiers(src)) names.add(n); };
    const template = (s: string) => { for (const part of splitTemplate(s)) if ("expr" in part) add(part.expr); };
    if (node.text) template(node.text);
    for (const [prop, raw] of Object.entries(node.props)) {
      const type = def?.props?.[prop]?.type;
      const whole = wholeExpression(raw);
      // items=sales and if=done are expressions without braces; label="Days" is plain text.
      if (whole !== null) add(whole);
      else if (type === "expression" || type === "condition" || prop === "if") add(raw);
      else if (type !== "action") template(raw);
    }
    out = [...names];
    this.reads.set(node, out);
    return out;
  }

  /** A view for one layout or paint pass: works out which derived names depend on loading ones. */
  view(derived: readonly DerivedDef[]): LoadingView {
    // Nearly always: nothing loading and nothing drawing in.
    if (!this.names.size && !this.arrived.size && !this.awaiting) return IDLE;
    const loading = new Set(this.names);
    const arrived = new Map(this.arrived);
    // Follow derive lines until nothing more changes; a spec derives at most 200 values.
    for (let changed = true, rounds = 0; changed && rounds < 256; rounds++) {
      changed = false;
      for (const d of derived) {
        if (!loading.has(d.name) && d.reads.some((r) => loading.has(r))) { loading.add(d.name); changed = true; }
        const at = Math.max(-Infinity, ...d.reads.map((r) => arrived.get(r) ?? -Infinity));
        if (at > (arrived.get(d.name) ?? -Infinity)) { arrived.set(d.name, at); changed = true; }
      }
    }
    const awaiting = this.awaiting;
    return {
      waitsFor: (name) => loading.has(name) || awaiting,
      isLoading: (node, scope) =>
        this.readsOf(node).some((n) => loading.has(n) || (awaiting && !ENGINE_NAMES.has(n) && scope(n) === undefined)),
      reveal: (node, now) => {
        let at = -Infinity;
        for (const n of this.readsOf(node)) at = Math.max(at, arrived.get(n) ?? -Infinity);
        return at === -Infinity ? 1 : Math.min(1, Math.max(0, (now - at) / REVEAL_MS));
      },
    };
  }
}
