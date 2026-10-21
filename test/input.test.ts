/**
 * Text input: the input component and typing through the editor host. In
 * Node, loom-ui/testing's fake host stands in for the browser's <input>.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("the field", () => {
  it("shows its label, and its value or placeholder", () => {
    const ui = render(`state name="" city="Phoenix"
input "Your name" bind=name placeholder="e.g. Ada"
input "City" bind=city
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["Your name", "e.g. Ada", "City", "Phoenix"]);
  });

  it("shows a password as dots, and cuts long values with an ellipsis", () => {
    const ui = render(`state pw="hunter22" note="${"a very long note ".repeat(20)}"
input "Password" bind=pw kind=password
input "Note" bind=note
`, { width: 320 });
    expect(ui.text()).toContain("••••••••");
    const note = ui.text().find((t) => t.startsWith("a very long note"))!;
    expect(note.endsWith("…")).toBe(true);
    expect(note.length).toBeLessThan(80);
  });

  it("is taller with a label than without", () => {
    const ui = render(`state a="" b=""\ninput "Label" bind=a\ninput bind=b placeholder="Search"\n`);
    const [a, b] = ui.findAll("input").map((f) => f.box!.h);
    expect(a!).toBeGreaterThan(b!);
  });

  it("checks its props", () => {
    const reg = new Registry(coreComponents);
    expect(parse(`input "x"\n`, reg).diagnostics.map((d) => d.message)).toEqual([`"input" needs bind=`]);
    expect(parse(`state a=""\ninput bind=a kind=phone\n`, reg).diagnostics[0]!.message).toMatch(/kind should be one of text, email, number, password, search/);
  });
});

describe("typing", () => {
  it("writes every keystroke, so the rest of the screen follows", () => {
    const ui = render(`state name=""
input "Name" bind=name
text "Hello {name}!"
`);
    ui.type("input", "Ada");
    expect(ui.state.name).toBe("Ada");
    expect(ui.text()).toContain("Hello Ada!");
    expect(ui.editor?.value).toBe("Ada");
    ui.type("input", "Bo", { replace: true });
    expect(ui.state.name).toBe("Bo");
  });

  it("hides the canvas's own text while the text box is over the field", () => {
    const ui = render(`state name="Ada"\ninput "Name" bind=name\n`);
    expect(ui.text()).toContain("Ada");
    ui.press("input");
    expect(ui.editor).not.toBeNull();
    expect(ui.text()).not.toContain("Ada");
    ui.key("Escape");
    expect(ui.editor).toBeNull();
    expect(ui.text()).toContain("Ada");
  });

  it("runs on= with Enter, and keeps typing after the action clears the field", () => {
    const ui = render(`state task="" todos=[]
input "New item" bind=task on="add:todos:{task};set:task:''"
text "{plural(len(todos), 'item')}"
`);
    ui.type("input", "Milk");
    ui.key("Enter");
    expect(ui.state.todos).toEqual(["Milk"]);
    expect(ui.state.task).toBe("");
    expect(ui.editor?.value).toBe("");
    ui.type("input", "Eggs");
    ui.key("Enter");
    expect(ui.state.todos).toEqual(["Milk", "Eggs"]);
    expect(ui.text()).toContain("2 items");
  });

  it("writes into an item inside each", () => {
    const ui = render(`state people=[{name: "Ada"}, {name: "Grace"}]
each items=people as=p
  input "Name" bind=p.name
`);
    ui.type({ id: "3:input#1" }, " Hopper");
    expect(json(ui.state.people)).toEqual([{ name: "Ada" }, { name: "Grace Hopper" }]);
  });

  it("writes numbers for kind=number, null when empty, and keeps what's typed on the way", () => {
    const ui = render(`state qty=null\ninput "Qty" bind=qty kind=number\ntext "{qty == null ? 'none' : qty * 2}"\n`);
    ui.type("input", "1.");
    expect(ui.state.qty).toBe(1);
    expect(ui.editor?.value).toBe("1.");
    ui.type("input", "5");
    expect(ui.state.qty).toBe(1.5);
    expect(ui.text()).toContain("3");
    ui.type("input", "-", { replace: true });
    expect(ui.state.qty).toBe(null);
    expect(ui.editor?.value).toBe("-");
  });

  it("stops at max characters", () => {
    const ui = render(`state code=""\ninput "Code" bind=code max=4\n`);
    ui.type("input", "123456");
    expect(ui.state.code).toBe("1234");
  });

  it("can't be typed in while disabled", () => {
    const ui = render(`state a="" locked=true\ninput "A" bind=a disabled=locked\n`);
    expect(() => ui.type("input", "x")).toThrow(/isn't pressable/);
  });

  it("stops typing when the field disappears", () => {
    const ui = render(`state a="" show=true\ninput "A" bind=a if=show on=set:show:false\n`);
    ui.type("input", "x");
    ui.key("Enter");
    expect(ui.editor).toBeNull();
  });
});

describe("the keyboard", () => {
  it("starts typing when Tab reaches a field, and Tab moves on to the next element", () => {
    const ui = render(`state first="" last="" saved=false
input "First name" bind=first
input "Last name" bind=last
button "Save" on=set:saved:true
`);
    ui.tab();
    expect(ui.editor?.label).toBe("First name");
    ui.type({ type: "input", text: "First name" }, "Ada");
    ui.tab();
    expect(ui.editor?.label).toBe("Last name");
    ui.type({ type: "input", text: "Last name" }, "Lovelace");
    ui.tab();
    expect(ui.editor).toBeNull();
    expect(ui.focused?.type).toBe("button");
    ui.key("Enter");
    expect(ui.state).toMatchObject({ first: "Ada", last: "Lovelace", saved: true });
    ui.tab(true);
    expect(ui.editor?.label).toBe("Last name");
  });

  it("lets Escape stop typing and keeps focus on the field", () => {
    const ui = render(`state a=""\ninput "A" bind=a\nbutton "B"\n`);
    ui.tab();
    ui.key("Escape");
    expect(ui.editor).toBeNull();
    expect(ui.focused?.type).toBe("input");
    expect(ui.canvas.focused).toBe(true);
  });
});
