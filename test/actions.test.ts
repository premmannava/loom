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

  it("parses go, back and notify", () => {
    expect(parseActions("go:cart;back")).toEqual({ actions: [{ op: "go", screen: "cart" }, { op: "back" }] });
    expect(parseActions("notify:'Saved; all {n} done'")).toEqual({ actions: [{ op: "notify", message: "Saved; all {n} done" }] });
    expect(parseActions(`notify:Saved`)).toEqual({ actions: [{ op: "notify", message: "Saved" }] });
  });

  it("fills a notify message from state when it runs", () => {
    const messages: string[] = [];
    const parsed = parseActions("inc:n;notify:'Added {n} items'");
    if ("error" in parsed) throw new Error(parsed.error);
    const store = new Store();
    store.set("n", 1);
    runActions(parsed.actions, { scope: store.scope, set: (k, v) => store.set(k, v), emit: () => {}, notify: (m) => messages.push(m) });
    expect(messages).toEqual(["Added 2 items"]);
  });

  it("treats an apostrophe inside a value as a character", () => {
    expect(run("set:msg:it's;inc:n", { n: 0 }).state).toEqual({ msg: "it's", n: 1 });
  });

  it("does nothing for go, back and notify when the host has no screens", () => {
    expect(run("go:cart;back;notify:hi;inc:n", { n: 0 }).state.n).toBe(1);
  });

  it("explains bad actions", () => {
    expect(parseActions("back:home")).toEqual({ error: expect.stringMatching(/back takes no target/) });
    expect(parseActions("go:a:b")).toEqual({ error: expect.stringMatching(/go takes one screen name/) });
    expect(parseActions("go:my-screen")).toEqual({ error: expect.stringMatching(/not a valid name/) });
    expect(parseActions("notify:''")).toEqual({ error: expect.stringMatching(/notify needs a message/) });
    expect(parseActions("notify:'{a +}'")).toEqual({ error: expect.stringMatching(/In action/) });
    expect(parseActions("jump:x")).toEqual({ error: expect.stringMatching(/Unknown action "jump"/) });
    expect(parseActions("set:x")).toEqual({ error: expect.stringMatching(/set needs a value/) });
    expect(parseActions("inc")).toEqual({ error: expect.stringMatching(/needs a target/) });
  });
});
