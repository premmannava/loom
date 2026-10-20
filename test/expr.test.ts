import { describe, expect, it } from "vitest";
import { evaluate, interpolate, identifiers, splitTemplate } from "../src/expr";

const scope = (vals: Record<string, unknown>) => (k: string) => vals[k] as never;
const ev = (src: string, vals: Record<string, unknown> = {}) => evaluate(src, scope(vals));

describe("expressions", () => {
  it("does arithmetic with precedence", () => {
    expect(ev("1 + 2 * 3")).toEqual({ ok: true, value: 7 });
    expect(ev("(1 + 2) * 3")).toEqual({ ok: true, value: 9 });
    expect(ev("10 % 4 - -1")).toEqual({ ok: true, value: 3 });
  });

  it("reads state", () => {
    expect(ev("days * hikers * 3", { days: 2, hikers: 3 })).toEqual({ ok: true, value: 18 });
  });

  it("handles logic and ternaries", () => {
    expect(ev("a && b || c", { a: true, b: false, c: true })).toEqual({ ok: true, value: true });
    expect(ev("gift ? 4 : 0", { gift: false })).toEqual({ ok: true, value: 0 });
    expect(ev("x > 1 ? 'big' : x == 1 ? 'one' : 'small'", { x: 1 })).toEqual({ ok: true, value: "one" });
  });

  it("concatenates strings", () => {
    expect(ev("'$' + price", { price: 24 })).toEqual({ ok: true, value: "$24" });
  });

  it("calls whitelisted functions", () => {
    expect(ev("round(10 / 3, 2)")).toEqual({ ok: true, value: 3.33 });
    expect(ev("max(a, 4)", { a: 9 })).toEqual({ ok: true, value: 9 });
  });

  it("rejects anything that could reach JavaScript", () => {
    for (const bad of ["alert(1)", "constructor.constructor('x')()", "window", "this", "a.b", "x = 1", "`t`"]) {
      expect(ev(bad, { a: { b: 1 } }).ok, bad).toBe(false);
    }
  });

  it("doesn't treat inherited object members as functions", () => {
    const names = Object.getOwnPropertyNames(Object.prototype);
    expect(names).toContain("__defineGetter__");
    for (const name of names) {
      const r = ev(`${name}('x', 1)`);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error, name).toMatch(/Unknown function/);
    }
  });

  it("can't change the whitelisted functions from a spec", () => {
    ev("__defineGetter__('min', __lookupGetter__('__proto__'))");
    expect(ev("min(3, 1, 2)")).toEqual({ ok: true, value: 1 });
  });

  it("ignores anything a scope returns that isn't a plain value", () => {
    for (const name of ["__proto__", "constructor", "toString"]) {
      const r = evaluate(name, (k) => ({} as Record<string, never>)[k]);
      expect(r.ok, name).toBe(false);
    }
    expect(ev("obj", { obj: { a: 1 } }).ok).toBe(false);
  });

  it("reports unknown state instead of guessing", () => {
    const r = ev("missing + 1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing/);
  });

  it("interpolates templates", () => {
    expect(interpolate("Total {qty * price} for {qty}", scope({ qty: 2, price: 5 }))).toBe("Total 10 for 2");
    expect(interpolate("Unknown {nope}", scope({}))).toBe("Unknown —");
    expect(interpolate("no braces", scope({}))).toBe("no braces");
  });

  it("splits templates with nested quotes and braces", () => {
    expect(splitTemplate("a {b ? '}' : 'c'} d")).toEqual([{ text: "a " }, { expr: "b ? '}' : 'c'" }, { text: " d" }]);
  });

  it("lists identifiers", () => {
    expect(identifiers("a + b * round(c)").sort()).toEqual(["a", "b", "c"]);
  });
});
