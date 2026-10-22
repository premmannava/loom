import { describe, expect, it } from "vitest";
import { eventMessage, nextChunk, MAX_MESSAGE_CHARS } from "../src/ui/messages";

describe("view helpers", () => {
  it("describes an emitted action with its value and the interface's state", () => {
    const m = eventMessage("submit_order", "large", { size: "large", qty: 2 });
    expect(m).toBe('[SayShape interface] I pressed "submit_order" with the value "large".\nCurrent values in the interface: {"size":"large","qty":2}');
  });

  it("leaves out the value when there is none", () => {
    expect(eventMessage("refresh", undefined, {})).toMatch(/^\[SayShape interface\] I pressed "refresh"\.\n/);
  });

  it("caps long messages", () => {
    const state = { rows: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `row ${i}` })) };
    const m = eventMessage("save", undefined, state as never);
    expect(m.length).toBe(MAX_MESSAGE_CHARS);
    expect(m.endsWith("…")).toBe(true);
  });

  it("appends to a growing stream and restarts when the text changes", () => {
    expect(nextChunk("", "card\n")).toEqual({ restart: false, add: "card\n" });
    expect(nextChunk("card\n", "card\n  text \"a\"\n")).toEqual({ restart: false, add: '  text "a"\n' });
    expect(nextChunk("card\n  tex", "column\n")).toEqual({ restart: true, add: "column\n" });
    expect(nextChunk("card\n", "card\n")).toEqual({ restart: false, add: "" });
  });
});
