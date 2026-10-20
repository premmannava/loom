import { describe, expect, it } from "vitest";
import { parseActions, runActions } from "../src/actions";
import { Store } from "../src/state";
import type { Value } from "../src/types";

function run(src: string, initial: Record<string, Value>) {
  const store = new Store();
  Object.entries(initial).forEach(([k, v]) => store.set(k, v));
  const emitted: Array<[string, Value | undefined]> = [];
  const parsed = parseActions(src);
  if ("error" in parsed) throw new Error(parsed.error);
  runActions(parsed.actions, { scope: store.scope, set: (k, v) => store.set(k, v), emit: (n, v) => emitted.push([n, v]) });
  return { state: store.snapshot(), emitted };
}

describe("actions", () => {
  it("increments and decrements, never below zero", () => {
    expect(run("inc:n", { n: 1 }).state.n).toBe(2);
    expect(run("inc:n:5", { n: 1 }).state.n).toBe(6);
    expect(run("dec:n:5", { n: 3 }).state.n).toBe(0);
  });

  it("toggles and sets literals or expressions", () => {
    expect(run("toggle:on", { on: false }).state.on).toBe(true);
    expect(run("set:mode:dark", {}).state.mode).toBe("dark");
    expect(run("set:total:{a * b}", { a: 3, b: 4 }).state.total).toBe(12);
  });

  it("runs several actions in order", () => {
    const r = run("set:step:2;inc:step;emit:next:{step}", {});
    expect(r.state.step).toBe(3);
    expect(r.emitted).toEqual([["next", 3]]);
  });

  it("explains bad actions", () => {
    expect(parseActions("jump:x")).toEqual({ error: expect.stringMatching(/Unknown action "jump"/) });
    expect(parseActions("set:x")).toEqual({ error: expect.stringMatching(/set needs a value/) });
    expect(parseActions("inc")).toEqual({ error: expect.stringMatching(/needs a target/) });
  });
});
