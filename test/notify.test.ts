import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

describe("notify:", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); });
  afterEach(() => { vi.useRealTimers(); });

  const spec = `state n=0\nbutton "Add" on="inc:n;notify:'Added {n}; thanks'"\n`;

  it("shows a message filled in from state after the earlier actions ran", () => {
    const ui = render(spec);
    ui.press("button");
    expect(ui.loom.notification).toBe("Added 1; thanks");
    expect(ui.text()).toContain("Added 1; thanks");
  });

  it("tells the host", () => {
    const ui = render(spec);
    const seen: string[] = [];
    ui.loom.on("notify", (e) => seen.push(e.text));
    ui.press("button");
    expect(seen).toEqual(["Added 1; thanks"]);
  });

  it("disappears after a few seconds", () => {
    const ui = render(spec);
    ui.press("button");
    vi.advanceTimersByTime(2900);
    ui.loom.renderNow();
    expect(ui.text()).toContain("Added 1; thanks");
    vi.advanceTimersByTime(200);
    ui.loom.renderNow();
    expect(ui.loom.notification).toBeNull();
    expect(ui.text()).not.toContain("Added 1; thanks");
  });

  it("replaces the current message with a newer one", () => {
    const ui = render(spec);
    ui.press("button");
    vi.advanceTimersByTime(2000);
    ui.press("button");
    vi.advanceTimersByTime(2000);
    ui.loom.renderNow();
    expect(ui.loom.notification).toBe("Added 2; thanks");
    expect(ui.text().filter((t) => t.startsWith("Added"))).toEqual(["Added 2; thanks"]);
  });

  it("uses theme colors, inverted, and wraps long messages to at most three lines", () => {
    const ui = render(`button "Go" on="notify:'${"word ".repeat(80)}'"\n`, { width: 360 });
    ui.press("button");
    const ops = ui.drawOps;
    // The button's own label is white too in the light theme, so leave it out.
    const toastText = ops.filter((d) => d.op === "fillText" && d.fillStyle === lightTheme.colors.surface && d.args[0] !== "Go");
    expect(toastText.length).toBe(3);
    expect(ops.some((d) => d.op === "fill" && d.fillStyle === lightTheme.colors.ink)).toBe(true);
  });

  it("can be shown by the host", () => {
    const ui = render(`text "Hi"\n`);
    ui.loom.notify("Saved");
    ui.loom.renderNow();
    expect(ui.text()).toContain("Saved");
  });
});
