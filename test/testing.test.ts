import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

describe("render()", () => {
  it("presses a button through the pointer path and updates state", () => {
    const ui = render(`state n=0\nbutton "Add" on=inc:n\n`);
    ui.press({ type: "button", text: "Add" });
    ui.press({ type: "button", text: "Add" });
    expect(ui.state.n).toBe(2);
  });

  it("records emitted actions with their values", () => {
    const ui = render(`state qty=3\nbutton "Order" on="emit:order:{qty * 2}"\n`);
    ui.press("button");
    expect(ui.emitted).toEqual([{ name: "order", value: 6 }]);
  });

  it("toggles a checkbox and shows dependent content", () => {
    const ui = render(`state done=false\ncheck "Done" bind=done\ntext "Well done" if=done\n`);
    expect(ui.isShown({ text: "Well done" })).toBe(false);
    ui.press("check");
    expect(ui.state.done).toBe(true);
    expect(ui.isShown({ text: "Well done" })).toBe(true);
    expect(ui.text()).toContain("Well done");
  });

  it("matches text as written or as shown", () => {
    const ui = render(`state n=1\ntext "Clicked {n} times"\n`);
    expect(ui.find({ text: "Clicked {n} times" }).shownText).toBe("Clicked 1 times");
    expect(ui.find({ text: "Clicked 1 times" }).node.line).toBe(2);
    expect(ui.findAll({ text: /Clicked/ })).toHaveLength(1);
  });

  it("explains why an element can't be pressed", () => {
    const ui = render(`state busy=true hide=false\nbutton "Save" disabled=busy\nbutton "Gone" if=hide\ntext "Label"\n`);
    expect(() => ui.press({ text: "Save" })).toThrow(/isn't pressable/);
    expect(() => ui.press({ text: "Gone" })).toThrow(/hidden/);
    expect(() => ui.press({ text: "Label" })).toThrow(/isn't pressable/);
    expect(() => ui.press({ text: "Nope" })).toThrow(/No element matches/);
  });

  it("refuses ambiguous queries", () => {
    const ui = render(`button "A"\nbutton "B"\n`);
    expect(() => ui.find("button")).toThrow(/2 elements match .*line 1, line 2/);
  });

  it("moves focus with Tab and activates with Enter", () => {
    const ui = render(`state a=0 b=0\nbutton "A" on=inc:a\nbutton "B" on=inc:b\n`);
    ui.tab();
    expect(ui.focused?.text).toBe("A");
    ui.tab();
    expect(ui.focused?.text).toBe("B");
    ui.key("Enter");
    expect(ui.state).toMatchObject({ a: 0, b: 1 });
    ui.tab(true);
    expect(ui.focused?.text).toBe("A");
  });

  it("streams a spec chunk by chunk", () => {
    const ui = render("");
    const spec = `state n=5\ncard\n  text "Count {n}"\n  button "Up" on=inc:n\n`;
    ui.stream(spec.match(/.{1,3}/gs)!);
    expect(ui.diagnostics).toEqual([]);
    ui.press("button");
    expect(ui.state.n).toBe(6);
  });

  it("paints with the theme it was given", () => {
    const light = render(`button "Go"\n`, { theme: lightTheme });
    const dark = render(`button "Go"\n`, { theme: darkTheme });
    const fills = (ui: typeof light) => ui.drawOps.filter((d) => d.op === "fill").map((d) => d.fillStyle);
    expect(fills(light)).toContain(lightTheme.colors.accent);
    expect(fills(dark)).toContain(darkTheme.colors.accent);
  });

  it("keeps user changes when the spec is replaced", () => {
    const ui = render(`state n=0\nbutton "Add" on=inc:n\n`);
    ui.press("button");
    ui.setSpec(`state n=0\ntext "n is {n}"\n`);
    expect(ui.text()).toContain("n is 1");
    ui.setSpec(`state n=0\ntext "n is {n}"\n`, { resetState: true });
    expect(ui.text()).toContain("n is 0");
  });
});
