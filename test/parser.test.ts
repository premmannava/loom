import { describe, expect, it } from "vitest";
import { MAX_DEPTH, parse, tokenizeLine } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";

const reg = new Registry(coreComponents);
const p = (src: string, partial = false) => parse(src, reg, { partial });

describe("tokenizeLine", () => {
  it("reads type, text and props", () => {
    expect(tokenizeLine(`button "Add day" on=inc:days variant=secondary`)).toEqual({
      type: "button", text: "Add day", props: { on: "inc:days", variant: "secondary" }, problems: [],
    });
  });

  it("keeps spaces inside braces and quotes", () => {
    const t = tokenizeLine(`stat label="Water (L)" value={days * hikers * 3}`);
    expect(t.props).toEqual({ label: "Water (L)", value: "{days * hikers * 3}" });
  });

  it("supports escaped quotes", () => {
    expect(tokenizeLine(`text "She said \\"hi\\""`).text).toBe(`She said "hi"`);
  });

  it("handles braces inside a bare value", () => {
    expect(tokenizeLine(`button "Go" on=set:total:{a + b}`).props.on).toBe("set:total:{a + b}");
  });

  it("reports stray words", () => {
    expect(tokenizeLine(`text "Hi" bold`).problems[0]).toMatch(/Unexpected "bold"/);
  });
});

describe("parse", () => {
  it("builds a nested tree from indentation", () => {
    const r = p(`card\n  text "A"\n  row\n    button "B"\n    button "C"\ntext "D"\n`);
    expect(r.diagnostics).toEqual([]);
    expect(r.nodeCount).toBe(6);
    const [card, d] = r.root.children;
    expect(card!.type).toBe("card");
    expect(card!.children.map((c) => c.type)).toEqual(["text", "row"]);
    expect(card!.children[1]!.children.map((c) => c.text)).toEqual(["B", "C"]);
    expect(d!.text).toBe("D");
  });

  it("collects state declarations", () => {
    const r = p(`state days=2 name="Ada" done=false\ncard\n`);
    expect(r.state.map((s) => [s.key, s.value])).toEqual([["days", 2], ["name", "Ada"], ["done", false]]);
  });

  it("skips unknown elements and everything nested under them", () => {
    const r = p(`card\n  sparkle "x"\n    text "inside"\n  text "after"\n`);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ line: 2, severity: "error" });
    expect(r.root.children[0]!.children.map((c) => c.text)).toEqual(["after"]);
  });

  it("rejects children under leaf elements", () => {
    const r = p(`text "parent"\n  text "child"\n`);
    expect(r.diagnostics[0]!.message).toMatch(/can't contain anything/);
    expect(r.nodeCount).toBe(1);
  });

  it("warns about unknown props and bad enum values but keeps the element", () => {
    const r = p(`button "Go" colour=red variant=huge\n`);
    expect(r.nodeCount).toBe(1);
    expect(r.diagnostics.map((d) => d.message).join("\n")).toMatch(/no prop "colour"[\s\S]*variant should be one of/);
  });

  it("validates actions and expressions", () => {
    const r = p(`button "Go" on=jump:x\ntext "{a +}"\n`);
    expect(r.diagnostics).toHaveLength(2);
    expect(r.diagnostics[0]!.message).toMatch(/Unknown action "jump"/);
    expect(r.diagnostics[1]!.line).toBe(2);
  });

  it("ignores an unfinished last line while streaming", () => {
    const r = p(`card\n  text "Hello"\n  butt`, true);
    expect(r.nodeCount).toBe(2);
    expect(r.diagnostics).toEqual([]);
  });

  it("skips elements nested more than MAX_DEPTH levels, and only those", () => {
    const lines = Array.from({ length: MAX_DEPTH + 5 }, (_, i) => " ".repeat(i * 2) + "column");
    const r = p([...lines, 'text "Still here"', ""].join("\n"));
    expect(r.nodeCount).toBe(MAX_DEPTH + 1);
    expect(r.diagnostics).toEqual([
      { line: MAX_DEPTH + 1, severity: "error", message: expect.stringMatching(/Nested too deeply \(more than 100 levels\)/) },
    ]);
    expect(r.root.children.at(-1)!.text).toBe("Still here");
  });

  it("counts nesting levels, not indentation width", () => {
    const lines = Array.from({ length: MAX_DEPTH }, (_, i) => " ".repeat(i * 7) + "column");
    expect(p(lines.join("\n") + "\n").diagnostics).toEqual([]);
  });

  it("gives nodes stable ids from line and type", () => {
    const r = p(`card\n  text "A"\n`);
    expect(r.root.children[0]!.children[0]!.id).toBe("2:text");
  });
});

describe("names nothing defines", () => {
  const reg = new Registry(coreComponents);
  const warnings = (spec: string, knownNames?: string[]) => parse(spec, reg, { knownNames }).diagnostics.map((d) => d.message);

  it("warns about a word meant as text but left unquoted", () => {
    expect(warnings(`state late=true\nbadge "Late" tone={late ? bad : 'good'}\n`)).toEqual([
      `"bad" isn't state or a loop variable, so it shows as nothing. To show it as text, quote it: 'bad'. To use state, declare it: state bad=…`,
    ]);
  });

  it("accepts state that is declared, written by bind= or an action, set by the engine, or supplied by the app", () => {
    expect(warnings(`text "Picked: {picked}" if=picked
button "Pick" on="set:picked:'x'"
accordion "More" bind=open
  text "{open}"
text "{screen}"
`)).toEqual([]);
    expect(warnings(`text "{products}"\n`)).toHaveLength(1);
    expect(warnings(`text "{products}"\n`, ["products"])).toEqual([]);
  });
});

describe("code where an element should be", () => {
  it("says Loom has no JSX and points to each", () => {
    const r = parse(`state xs=[1]\nlist\n  {xs.map(x => <list-item>{x}</list-item>)}\n  <list-item>One</list-item>\n  list-item "Kept"\n`, new Registry(coreComponents));
    expect(r.diagnostics.map((d) => d.line)).toEqual([3, 4]);
    expect(r.diagnostics[0]!.message).toMatch(/no JSX or code; to repeat elements for each item, use each items=list as=x/);
    expect(r.nodeCount).toBe(2);
  });
});
