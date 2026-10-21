/**
 * Paths are how specs name a place to write: `count`, `settings.theme`, or,
 * inside each, `t.done` (field `done` of the current item).
 *
 * Writing never changes data in place. Setting `t.done` builds a new `todos`
 * list holding a new item, then sets `todos` in the store, so the store sees
 * a change and the host's change event reports `todos`.
 */
import { isList, isRecord, makeList, makeRecord } from "./data";
import type { Value } from "./types";

/** A place in state: a state key and the fields and positions inside it. */
export interface Place {
  key: string;
  steps: Array<string | number>;
}

/**
 * Finds where a name lives. Returns null for a name that can't be written
 * (an each's index, or an item of a list that isn't in state).
 */
export type Locate = (name: string) => Place | null;

/** State names: every name is its own key. */
export const stateLocate: Locate = (name) => ({ key: name, steps: [] });

/** A writable path: names joined by dots, like t.done. */
export const PATH = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;

/** Names that never become fields, matching what expressions refuse to read. */
const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);

/** Where a path points, or null if it can't be written. */
export function placeOf(path: string, locate: Locate): Place | null {
  if (!PATH.test(path)) return null;
  const [first, ...rest] = path.split(".");
  const base = locate(first!);
  return base && { key: base.key, steps: [...base.steps, ...rest] };
}

/** Replace the value at `steps` inside `root`, returning a new root, or an error. */
export function setIn(root: Value | undefined, steps: ReadonlyArray<string | number>, value: Value): { value: Value } | { error: string } {
  if (!steps.length) return { value };
  const [step, ...rest] = steps;
  if (typeof step === "number") {
    if (!isList(root) || step < 0 || step >= root.length) return { error: `there's no item ${step}` };
    const inner = setIn(root[step], rest, value);
    if ("error" in inner) return inner;
    const items = [...root];
    items[step] = inner.value;
    return { value: makeList(items) };
  }
  if (BLOCKED.has(step!)) return { error: `"${step}" can't be written` };
  if (!isRecord(root)) return { error: `there's no record to hold "${step}"` };
  const has = Object.prototype.hasOwnProperty.call(root, step!);
  if (!has && rest.length) return { error: `there's no field "${step}"` };
  const inner = setIn(has ? root[step!] : undefined, rest, value);
  if ("error" in inner) return inner;
  // Keep the field order, so the record still reads the same way.
  const entries: Array<[string, Value]> = Object.entries(root).map(([k, v]) => [k, k === step ? inner.value : v]);
  if (!has) entries.push([step!, inner.value]);
  return { value: makeRecord(entries) };
}

/** Read the value at `steps` inside `root`, or undefined if it isn't there. */
export function getIn(root: Value | undefined, steps: ReadonlyArray<string | number>): Value | undefined {
  let v = root;
  for (const step of steps) {
    if (typeof step === "number") v = isList(v) ? v[step] : undefined;
    else v = isRecord(v) && !BLOCKED.has(step) && Object.prototype.hasOwnProperty.call(v, step) ? v[step] : undefined;
    if (v === undefined) return undefined;
  }
  return v;
}
