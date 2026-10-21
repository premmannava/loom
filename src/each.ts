/**
 * `each` repeats its children once per item of a list:
 *
 *   each items=todos as=t index=i key={t.id}
 *     check "{t.text}"
 *
 * Expansion happens during layout, when a container asks for its children:
 * every `each` is replaced by copies of its children, one set per item. A copy
 * is an ordinary LoomNode whose id carries the item's key (`7:check#3`), so
 * focus, hover and fade-in follow the item, not its position. Each copy reads
 * values through its own scope: the loop variables first, then whatever the
 * `each` itself could see (state, or an outer loop's variables).
 *
 * Copies are made fresh on every layout, which is cheap next to measuring
 * text, and means nothing here can go stale when the list changes.
 */
import { bareExpression, evaluate, type Scope } from "./expr";
import { isList, isScalar } from "./data";
import { PATH, placeOf, stateLocate, type Locate } from "./paths";
import type { LoomNode, Value } from "./types";

/** At most this many items are shown per `each`; the rest are left out with a warning. */
export const MAX_EACH_ITEMS = 500;

/**
 * At most this many elements are copied per layout, across every each. Nested
 * lists multiply (500 × 500 is 250,000), so without this a spec could stall
 * the page.
 */
export const MAX_EACH_ELEMENTS = 10_000;

/** What's left of MAX_EACH_ELEMENTS during one layout. */
export interface EachBudget {
  left: number;
}

/** Default loop variable name when `as=` is left out. */
export const DEFAULT_AS = "item";

const scopes = new WeakMap<LoomNode, Scope>();
const locators = new WeakMap<LoomNode, Locate>();

/** The scope a node reads values through: its item's scope inside an `each`, otherwise `base`. */
export function scopeOf(node: LoomNode, base: Scope): Scope {
  return scopes.get(node) ?? base;
}

/**
 * Where a node's names live in state, for writing: inside each, the loop
 * variable points at its item (`t` is item 2 of `todos`).
 */
export function locateOf(node: LoomNode): Locate {
  return locators.get(node) ?? stateLocate;
}

/** Strip one pair of braces, so `items=todos` and `items={todos}` mean the same. */
export function bare(raw: string): string {
  return bareExpression(raw);
}

/** The loop variable names an `each` introduces. */
export function loopNames(each: LoomNode): string[] {
  const names = [each.props.as ?? DEFAULT_AS];
  if (each.props.index) names.push(each.props.index);
  return names;
}

function size(node: LoomNode): number {
  let n = 1;
  for (const c of node.children) n += size(c);
  return n;
}

function copy(node: LoomNode, suffix: string, scope: Scope, locate: Locate): LoomNode {
  const out: LoomNode = { ...node, id: node.id + suffix, children: node.children.map((c) => copy(c, suffix, scope, locate)) };
  scopes.set(out, scope);
  locators.set(out, locate);
  return out;
}

/**
 * The copies an `each` stands for, in item order. `scope` is what the `each`
 * itself reads through. `warn` hears about problems a model can fix: items
 * that aren't a list, too many items, repeated keys.
 */
export function eachInstances(each: LoomNode, scope: Scope, warn?: (message: string) => void, budget: EachBudget = { left: MAX_EACH_ELEMENTS }): LoomNode[] {
  const raw = each.props.items;
  if (raw === undefined) return [];
  const r = evaluate(bare(raw), scope);
  if (!r.ok || r.value === null) return [];
  const items = r.value;
  if (!isList(items)) {
    warn?.(`each on line ${each.line}: items is ${describe(items)}, not a list, so nothing was repeated`);
    return [];
  }
  if (items.length > MAX_EACH_ITEMS) {
    warn?.(`each on line ${each.line}: showing the first ${MAX_EACH_ITEMS} of ${items.length} items`);
  }

  const as = each.props.as ?? DEFAULT_AS;
  const index = each.props.index;
  // Items can be written to when the list is a path into state (todos, g.lines), not computed.
  const outer = locateOf(each);
  const itemsPath = bare(raw).trim();
  const listPlace = PATH.test(itemsPath) ? placeOf(itemsPath, outer) : null;
  const keyExpr = each.props.key === undefined ? undefined : bare(each.props.key);
  const seen = new Set<string>();
  const out: LoomNode[] = [];
  const n = Math.min(items.length, MAX_EACH_ITEMS);
  const perItem = each.children.reduce((sum, c) => sum + size(c), 0);
  for (let i = 0; i < n; i++) {
    if (budget.left < perItem) {
      warn?.(`each on line ${each.line}: lists made more than ${MAX_EACH_ELEMENTS} elements, so only the first ${i} of ${items.length} items are shown`);
      break;
    }
    budget.left -= perItem;
    const item = items[i]!;
    const own: Scope = (name) => (name === as ? item : name === index ? i : scope(name));
    const place = listPlace && { key: listPlace.key, steps: [...listPlace.steps, i] };
    const locate: Locate = (name) => (name === as ? place : name === index ? null : outer(name));
    let key = String(i);
    if (keyExpr !== undefined) {
      const k = evaluate(keyExpr, own);
      if (k.ok && isScalar(k.value) && k.value !== null && k.value !== "") key = String(k.value);
    }
    if (seen.has(key)) {
      warn?.(`each on line ${each.line}: key "${key}" is used by more than one item. Keys should be unique, like key={${as}.id}`);
      key = `${key}@${i}`;
    }
    seen.add(key);
    // `#` can't appear in a spec id, so these never collide with real ids.
    const suffix = `#${key.replace(/#/g, "%23")}`;
    for (const child of each.children) out.push(copy(child, suffix, own, locate));
  }
  return out;
}

function describe(v: Value): string {
  if (isScalar(v)) return typeof v === "string" ? "text" : `a ${typeof v}`;
  return "a record";
}
