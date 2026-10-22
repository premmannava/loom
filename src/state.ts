import { toData } from "./data";
import { evaluate } from "./expr";
import type { Value } from "./types";

/** A derived value as the store needs it: see DerivedDef in parser.ts. */
export interface Derivation {
  name: string;
  expr: string;
  line: number;
  reads: readonly string[];
}

/** Thrown when something tries to set a derived name. */
export class DerivedWriteError extends Error {
  constructor(readonly key: string, line: number) {
    super(`Can't set ${key}: it's derived (derive ${key} on line ${line}) and changes only when what it's computed from changes`);
    this.name = "DerivedWriteError";
  }
}

type Listener = (key: string, value: Value) => void;

/**
 * Holds the values that `{expressions}`, `bind=` and actions read and write,
 * and the derived values worked out from them.
 *
 * Derived values (derive total={…}) are read like state but never stored or
 * written. Each is worked out the first time it's read and kept until a
 * value it reads changes: setting a state value forgets the derived values
 * that depend on it, directly or through other derived values, and nothing
 * else. One that can't be worked out is undefined (shown as —), never an
 * older result, and is reported once through onDerivedError.
 */
export class Store {
  private values = new Map<string, Value>();
  private listeners = new Set<Listener>();
  /** The last starting value each state line declared, to notice when a spec changes it. */
  private declared = new Map<string, string>();
  private derived = new Map<string, Derivation>();
  /** Worked-out derived values; undefined means it failed. Absent means not worked out yet. */
  private computed = new Map<string, Value | undefined>();
  /** For each name, the derived values that read it directly. */
  private readers = new Map<string, Set<string>>();
  /** Derived values being worked out right now, to stop a loop the parser didn't catch. */
  private working = new Set<string>();
  /** Told when a derived value can't be worked out. */
  onDerivedError: ((d: Derivation, error: string) => void) | null = null;

  /** A state value, or a derived value worked out now. */
  get(key: string): Value | undefined {
    return this.derived.has(key) ? this.derivedValue(key) : this.values.get(key);
  }

  /** Whether a state value is set (derived values aren't state). */
  has(key: string): boolean {
    return this.values.has(key);
  }

  isDerived(key: string): boolean {
    return this.derived.has(key);
  }

  /** The derive line a name comes from, if it's derived. */
  derivation(key: string): Derivation | undefined {
    return this.derived.get(key);
  }

  /** Replace the derived values (from a parsed spec). Everything is worked out afresh. */
  derive(defs: readonly Derivation[]): void {
    this.derived = new Map(defs.map((d) => [d.name, d]));
    this.computed.clear();
    this.readers.clear();
    for (const d of defs) {
      for (const r of d.reads) {
        let set = this.readers.get(r);
        if (!set) this.readers.set(r, (set = new Set()));
        set.add(d.name);
      }
    }
  }

  /** Every derived value, worked out now, for tools and tests. */
  derivedSnapshot(): Record<string, Value | undefined> {
    return Object.fromEntries([...this.derived.keys()].map((k) => [k, this.derivedValue(k)]));
  }

  private derivedValue(name: string): Value | undefined {
    if (this.computed.has(name)) return this.computed.get(name);
    const d = this.derived.get(name)!;
    if (this.working.has(name)) return undefined;
    this.working.add(name);
    const r = evaluate(d.expr, this.scope);
    this.working.delete(name);
    const value = r.ok ? r.value : undefined;
    this.computed.set(name, value);
    if (!r.ok) this.onDerivedError?.(d, r.error);
    return value;
  }

  /** Forget the derived values that read a name, and the ones that read those. */
  private stale(name: string): void {
    const queue = [name];
    const seen = new Set<string>();
    while (queue.length) {
      const n = queue.pop()!;
      for (const d of this.readers.get(n) ?? []) {
        if (seen.has(d)) continue;
        seen.add(d);
        this.computed.delete(d);
        queue.push(d);
      }
    }
  }

  /**
   * Change a value. Lists and records are copied into plain, frozen Loom data,
   * so they can be passed straight from an app (`loom.state.set("rows", rows)`).
   * Throws a DataError explaining the problem for values that can't be data,
   * such as functions, class instances or cycles.
   */
  set(key: string, value: Value): void {
    const d = this.derived.get(key);
    if (d) throw new DerivedWriteError(key, d.line);
    value = toData(value);
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    this.stale(key);
    for (const l of this.listeners) l(key, value);
  }

  /**
   * Apply a `state` line's starting value. A value the user has changed is
   * kept while the spec re-parses (streaming, small edits), but when the
   * spec now declares something different (a model refined the screen with
   * new data), the new declaration wins.
   */
  declare(key: string, value: Value): void {
    const declared = JSON.stringify(value);
    const before = this.declared.get(key);
    this.declared.set(key, declared);
    // Set by the app or an action, never declared: the app's data wins.
    if (this.values.has(key) && before === undefined) return;
    if (this.values.has(key) && before === declared) return;
    this.set(key, value);
  }

  clear(): void {
    this.values.clear();
    this.declared.clear();
    this.computed.clear();
  }

  snapshot(): Record<string, Value> {
    return Object.fromEntries(this.values);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A scope function for the expression evaluator. */
  readonly scope = (name: string): Value | undefined => this.get(name);
}
