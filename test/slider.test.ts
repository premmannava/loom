import { describe, expect, it } from "vitest";
import { render } from "../src/testing";

// At width 440 with padding 20, the slider spans x 20..420; the thumb's centre travels 30..410.
const spec = `state price=100 n=0\nslider "Up to \${price}" bind=price min=0 max=380 step=10 on=inc:n\n`;
const at = (value: number) => 30 + (value / 380) * 380;

describe("slider", () => {
  it("follows a drag, snapping to steps, and runs on= once when let go", () => {
    const ui = render(spec, { width: 440 });
    ui.drag("slider", at(253));
    expect(ui.state.price).toBe(250);
    expect(ui.state.n).toBe(1);
    expect(ui.text()).toContain("Up to $250");
  });

  it("jumps to where the track is pressed", () => {
    const ui = render(spec, { width: 440 });
    const y = ui.hits[0]!.box.y + 16;
    ui.click(at(300), y);
    expect(ui.state.price).toBe(300);
  });

  it("stays within its range when dragged past the ends", () => {
    const ui = render(spec, { width: 440 });
    ui.drag("slider", 2000);
    expect(ui.state.price).toBe(380);
    ui.drag("slider", -500);
    expect(ui.state.price).toBe(0);
  });

  it("keeps following the pointer outside the canvas, and doesn't press anything on release", () => {
    const ui = render(`state v=50 pressed=false\nslider bind=v\nbutton "Below" on=set:pressed:true\n`, { width: 440 });
    const button = ui.find("button").box!;
    ui.drag("slider", button.x + 10, button.y + 10);
    expect(ui.state.pressed).toBe(false);
    expect(ui.loom.hitRegions.length).toBe(2);
  });

  it("moves with the arrow, page, home and end keys, running on= each time", () => {
    const ui = render(spec, { width: 440 });
    ui.tab();
    ui.key("ArrowRight");
    expect(ui.state.price).toBe(110);
    ui.key("ArrowDown");
    ui.key("ArrowLeft");
    expect(ui.state.price).toBe(90);
    ui.key("PageUp");
    expect(ui.state.price).toBe(130);
    ui.key("End");
    expect(ui.state.price).toBe(380);
    ui.key("Home");
    expect(ui.state.price).toBe(0);
    expect(ui.state.n).toBe(6);
  });

  it("leaves other keys alone", () => {
    const ui = render(spec, { width: 440 });
    ui.tab();
    ui.key("x");
    ui.key("Enter");
    expect(ui.state).toMatchObject({ price: 100, n: 0 });
  });

  it("handles fractional steps and odd ranges", () => {
    const ui = render(`state w=1\nslider bind=w min=0.5 max=2 step=0.25\n`, { width: 440 });
    ui.tab();
    ui.key("ArrowRight");
    expect(ui.state.w).toBe(1.25);
    ui.drag("slider", 2000);
    expect(ui.state.w).toBe(2);
  });

  it("clamps a value that starts out of range, and survives max below min", () => {
    const ui = render(`state v=999\nslider bind=v min=10 max=5\n`, { width: 440 });
    ui.tab();
    ui.key("ArrowLeft");
    expect(ui.state.v).toBe(10);
  });

  it("ends the drag when the browser cancels the gesture", () => {
    const ui = render(spec, { width: 440 });
    const h = ui.hits[0]!.box;
    ui.canvas.dispatch("pointermove", { clientX: at(100), clientY: h.y + 16 });
    ui.canvas.dispatch("pointerdown", { clientX: at(100), clientY: h.y + 16, pointerId: 1 });
    ui.canvas.dispatch("pointermove", { clientX: at(200), clientY: h.y + 16 });
    ui.canvas.dispatch("pointercancel", {});
    ui.loom.renderNow();
    expect(ui.state).toMatchObject({ price: 200, n: 1 });
    ui.canvas.dispatch("pointermove", { clientX: at(300), clientY: h.y + 16 });
    ui.loom.renderNow();
    expect(ui.state.price).toBe(200);
  });
});
