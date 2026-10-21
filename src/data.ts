/**
 * Lists and records: the structured values Loom state can hold.
 *
 * They come from two places, and both go through this file:
 *
 * - literals a spec writes on a `state` line, one line each so streaming
 *   keeps working: `state todos=[{text:"Pack water", done:false}]`
 * - data the host app passes in: `loom.state.set("products", rows)`
 *
 * Either way the result is plain data: frozen lists, and frozen records with
 * no prototype, holding only numbers, strings, booleans, null, lists and
 * records. Nothing in it can be called, and nothing in it leads back to
 * JavaScript objects (rule 1). Parsing a literal never runs anything.
 */
import type { DataList, DataRecord, Value } from "./types";

/** How deeply lists and records may nest. */
export const MAX_DATA_DEPTH = 20;
/** How many values one literal or one host value may hold in total. */
export const MAX_DATA_VALUES = 10_000;

export class DataError extends Error {}

/** Values this module made: already plain and frozen, so they can be reused as is. */
const made = new WeakSet<object>();

function record(entries: Array<[string, Value]>): DataRecord {
  const r = Object.create(null) as Record<string, Value>;
  for (const [k, v] of entries) r[k] = v;
  Object.freeze(r);
  made.add(r);
  return r;
}

function list(items: Value[]): DataList {
  Object.freeze(items);
  made.add(items);
  return items;
}

export function isList(v: unknown): v is DataList {
  return Array.isArray(v);
}

export function isRecord(v: unknown): v is DataRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Whether a value is Loom data: a scalar, or a list or record this module
 * made. Expressions only accept values that pass this, so nothing else a
 * scope might return (a host object, a prototype) can reach them.
 */
export function isData(v: unknown): v is Value {
  return isScalar(v) || (typeof v === "object" && v !== null && made.has(v));
}

/**
 * A value as a number for arithmetic. Lists and records are never numbers, so
 * JavaScript's quirks (Number([5]) is 5) can't leak into results.
 */
export function toNumber(v: Value | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" || typeof v === "boolean" || v === null) return Number(v);
  return NaN;
}

/** A number, string, boolean or null. */
export function isScalar(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean";
}

// ---------------------------------------------------------------- host data

/**
 * Copy a value from the host app into plain Loom data. Throws a DataError
 * that says what's wrong, for values that can't be data: functions, class
 * instances (Date, Map…), cycles, numbers that aren't finite, or anything
 * over the limits. Fields set to undefined are left out.
 */
export function toData(v: unknown): Value {
  if (isScalar(v)) {
    if (typeof v === "number" && !Number.isFinite(v)) throw new DataError(`${v} isn't a usable number`);
    return v;
  }
  if (typeof v === "object" && v !== null && made.has(v)) return v as Value;
  let count = 0;
  const seen = new Set<object>();
  const copy = (x: unknown, depth: number, where: string): Value => {
    if (++count > MAX_DATA_VALUES) throw new DataError(`More than ${MAX_DATA_VALUES} values; pass less data`);
    if (isScalar(x)) {
      if (typeof x === "number" && !Number.isFinite(x)) throw new DataError(`${where} is ${x}, which isn't a usable number`);
      return x;
    }
    if (typeof x !== "object" || x === null) throw new DataError(`${where} is a ${typeof x}; only numbers, text, true/false, null, lists and records can be data`);
    if (made.has(x)) return x as Value;
    if (depth >= MAX_DATA_DEPTH) throw new DataError(`${where} is nested more than ${MAX_DATA_DEPTH} levels deep`);
    if (seen.has(x)) throw new DataError(`${where} refers back to itself`);
    seen.add(x);
    try {
      if (Array.isArray(x)) return list(x.map((item, i) => copy(item, depth + 1, `${where}[${i}]`)));
      const proto = Object.getPrototypeOf(x) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        const kind = (x as { constructor?: { name?: string } }).constructor?.name ?? "object";
        throw new DataError(`${where} is a ${kind}; convert it to plain numbers, text, lists or records first`);
      }
      const entries: Array<[string, Value]> = [];
      for (const k of Object.keys(x)) {
        const item = (x as Record<string, unknown>)[k];
        if (item !== undefined) entries.push([k, copy(item, depth + 1, `${where}.${k}`)]);
      }
      return record(entries);
    } finally {
      seen.delete(x);
    }
  };
  return copy(v, 0, "the value");
}

// ---------------------------------------------------------------- literals

/**
 * Parse a list or record literal written in a spec:
 *
 *   [1, 2, 3]
 *   {name: "Socks", price: 24, tags: ["wool", "trail"]}
 *   [{text:'Pack water', done:false}, {text:"Snacks", done:true}]
 *
 * Names may be bare or quoted, strings use single or double quotes, and a
 * trailing comma is fine. Returns the value, or a message saying what's wrong
 * and where.
 */
export function parseData(src: string): { value: Value } | { error: string } {
  let i = 0;
  let count = 0;
  const n = src.length;
  const fail = (msg: string): never => { throw new DataError(`${msg} at character ${i + 1}`); };
  const ws = () => { while (i < n && /\s/.test(src[i]!)) i++; };

  const str = (): string => {
    const q = src[i]!;
    i++;
    let s = "";
    while (i < n && src[i] !== q) {
      if (src[i] === "\\" && i + 1 < n) {
        i++;
        const c = src[i]!;
        s += c === "n" ? "\n" : c === "t" ? "\t" : c;
      } else s += src[i];
      i++;
    }
    if (i >= n) fail("Unclosed quote");
    i++;
    return s;
  };

  const name = (): string => {
    if (src[i] === '"' || src[i] === "'") return str();
    const m = /^[A-Za-z_$][\w$-]*/.exec(src.slice(i));
    if (!m) fail(`Expected a field name`);
    i += m![0].length;
    return m![0];
  };

  const value = (depth: number): Value => {
    if (++count > MAX_DATA_VALUES) fail(`More than ${MAX_DATA_VALUES} values`);
    ws();
    const c = src[i];
    if (c === undefined) fail("Expected a value");
    if (c === "[" || c === "{") {
      if (depth >= MAX_DATA_DEPTH) fail(`Nested more than ${MAX_DATA_DEPTH} levels deep`);
      const close = c === "[" ? "]" : "}";
      i++;
      const items: Value[] = [];
      const entries: Array<[string, Value]> = [];
      for (;;) {
        ws();
        if (src[i] === close) { i++; break; }
        if (c === "[") items.push(value(depth + 1));
        else {
          const k = name();
          ws();
          if (src[i] !== ":") fail(`Expected ":" after "${k}"`);
          i++;
          entries.push([k, value(depth + 1)]);
        }
        ws();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === close) { i++; break; }
        fail(src[i] === undefined ? `Missing "${close}"` : `Expected "," or "${close}" but found "${src[i]}"`);
      }
      return c === "[" ? list(items) : record(entries);
    }
    if (c === '"' || c === "'") return str();
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|true|false|null)(?![\w$])/.exec(src.slice(i));
    if (!m) fail(`Unexpected "${c}"`);
    i += m![0].length;
    const w = m![0];
    return w === "true" ? true : w === "false" ? false : w === "null" ? null : Number(w);
  };

  try {
    const v = value(0);
    ws();
    if (i < n) fail(`Unexpected "${src[i]}" after the value`);
    return { value: v };
  } catch (e) {
    if (e instanceof DataError) return { error: e.message };
    throw e;
  }
}

/** Whether a raw prop or state value is written as a list or record literal. */
export function looksLikeData(raw: string): boolean {
  const t = raw.trim();
  // A record literal's first field is "name:" or a quoted name; an expression in braces isn't.
  return t.startsWith("[") || /^\{\s*(?:[A-Za-z_$][\w$-]*|"[^"]*"|'[^']*')\s*:/.test(t) || /^\{\s*\}$/.test(t);
}

// ---------------------------------------------------------------- display

/**
 * How a value reads in text. A list of plain values reads "a, b, c". A record,
 * or a list holding records, reads "—", so a model learns to pick a field.
 */
export function displayData(v: DataList | DataRecord, format: (x: Value) => string): string {
  if (isList(v) && v.every(isScalar)) return v.map(format).join(", ");
  return "—";
}
