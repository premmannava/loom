/**
 * Fuzz tests: random and damaged input must never make the parser, the
 * expression evaluator, actions or the engine throw (CLAUDE.md rules 1 and 2).
 * A model's mistake should cost one element, never the screen.
 *
 * Set FUZZ_RUNS to run more cases locally, e.g. FUZZ_RUNS=5000 npm test.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseActions, runActions } from "../src/actions";
import { DataError, isData, parseData, toData } from "../src/data";
import { evaluate, interpolate } from "../src/expr";
import { MAX_DEPTH, parse } from "../src/parser";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Box, Value } from "../src/types";
import { walkBoxes } from "../src/layout";
import { ALL_COMPONENTS, corpus, registry } from "./corpus";

const RUNS = Number(process.env.FUZZ_RUNS) || 200;
const opts = { numRuns: RUNS };

// ---------------------------------------------------------------- generators

const names = ["a", "b", "count", "done", "price", "qty", "x", "first", "second", "screen", "todos", "lines", "item", "t", "i"];
const types = [...ALL_COMPONENTS.map((c) => c.type), "state", "sparkle", "Button", "row-x"];
const propNames = [...new Set(ALL_COMPONENTS.flatMap((c) => Object.keys(c.props))), "if", "colour", "on", "x-y"];

const atom = fc.oneof(
  fc.constantFrom(...names, "true", "false", "null", "constructor", "__proto__", "toString", "window"),
  fc.integer({ min: -1000, max: 1000 }).map(String),
  fc.double({ noNaN: true, min: -1e6, max: 1e6 }).map(String),
  fc.string({ maxLength: 6 }).map((s) => `'${s.replace(/'/g, "")}'`),
);

const expr: fc.Arbitrary<string> = fc.letrec<{ e: string }>((tie) => ({
  e: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    atom,
    fc.tuple(tie("e"), fc.constantFrom("+", "-", "*", "/", "%", "==", "!=", "<", ">=", "&&", "||"), tie("e")).map(([a, op, b]) => `${a} ${op} ${b}`),
    fc.tuple(tie("e"), tie("e"), tie("e")).map(([c, a, b]) => `${c} ? ${a} : ${b}`),
    tie("e").map((a) => `(${a})`),
    tie("e").map((a) => `!${a}`),
    fc.tuple(fc.constantFrom("min", "max", "round", "fixed", "abs", "len", "count", "sum", "avg", "join", "includes", "filter", "find", "search", "sort", "take", "money", "number", "plural", "lower", "upper", "trim", "nope", "valueOf"), fc.array(tie("e"), { maxLength: 3 })).map(([f, args]) => `${f}(${args.join(", ")})`),
    // Reading inside data, including names that must stay unreadable.
    fc.tuple(tie("e"), fc.constantFrom("text", "done", "price", "length", "lines", "constructor", "__proto__", "prototype", "toString", "map")).map(([o, k]) => `${o}.${k}`),
    fc.tuple(tie("e"), tie("e")).map(([o, k]) => `${o}[${k}]`),
    fc.array(tie("e"), { maxLength: 3 }).map((xs) => `[${xs.join(", ")}]`),
    fc.array(fc.tuple(fc.constantFrom("text", "done", "__proto__", "'unit price'"), tie("e")), { maxLength: 3 }).map((kv) => `{${kv.map(([k, v]) => `${k}: ${v}`).join(", ")}}`),
  ),
})).e;

/** Expressions, plus raw junk that looks a bit like one. */
const exprish = fc.oneof(expr, fc.string({ maxLength: 20 }), fc.constantFrom("((((((((((", "a.b", "x = 1", "`t`", "}", "{", "'"));

const action = fc.oneof(
  fc.constantFrom("back", "back:x", "go:first", "go:second", "go:nowhere", "notify:'Saved {a}; done'", "notify:", "notify:'{a +}'"),
  fc.tuple(fc.constantFrom("inc", "dec", "toggle", "set", "emit", "go", "notify", "add", "remove", "clear", "jump", ""), fc.constantFrom(...names, "", "1x", "t.done", "item.qty", "todos.0", "t.__proto__", "a.constructor.prototype"), fc.option(fc.oneof(atom, exprish.map((e) => `{${e}}`)))).map(
    ([op, key, arg]) => `${op}:${key}${arg === null ? "" : ":" + arg}`,
  ),
  fc.string({ maxLength: 12 }),
);

const propValue = fc.oneof(
  fc.constantFrom("primary", "secondary", "danger", "title", "muted", "center", "huge", "true", "false", "Japan,Kenya", "first", "second"),
  fc.integer({ min: -50, max: 2000 }).map(String),
  exprish.map((e) => `{${e}}`),
  fc.string({ maxLength: 10 }).map((s) => `"${s.replace(/"/g, '\\"')}"`),
  fc.array(action, { minLength: 1, maxLength: 3 }).map((a) => `"${a.join(";").replace(/"/g, "")}"`),
  fc.string({ maxLength: 8 }).filter((s) => !/\s/.test(s)),
);

const quotedText = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.tuple(fc.string({ maxLength: 8 }), exprish, fc.string({ maxLength: 8 })).map(([a, e, b]) => `${a}{${e}}${b}`),
).map((s) => `"${s.replace(/\\/g, "").replace(/"/g, '\\"')}"`);

const containerTypes = ALL_COMPONENTS.filter((c) => c.children).map((c) => c.type);

/** One element line without indentation; containers are picked more often so screens have depth. */
const elementBody = fc
  .tuple(
    fc.oneof({ weight: 2, arbitrary: fc.constantFrom(...containerTypes) }, { weight: 3, arbitrary: fc.constantFrom(...types) }),
    fc.option(quotedText, { freq: 2 }),
    fc.array(fc.tuple(fc.constantFrom(...propNames), propValue), { maxLength: 4 }),
  )
  .map(([type, text, props]) => [type, text ?? "", ...props.map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(" "));

/** each lines, which need list-valued items= to do anything, so they get their own generator. */
const eachLine = fc
  .tuple(
    fc.oneof(fc.constantFrom(...names), exprish.map((e) => `{${e}}`), fc.constantFrom("[1, 2, 3]", "{[{text: 'a'}, {text: 'b'}]}", "{todos}", "{t.lines}")),
    fc.option(fc.constantFrom(...names, "constructor", "__proto__", "1x")),
    fc.option(fc.constantFrom(...names)),
    fc.option(fc.oneof(fc.constantFrom("{t.text}", "{item}", "{i}", "{t}", "t.done"), exprish.map((e) => `{${e}}`))),
  )
  .map(([items, as, index, key]) => ["each", `items=${items}`, as && `as=${as}`, index && `index=${index}`, key && `key=${key}`].filter(Boolean).join(" "));

/** List and record literals, well-formed or slightly broken, as a model might write them. */
const dataLiteral: fc.Arbitrary<string> = fc.letrec<{ d: string }>((tie) => ({
  d: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom("1", "-2.5", "'a b'", '"x"', "true", "null", "[]", "{}"),
    fc.array(tie("d"), { maxLength: 4 }).map((xs) => `[${xs.join(", ")}]`),
    fc.array(fc.tuple(fc.constantFrom("text", "done", "price", "'unit price'", "__proto__", "constructor"), tie("d")), { maxLength: 4 })
      .map((kv) => `{${kv.map(([k, v]) => `${k}: ${v}`).join(", ")}}`),
  ),
})).d;
const brokenLiteral = fc.tuple(dataLiteral, fc.nat(), fc.constantFrom("", "]", "}", ",", ":", "'", "[", "{")).map(([d, i, c]) => {
  const at = d.length ? i % d.length : 0;
  return d.slice(0, at) + c + d.slice(at + 1);
});

const stateLine = fc
  .array(fc.tuple(fc.constantFrom(...names), fc.oneof(atom, fc.constant("{x}"), dataLiteral, brokenLiteral)), { minLength: 1, maxLength: 4 })
  .map((pairs) => "state " + pairs.map(([k, v]) => `${k}=${v}`).join(" "));

const otherLine = fc.oneof(
  { weight: 2, arbitrary: stateLine },
  { weight: 1, arbitrary: fc.constantFrom("", "# comment", "\t\tcard", "   ", "\"", "{", "if=done", "if={count > 1}", "if=", "if={t.done} if=a", "  if={item}") },
  { weight: 1, arbitrary: fc.string({ maxLength: 30 }) },
);

/**
 * Specs shaped like real ones: each element is indented at most one level
 * deeper than the previous one, with occasional odd indents and junk lines.
 */
const grammarSpec = fc
  .array(
    fc.tuple(fc.constantFrom(-3, -1, 0, 0, 1, 1, 1), fc.integer({ min: 0, max: 19 }).map((n) => (n === 0 ? " " : "")), fc.oneof({ weight: 6, arbitrary: elementBody.map((b) => ({ el: b })) }, { weight: 1, arbitrary: eachLine.map((b) => ({ el: b })) }, { weight: 1, arbitrary: otherLine.map((o) => ({ other: o })) })),
    { maxLength: 40, size: "+1" },
  )
  .map((items) => {
    let depth = 0;
    const out: string[] = [];
    for (const [delta, odd, item] of items) {
      if ("other" in item) { out.push(item.other); continue; }
      depth = Math.max(0, Math.min(depth + delta, depth + 1));
      out.push(" ".repeat(depth * 2) + odd + item.el);
    }
    return out.join("\n") + "\n";
  });

const mutatedSpec = fc
  .tuple(fc.constantFrom(...corpus.map(([, s]) => s)), fc.array(fc.tuple(fc.nat(), fc.constantFrom("delete", "insert", "swap"), fc.string({ minLength: 1, maxLength: 3 })), { minLength: 1, maxLength: 8 }))
  .map(([spec, edits]) => {
    let s = spec;
    for (const [pos, kind, chunk] of edits) {
      const i = s.length ? pos % s.length : 0;
      if (kind === "delete") s = s.slice(0, i) + s.slice(i + chunk.length);
      else if (kind === "insert") s = s.slice(0, i) + chunk + s.slice(i);
      else if (s.length > 1) { const j = (i + 1) % s.length; const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!]; s = c.join(""); }
    }
    return s;
  });

// ---------------------------------------------------------------- checks

/** A plain value, or a list or record made by Loom's data module (never a host object). */
const isValue = (v: unknown): v is Value => isData(v);

function checkParse(spec: string): void {
  const r = parse(spec, registry);
  const lineCount = spec.split("\n").length;
  for (const d of r.diagnostics) {
    expect(Number.isInteger(d.line) && d.line >= 1 && d.line <= lineCount, `diagnostic line ${d.line}`).toBe(true);
    expect(["error", "warning"]).toContain(d.severity);
    expect(d.message.trim()).not.toBe("");
  }
  for (const s of r.state) expect(isValue(s.value)).toBe(true);
}

/** Render, lay out at two widths, then press everything and Tab around. Nothing may throw. */
function checkEngine(spec: string): void {
  const ui = render(spec, { components: ALL_COMPONENTS, width: 360 });
  const finite = (root: Box | null) => {
    if (root) walkBoxes(root, (b) => { for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v)).toBe(true); });
  };
  finite(ui.loom.boxes);
  for (const h of [...ui.hits]) {
    ui.click(h.box.x + h.box.w / 2, h.box.y + h.box.h / 2);
  }
  for (let i = 0; i < 4; i++) {
    ui.tab();
    for (const k of ["ArrowRight", "End", "PageDown", "Home"]) ui.key(k);
  }
  ui.key("Enter");
  const first = ui.hits[0];
  if (first) {
    const b = first.box;
    // A drag that wanders off the canvas, over whatever is pressable first.
    ui.canvas.dispatch("pointerdown", { clientX: b.x + 1, clientY: b.y + 1, pointerId: 1 });
    ui.canvas.dispatch("pointermove", { clientX: b.x + b.w * 3, clientY: -50 });
    ui.canvas.dispatch("pointerup", { clientX: -20, clientY: b.y });
    ui.loom.renderNow();
  }
  ui.setSpec(spec);
  finite(ui.loom.boxes);
  for (const v of Object.values(ui.state)) expect(isValue(v)).toBe(true);
  ui.destroy();
}

// ---------------------------------------------------------------- properties

describe("parser", () => {
  it("never throws on arbitrary text", () => {
    fc.assert(fc.property(fc.string({ maxLength: 200, unit: "binary" }), checkParse), opts);
  });

  it("never throws on grammar-shaped specs", () => {
    fc.assert(fc.property(grammarSpec, checkParse), opts);
  });

  it("never throws on damaged real specs", () => {
    fc.assert(fc.property(mutatedSpec, checkParse), opts);
  });

  it("survives very deep nesting and very long lines", () => {
    const deep = Array.from({ length: 2000 }, (_, i) => " ".repeat(i * 2) + "column").join("\n") + "\n";
    expect(parse(deep, registry).nodeCount).toBe(MAX_DEPTH);
    checkParse(`text "${"x".repeat(100_000)}"\n`);
    checkParse(`text "{${"(".repeat(5000)}1${")".repeat(5000)}}"\n`);
  });
});

describe("engine", () => {
  it("renders a spec nested thousands of levels deep, keeping what comes after it", () => {
    for (const depth of [MAX_DEPTH, MAX_DEPTH + 1, 2000, 10_000]) {
      const deep = Array.from({ length: depth }, (_, i) => " ".repeat(i * 2) + "card").join("\n");
      const ui = render(`${deep}\ntext "After"\n`, { components: ALL_COMPONENTS });
      expect(ui.text()).toContain("After");
      expect(ui.diagnostics.length, `depth ${depth}`).toBe(depth > MAX_DEPTH ? 1 : 0);
      ui.destroy();
    }
  });

  it("never throws rendering and using grammar-shaped specs", () => {
    fc.assert(fc.property(grammarSpec, checkEngine), { numRuns: Math.ceil(RUNS / 2) });
  });

  it("never throws rendering and using damaged real specs", () => {
    fc.assert(fc.property(mutatedSpec, checkEngine), { numRuns: Math.ceil(RUNS / 2) });
  });
});

describe("expressions", () => {
  // Scalars plus real Loom data, as a spec's state would hold.
  const data = new Store();
  for (const [k, v] of Object.entries({ a: 2, b: "s", count: 0, done: true, price: 9.5, qty: null, x: -1 })) data.set(k, v);
  data.set("todos", [{ text: "Pack", done: false, price: 3 }, { text: "Go", done: true, lines: [1, 2] }] as unknown as Value);
  data.set("lines", [1, "two", null] as unknown as Value);
  const scope = data.scope;

  it("never throw and only produce plain values", () => {
    fc.assert(
      fc.property(fc.oneof(expr, fc.string({ maxLength: 60, unit: "binary" })), (src) => {
        const r = evaluate(src, scope);
        if (r.ok) expect(isValue(r.value), `${src} → ${typeof r.value}`).toBe(true);
        else expect(typeof r.error).toBe("string");
        expect(typeof interpolate(`{${src}}`, scope)).toBe("string");
      }),
      { numRuns: RUNS * 5 },
    );
  });

  it("can't use anything outside the whitelist as a function", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z_]\w{0,15}$/), (name) => {
        const r = evaluate(`${name}(1)`, scope);
        const allowed = ["min", "max", "round", "floor", "ceil", "abs", "fixed", "len", "count", "sum", "avg", "join", "includes"].includes(name);
        expect(r.ok || !allowed).toBe(true);
        if (!allowed) expect(r.ok).toBe(false);
      }),
      opts,
    );
  });
});

describe("data", () => {
  it("host values become data or a DataError, never anything else", () => {
    fc.assert(
      fc.property(fc.anything({ withNullPrototype: true, withBoxedValues: true, withMap: true, withSet: true, withDate: true, withTypedArray: true, withSparseArray: true }), (v) => {
        try {
          expect(isData(toData(v))).toBe(true);
        } catch (e) {
          expect(e).toBeInstanceOf(DataError);
        }
      }),
      { numRuns: RUNS * 3 },
    );
  });

  it("literals parse to data or an error message, and never touch Object.prototype", () => {
    fc.assert(
      fc.property(fc.oneof(dataLiteral, brokenLiteral, fc.string({ maxLength: 40 })), (src) => {
        const r = parseData(src);
        if ("value" in r) expect(isData(r.value)).toBe(true);
        else expect(r.error.trim()).not.toBe("");
        expect(Object.keys(Object.prototype)).toEqual([]);
      }),
      { numRuns: RUNS * 3 },
    );
  });
});

describe("actions", () => {
  it("never throw when parsed and run, and only store plain values", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 5 }).map((a) => a.join(";")), (src) => {
        const r = parseActions(src);
        if ("error" in r) { expect(r.error.trim()).not.toBe(""); return; }
        const state = new Map<string, Value>([["a", 1], ["done", false]]);
        runActions(r.actions, {
          scope: (k) => state.get(k),
          set: (k, v) => { expect(isValue(v)).toBe(true); state.set(k, v); },
          emit: (_n, v) => { expect(v === undefined || isValue(v)).toBe(true); },
        });
      }),
      opts,
    );
  });
});
