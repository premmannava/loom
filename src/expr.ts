/**
 * A small, safe expression language for `{...}` in specs.
 *
 * Supports numbers, strings ('single' or "double"), true/false/null, state
 * identifiers, + - * / %, comparisons, && || !, the ternary `a ? b : c`,
 * parentheses, and a few whitelisted functions. There is no property access,
 * no assignment, and no way to reach JavaScript globals, so model-written
 * expressions cannot run arbitrary code.
 */
import { displayData, isData, isScalar, toNumber } from "./data";
import type { Value } from "./types";

type Node =
  | { k: "lit"; v: Value }
  | { k: "id"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

type Tok = { t: "num" | "str" | "id" | "op" | "end"; v: string; pos: number };

export class ExprError extends Error {}

type Fn = (...a: Value[]) => Value;

const BUILTINS: Record<string, Fn> = {
  min: (...a) => Math.min(...a.map(toNumber)),
  max: (...a) => Math.max(...a.map(toNumber)),
  round: (n, d = 0) => {
    const f = 10 ** toNumber(d);
    return Math.round(toNumber(n) * f) / f;
  },
  floor: (n) => Math.floor(toNumber(n)),
  ceil: (n) => Math.ceil(toNumber(n)),
  abs: (n) => Math.abs(toNumber(n)),
  fixed: (n, d = 2) => toNumber(n).toFixed(toNumber(d)),
};

// A frozen copy with no prototype, looked up by own property only, so names
// like `constructor` or `__defineGetter__` can't reach Object.prototype.
const FUNCTIONS: Readonly<Record<string, Fn>> = Object.freeze(Object.assign(Object.create(null) as Record<string, Fn>, BUILTINS));
const isFunctionName = (name: string) => Object.hasOwn(FUNCTIONS, name);
export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS);

const OPS = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", ","];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t") { i++; continue; }
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

  function primary(): Node {
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

  const root = ternary();
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
