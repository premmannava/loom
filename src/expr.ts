/**
 * A small, safe expression language for `{...}` in specs.
 *
 * Supports numbers, strings ('single' or "double"), true/false/null, state
 * identifiers, + - * / %, comparisons, && || !, the ternary `a ? b : c`,
 * parentheses, a few whitelisted functions, list and record literals
 * (`[1, 2]`, `{name: "Ada"}`), and reading fields and items (`t.text`,
 * `cart[0]`, `todos.length`). Fields are read only through readField in
 * data.ts, which reaches a record's own fields and a list's items and
 * nothing else. There is no assignment and no way to reach JavaScript
 * objects or globals, so model-written expressions cannot run code.
 */
import { displayData, fieldOf, isData, isList, isScalar, makeList, makeRecord, MAX_DATA_DEPTH, readField, toNumber } from "./data";
import type { Value } from "./types";

type Node =
  | { k: "lit"; v: Value }
  | { k: "id"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "list"; items: Node[] }
  | { k: "rec"; entries: Array<[string, Node]> }
  | { k: "get"; obj: Node; key: Node };

type Tok = { t: "num" | "str" | "id" | "op" | "end"; v: string; pos: number };

export class ExprError extends Error {}

type Fn = (...a: Value[]) => Value;

/** min(3, 5) or min(list): a single list argument stands for its items. */
const spread = (a: Value[]): Value[] => (a.length === 1 && isList(a[0]) ? [...a[0]] : a);

/** Only numbers count in sums: text ("12"), true/false, null or a missing field is NaN. */
const amount = (v: Value | undefined): number => (typeof v === "number" ? v : NaN);

/**
 * sum/avg/min/max over a list: the items, one field of each, or two fields
 * multiplied (price × qty). A value that isn't a number makes the result NaN
 * (shown as —) rather than being read as one: "12" is never 12, and nothing
 * is joined as text. An empty list sums to 0.
 */
function amounts(v: Value, a?: Value, b?: Value): number[] | null {
  if (!isList(v)) return null;
  return v.map((item) => {
    if (a === undefined) return amount(item);
    const x = amount(fieldOf(item, a));
    return b === undefined ? x : x * amount(fieldOf(item, b));
  });
}

/** The items whose field equals a value, or (with no value) whose field is true or not empty. */
function matches(item: Value, field: Value | undefined, value: Value | undefined): boolean {
  if (field === undefined) return !!item;
  const v = fieldOf(item, field);
  return value === undefined ? !!v : v === value;
}

/** Order for sort(): numbers by size, text alphabetically, missing values last. */
function order(a: Value | undefined, b: Value | undefined): number {
  const missing = (v: Value | undefined) => v === undefined || v === null || (typeof v === "number" && isNaN(v));
  if (missing(a) || missing(b)) return missing(a) ? (missing(b) ? 0 : 1) : -1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return toNumber(a!) - toNumber(b!);
}

/** Formatting follows US English for now; a locale option can come with the theme. */
const LOCALE = "en-US";

/** Text for a value in lower/upper/trim: text as is, numbers as shown, nothing for null. */
const textOf = (v: Value | undefined): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : formatValue(v));

/** min(3, 5), min(list) or min(list, 'field'). */
function extreme(pick: (...xs: number[]) => number, a: Value[]): number {
  if (isList(a[0]) && typeof a[1] === "string") return pick(...(amounts(a[0], a[1]) ?? []));
  return pick(...spread(a).map(toNumber));
}

const BUILTINS: Record<string, Fn> = {
  min: (...a) => extreme(Math.min, a),
  max: (...a) => extreme(Math.max, a),
  /** Items in a list, or characters in text. */
  len: (v) => (isList(v) || typeof v === "string" ? v.length : NaN),
  /** Items that are true, whose field is true (or not empty), or whose field equals a value. */
  count: (v, field, value) => (isList(v) ? v.filter((item) => matches(item, field, value)).length : NaN),
  /** The items count() would count, as a list: filter(tx, 'cat', 'Gas'). */
  filter: (v, field, value) => (isList(v) ? makeList(v.filter((item) => matches(item, field, value))) : NaN),
  /** The first item whose field equals a value, or null: find(rooms, 'id', room). */
  find: (v, field, value) => (isList(v) ? v.find((item) => matches(item, field, value)) ?? null : NaN),
  /** Items whose field contains some text, ignoring case; empty text matches everything. */
  search: (v, field, text) => {
    if (!isList(v)) return NaN;
    const q = textOf(text).trim().toLowerCase();
    return makeList(q ? v.filter((item) => textOf(fieldOf(item, field)).toLowerCase().includes(q)) : [...v]);
  },
  /** sort(list), sort(list, 'price') or sort(list, 'price', 'desc'), and sort(list, 'desc') for plain values. */
  sort: (v, a, b) => {
    if (!isList(v)) return NaN;
    const plainDesc = a === "desc" || a === "asc";
    const field = plainDesc ? undefined : a;
    const desc = (plainDesc ? a : b) === "desc";
    const key = (item: Value) => (field === undefined ? item : fieldOf(item, field));
    return makeList([...v].sort((x, y) => (desc ? -1 : 1) * order(key(x), key(y))));
  },
  /** The first n items: take(sort(players, 'score', 'desc'), 3). */
  take: (v, n) => (isList(v) ? makeList(v.slice(0, Math.max(0, Math.floor(toNumber(n ?? 0)) || 0))) : NaN),
  sum: (v, a, b) => amounts(v, a, b)?.reduce((t, x) => t + x, 0) ?? NaN,
  avg: (v, a, b) => {
    const xs = amounts(v, a, b);
    return xs && xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN;
  },
  /** join(tags) or join(tags, " / "), and for records join(cart, "name") or join(cart, "name", " / "). */
  join: (v, a, b) => {
    if (!isList(v)) return NaN;
    const ofRecords = v.some((item) => typeof item === "object" && item !== null && !isList(item));
    const parts = ofRecords ? v.map((item) => fieldOf(item, a)) : v;
    const sep = ofRecords ? b : a;
    return parts.map((x) => formatValue(x)).join(typeof sep === "string" ? sep : ", ");
  },
  /** Whether a list holds a value, or text contains other text. */
  includes: (v, x) => (isList(v) ? v.some((item) => item === x) : typeof v === "string" && x !== undefined && x !== null ? v.includes(formatValue(x)) : false),
  round: (n, d = 0) => {
    const f = 10 ** toNumber(d);
    return Math.round(toNumber(n) * f) / f;
  },
  floor: (n) => Math.floor(toNumber(n)),
  ceil: (n) => Math.ceil(toNumber(n)),
  abs: (n) => Math.abs(toNumber(n)),
  fixed: (n, d = 2) => toNumber(n).toFixed(toNumber(d)),
  /** money(2400) is $2,400.00, money(-84.1) is -$84.10; money(n, 'EUR') for another currency. */
  money: (n, currency = "USD") => {
    const x = toNumber(n);
    if (!isFinite(x)) return NaN;
    try { return new Intl.NumberFormat(LOCALE, { style: "currency", currency: textOf(currency) }).format(x); } catch { return NaN; }
  },
  /** number(37000) is 37,000; number(n, 2) always shows two decimals. */
  number: (n, d) => {
    const x = toNumber(n);
    if (!isFinite(x)) return NaN;
    const digits = d === undefined ? undefined : Math.min(10, Math.max(0, Math.floor(toNumber(d)) || 0));
    return new Intl.NumberFormat(LOCALE, digits === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
  },
  /** plural(1, 'item') is "1 item", plural(3, 'item') is "3 items"; plural(n, 'child', 'children') for irregular words. */
  plural: (n, one, many) => {
    const x = toNumber(n);
    const word = textOf(one);
    return `${isFinite(x) ? new Intl.NumberFormat(LOCALE).format(x) : "—"} ${x === 1 ? word : many === undefined ? word + "s" : textOf(many)}`;
  },
  lower: (t) => textOf(t).toLowerCase(),
  upper: (t) => textOf(t).toUpperCase(),
  trim: (t) => textOf(t).trim(),
};

// A frozen copy with no prototype, looked up by own property only, so names
// like `constructor` or `__defineGetter__` can't reach Object.prototype.
const FUNCTIONS: Readonly<Record<string, Fn>> = Object.freeze(Object.assign(Object.create(null) as Record<string, Fn>, BUILTINS));
const isFunctionName = (name: string) => Object.hasOwn(FUNCTIONS, name);
export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS);

const OPS = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", ",", "[", "]", "{", "}"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t") { i++; continue; }
    // A dot reads a field (t.text), unless a digit follows: then it starts a number (.5).
    if (c === "." && !/[0-9]/.test(src[i + 1] ?? "")) { out.push({ t: "op", v: ".", pos: i }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExprError(`Unexpected "${c}" at ${i}`);
      out.push({ t: "num", v: m[0], pos: i }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) j++; s += src[j]; j++; }
      if (j >= src.length) throw new ExprError("Unclosed string");
      out.push({ t: "str", v: s, pos: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], pos: i }); i += m[0].length; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected "${c}" at ${i}`);
    out.push({ t: "op", v: op, pos: i }); i += op.length;
  }
  out.push({ t: "end", v: "", pos: src.length });
  return out;
}

const BIN_PREC: Record<string, number> = {
  "||": 2, "&&": 3,
  "==": 4, "!=": 4, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
};

function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const expect = (v: string) => {
    const t = next();
    if (t.v !== v) throw new ExprError(`Expected "${v}" but found "${t.v || "end"}"`);
  };

  /** Literals nest at most as deep as data may. */
  let depth = 0;

  /** Entries of a record literal, after its "{" (or at the start, for a bare record). */
  function recordBody(close: string): Node {
    const entries: Array<[string, Node]> = [];
    while (peek().v !== close && peek().t !== "end") {
      const k = next();
      if (k.t !== "id" && k.t !== "str") throw new ExprError(`Expected a field name but found "${k.v || "end"}"`);
      expect(":");
      entries.push([k.v, ternary()]);
      if (peek().v === ",") next();
      else break;
    }
    return { k: "rec", entries };
  }

  function nested<T>(f: () => T): T {
    if (++depth > MAX_DATA_DEPTH) throw new ExprError(`Lists and records nest more than ${MAX_DATA_DEPTH} levels deep`);
    try { return f(); } finally { depth--; }
  }

  /** A value, then any number of .field and [item] reads after it. */
  function primary(): Node {
    let n = atom();
    for (;;) {
      if (peek().v === ".") {
        next();
        const name = next();
        if (name.t !== "id") throw new ExprError(`Expected a field name after "." but found "${name.v || "end"}"`);
        n = { k: "get", obj: n, key: { k: "lit", v: name.v } };
      } else if (peek().v === "[") {
        next();
        const key = ternary();
        expect("]");
        n = { k: "get", obj: n, key };
      } else return n;
    }
  }

  function atom(): Node {
    const t = next();
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (peek().v === "(") {
        if (!isFunctionName(t.v)) throw new ExprError(`Unknown function "${t.v}"`);
        next();
        const args: Node[] = [];
        if (peek().v !== ")") {
          args.push(ternary());
          while (peek().v === ",") { next(); args.push(ternary()); }
        }
        expect(")");
        return { k: "call", fn: t.v, args };
      }
      return { k: "id", name: t.v };
    }
    if (t.v === "(") { const e = ternary(); expect(")"); return e; }
    if (t.v === "[") {
      return nested(() => {
        const items: Node[] = [];
        while (peek().v !== "]" && peek().t !== "end") {
          items.push(ternary());
          if (peek().v === ",") next();
          else break;
        }
        expect("]");
        return { k: "list", items } as Node;
      });
    }
    if (t.v === "{") return nested(() => { const r = recordBody("}"); expect("}"); return r; });
    if (t.v === "!" || t.v === "-") return { k: "un", op: t.v, a: primary() };
    throw new ExprError(t.t === "end" ? "Expression ended early" : `Unexpected "${t.v}"`);
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const t = peek();
      const prec = t.t === "op" ? BIN_PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      next();
      left = { k: "bin", op: t.v, a: left, b: binary(prec + 1) };
    }
  }

  function ternary(): Node {
    const c = binary(1);
    if (peek().v !== "?") return c;
    next();
    const a = ternary();
    expect(":");
    return { k: "cond", c, a, b: ternary() };
  }

  // Braces whose content starts with "name:" hold a record: {text:'Snacks', done:false}.
  // A ternary always has "?" before its ":", so the two can't be confused.
  const startsRecord = (toks[0]!.t === "id" || toks[0]!.t === "str") && toks[1]?.v === ":";
  const root = startsRecord ? nested(() => recordBody("")) : ternary();
  if (peek().t !== "end") throw new ExprError(`Unexpected "${peek().v}"`);
  return root;
}

export type Scope = (name: string) => Value | undefined;


function run(n: Node, scope: Scope): Value {
  switch (n.k) {
    case "lit": return n.v;
    case "id": {
      const v = scope(n.name);
      // Only Loom data counts: a scope backed by an object could otherwise
      // hand back things like Object.prototype for `__proto__`.
      if (!isData(v)) throw new ExprError(`Unknown state "${n.name}"`);
      return v;
    }
    case "un": {
      const a = run(n.a, scope);
      return n.op === "!" ? !a : -toNumber(a);
    }
    case "cond": return run(n.c, scope) ? run(n.a, scope) : run(n.b, scope);
    case "list": return makeList(n.items.map((x) => run(x, scope)));
    case "rec": return makeRecord(n.entries.map(([k, x]) => [k, run(x, scope)]));
    case "get": {
      const r = readField(run(n.obj, scope), run(n.key, scope));
      if ("error" in r) throw new ExprError(r.error);
      return r.value;
    }
    case "call": {
      // Called detached, so `this` is never the function table.
      const fn = FUNCTIONS[n.fn]!;
      return fn(...n.args.map((a) => run(a, scope)));
    }
    case "bin": {
      if (n.op === "&&") return run(n.a, scope) && run(n.b, scope);
      if (n.op === "||") return run(n.a, scope) || run(n.b, scope);
      const a = run(n.a, scope), b = run(n.b, scope);
      switch (n.op) {
        case "+": return typeof a === "string" || typeof b === "string" ? `${joinText(a)}${joinText(b)}` : toNumber(a) + toNumber(b);
        case "-": return toNumber(a) - toNumber(b);
        case "*": return toNumber(a) * toNumber(b);
        case "/": return toNumber(a) / toNumber(b);
        case "%": return toNumber(a) % toNumber(b);
        case "==": case "===": return a === b;
        case "!=": case "!==": return a !== b;
        case "<": case "<=": case ">": case ">=": return compare(n.op, a, b);
      }
    }
  }
  throw new ExprError("Bad expression");
}

const cache = new Map<string, Node | ExprError>();

function compile(src: string): Node {
  let c = cache.get(src);
  if (!c) {
    try { c = parseExpr(src); } catch (e) { c = e instanceof ExprError ? e : new ExprError(String(e)); }
    if (cache.size > 2000) cache.clear();
    cache.set(src, c);
  }
  if (c instanceof ExprError) throw c;
  return c;
}

export type EvalResult = { ok: true; value: Value } | { ok: false; error: string };

/** Evaluate an expression against a scope. Never throws. */
export function evaluate(src: string, scope: Scope): EvalResult {
  try {
    return { ok: true, value: run(compile(src), scope) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Check syntax only (used by the parser to report problems early). */
export function checkSyntax(src: string): string | null {
  try { compile(src); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** Collect the state names an expression reads. */
export function identifiers(src: string): string[] {
  try {
    const out = new Set<string>();
    const walk = (n: Node): void => {
      if (n.k === "id") out.add(n.name);
      else if (n.k === "un") walk(n.a);
      else if (n.k === "bin") { walk(n.a); walk(n.b); }
      else if (n.k === "cond") { walk(n.c); walk(n.a); walk(n.b); }
      else if (n.k === "call") n.args.forEach(walk);
      else if (n.k === "list") n.items.forEach(walk);
      else if (n.k === "rec") n.entries.forEach(([, x]) => walk(x));
      else if (n.k === "get") { walk(n.obj); walk(n.key); }
    };
    walk(compile(src));
    return [...out];
  } catch { return []; }
}

/** Format a value for display in text. */
export function formatValue(v: Value | undefined): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") {
    if (!isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === "object") return displayData(v, formatValue);
  return String(v);
}

/** A value joined into text with +: as it would display, except null stays empty. */
function joinText(v: Value): string {
  return v === null ? "" : typeof v === "object" ? formatValue(v) : String(v);
}

/** <, <=, > and >=: text compares as text, plain values as numbers, and lists or records are never ordered. */
function compare(op: string, a: Value, b: Value): boolean {
  if (!isScalar(a) || !isScalar(b)) return false;
  const [x, y] = typeof a === "string" && typeof b === "string" ? [a, b] : [toNumber(a), toNumber(b)];
  return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
}

/** Find `{...}` segments in a string, respecting nested braces and quotes. */
export function splitTemplate(s: string): Array<{ text: string } | { expr: string }> {
  const parts: Array<{ text: string } | { expr: string }> = [];
  let buf = "", i = 0;
  while (i < s.length) {
    if (s[i] === "{") {
      let depth = 1, j = i + 1, quote = "";
      while (j < s.length && depth > 0) {
        const c = s[j]!;
        if (quote) { if (c === quote) quote = ""; }
        else if (c === "'" || c === '"') quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      if (depth === 0) {
        if (buf) parts.push({ text: buf });
        buf = "";
        parts.push({ expr: s.slice(i + 1, j - 1) });
        i = j;
        continue;
      }
    }
    buf += s[i]; i++;
  }
  if (buf) parts.push({ text: buf });
  return parts;
}

/** Replace every `{expr}` in a string with its formatted value. */
export function interpolate(s: string, scope: Scope): string {
  if (!s.includes("{")) return s;
  return splitTemplate(s)
    .map((p) => ("text" in p ? p.text : (() => { const r = evaluate(p.expr, scope); return r.ok ? formatValue(r.value) : "—"; })()))
    .join("");
}

/**
 * The expression inside a prop value that is one whole {…}, or null.
 * "{a} of {b}" starts with { and ends with } but is text with two
 * expressions in it, so it isn't one expression.
 */
export function wholeExpression(raw: string): string | null {
  if (raw[0] !== "{" || raw[raw.length - 1] !== "}") return null;
  let depth = 0, quote = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0 && i < raw.length - 1) return null;
  }
  return depth === 0 ? raw.slice(1, -1) : null;
}

/** A condition or expression prop's source: the inside of a whole {…}, or the value as written (if=done). */
export function bareExpression(raw: string): string {
  return wholeExpression(raw) ?? raw;
}
