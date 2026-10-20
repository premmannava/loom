import { describe, expect, it } from "vitest";
import type { ComponentDef } from "../src/component";
import { coreComponents } from "../src/components";
import { render } from "../src/testing";

/** A test component with two separately pressable halves. */
const pair: ComponentDef = {
  type: "pair",
  category: "input",
  description: "Two halves, each pressable on its own.",
  props: { bind: { type: "state", required: true, description: "Receives the pressed half." } },
  layout(box) {
    box.h = 40;
  },
  paint(box, ctx) {
    const half = box.w / 2;
    for (const [i, name] of ["left", "right"].entries()) {
      ctx.addHit({ node: box.node, x: box.x + i * half, y: box.y, w: half, h: box.h, children: [] }, { detail: name });
    }
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind")!;
    ctx.set(key, String(ctx.target.detail));
  },
};

const components = [...coreComponents, pair];

describe("keyboard focus", () => {
  it("can't activate a button that became disabled while focused", () => {
    const ui = render(`state placed=false\nbutton "Place order" on="set:placed:true;emit:order" disabled=placed\n`);
    ui.tab();
    ui.key("Enter");
    ui.key("Enter");
    ui.key("Enter");
    expect(ui.emitted).toHaveLength(1);
    expect(ui.focused).toBeNull();
  });

  it("loses focus when the focused element is hidden", () => {
    const ui = render(`state show=true\nbutton "Hide me" on=set:show:false if=show\n`);
    ui.tab();
    ui.key("Enter");
    expect(ui.state.show).toBe(false);
    expect(ui.focused).toBeNull();
  });

  it("gives each pressable part of an element its own Tab stop", () => {
    const ui = render(`state got=none\nbutton "Before"\npair bind=got\nbutton "After"\n`, { components });
    const stops: string[] = [];
    for (let i = 0; i < 4; i++) {
      ui.tab();
      const f = ui.loom.focus;
      stops.push(f ? `${f.node.type}${f.detail ? ":" + String(f.detail) : ""}` : "none");
    }
    expect(stops).toEqual(["button", "pair:left", "pair:right", "button"]);
  });

  it("activates the focused part, and the focus ring follows the part", () => {
    const ui = render(`state got=none\npair bind=got\n`, { components, width: 400 });
    ui.tab();
    ui.tab();
    expect(ui.loom.focus?.box.x).toBeGreaterThan(150);
    ui.key("Enter");
    expect(ui.state.got).toBe("right");
  });

  it("presses the part under the pointer", () => {
    const ui = render(`state got=none\npair bind=got\n`, { components, width: 400 });
    const box = ui.find("pair").box!;
    ui.click(box.x + 10, box.y + 10);
    expect(ui.state.got).toBe("left");
  });
});
