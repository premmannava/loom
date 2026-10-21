import { toData } from "./data";
import type { Value } from "./types";

type Listener = (key: string, value: Value) => void;

/** Holds the values that `{expressions}`, `bind=` and actions read and write. */
export class Store {
  private values = new Map<string, Value>();
  private listeners = new Set<Listener>();
  /** The last starting value each state line declared, to notice when a spec changes it. */
  private declared = new Map<string, string>();

  get(key: string): Value | undefined {
    return this.values.get(key);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  /**
   * Change a value. Lists and records are copied into plain, frozen Loom data,
   * so they can be passed straight from an app (`loom.state.set("rows", rows)`).
   * Throws a DataError explaining the problem for values that can't be data,
   * such as functions, class instances or cycles.
   */
  set(key: string, value: Value): void {
    value = toData(value);
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
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
  }

  snapshot(): Record<string, Value> {
    return Object.fromEntries(this.values);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A scope function for the expression evaluator. */
  readonly scope = (name: string): Value | undefined => this.values.get(name);
}
