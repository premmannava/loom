import type { Value } from "./types";

type Listener = (key: string, value: Value) => void;

/** Holds the values that `{expressions}`, `bind=` and actions read and write. */
export class Store {
  private values = new Map<string, Value>();
  private listeners = new Set<Listener>();

  get(key: string): Value | undefined {
    return this.values.get(key);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  set(key: string, value: Value): void {
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    for (const l of this.listeners) l(key, value);
  }

  /** Set a value only if the key has never been set (used for `state` lines). */
  declare(key: string, value: Value): void {
    if (!this.values.has(key)) this.set(key, value);
  }

  clear(): void {
    this.values.clear();
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
