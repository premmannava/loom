import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { parse } from "../src/parser";
import { ALWAYS_EXPOSED, PROFILES, resolveProfile } from "../src/profiles";
import { COMPACT_EXAMPLE_ORDER, describeGuide, guideSections, languageGuide, WORKED_EXAMPLES, type GuideMode } from "../src/prompt";
import { Registry } from "../src/registry";

const all = new Registry([...coreComponents, ...mapComponents]);
const playground = { imageHosts: ["images.unsplash.com"] };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const MODES: GuideMode[] = ["full", "compact"];
const PROFILE_NAMES = ["all", ...Object.keys(PROFILES)];

/** Every spec the guide shows: worked examples, and element examples (indented under "example:"). */
function specsIn(guide: string): string[] {
  const specs: string[] = [];
  const lines = guide.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!;
    // Worked examples: a heading line, then an unindented spec up to a blank line.
    if (/^(EXAMPLE( \(\w+\))?|A SIGN-UP FORM)$/.test(head)) {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i] !== ""; i++) body.push(lines[i]!);
      specs.push(body.join("\n") + "\n");
    }
    // DATA AND LISTS examples: "A to-do list:" then a spec indented 2.
    if (/^(A to-do list|A cart whose|Orders, each)/.test(head)) {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i]!.startsWith("  "); i++) body.push(lines[i]!.slice(2));
      specs.push(body.join("\n") + "\n");
    }
  }
  return specs;
}

describe("full guide", () => {
  it("is unchanged when no mode or profile is given", () => {
    expect(languageGuide(all, playground)).toBe(fixture("guide-full.txt"));
    expect(languageGuide(all, { ...playground, examples: false })).toBe(fixture("guide-full-no-examples.txt"));
    expect(languageGuide(all, { ...playground, mode: "full", profile: "all" })).toBe(fixture("guide-full.txt"));
  });

  it("keeps examples:false meaning only the elements' own examples", () => {
    const g = languageGuide(all, { examples: false });
    expect(g).not.toContain("    example:");
    expect(g).toContain("A to-do list:");
    expect(g).toContain("EXAMPLE\n");
  });

  it("joins its sections with blank lines, in a fixed order", () => {
    const sections = guideSections(all, playground);
    expect(sections.map((s) => s.name)).toEqual(["intro", "format", "expressions", "actions", "data", "common-props", "index", "elements", "rules", "example"]);
    expect(sections.map((s) => s.text).join("\n\n")).toBe(languageGuide(all, playground));
  });
});

describe("profiles", () => {
  it("adds what a profile's elements need", () => {
    expect(resolveProfile(all, ["tab"]).types).toEqual(expect.arrayContaining(["tabs", "tab", ...ALWAYS_EXPOSED]));
    expect(resolveProfile(all, ["tabs"]).types).toContain("tab");
    expect(resolveProfile(all, ["list-item"]).types).toContain("list");
    expect(resolveProfile(all, ["list"]).types).toContain("list-item");
    expect(resolveProfile(all, ["pin"]).types).toContain("map");
  });

  it("keeps the renderer's order, so the same profile always gives the same guide", () => {
    const a = resolveProfile(all, ["button", "card"]).types;
    const b = resolveProfile(all, ["card", "button"]).types;
    expect(a).toEqual(b);
  });

  it("explains a profile mistake instead of guessing", () => {
    expect(() => resolveProfile(all, "nope")).toThrow(/Unknown component profile "nope". Use one of: all, forms/);
    expect(() => resolveProfile(new Registry(coreComponents), ["pin"])).toThrow(/includes "pin", which the renderer doesn't have/);
  });

  it("is every element when left out or 'all'", () => {
    expect(resolveProfile(all).types).toEqual(all.all().map((c) => c.type));
    expect(resolveProfile(all, "all").registry).toBe(all);
  });
});

describe.each(MODES)("%s guide, per profile", (mode) => {
  it.each(PROFILE_NAMES)("profile %s: every example parses with no problems using only its elements", (profile) => {
    const exposed = resolveProfile(all, profile).registry;
    const guide = languageGuide(all, { ...playground, mode, profile, examples: true });
    for (const spec of specsIn(guide)) expect(parse(spec, exposed).diagnostics, spec).toEqual([]);
  });

  it.each(PROFILE_NAMES)("profile %s: describes exactly its elements and never shows another one", (profile) => {
    const { types } = resolveProfile(all, profile);
    const guide = languageGuide(all, { ...playground, mode, profile });
    const others = all.all().map((c) => c.type).filter((t) => !types.includes(t));
    for (const t of types) expect(guide, t).toMatch(mode === "compact" ? new RegExp(`^- ${t}\\b`, "m") : new RegExp(`^  ${t}\\b`, "m"));
    for (const t of others) {
      // An element is used as `type "text"` or `type prop=`; plain words like "image URLs" are fine.
      const used = guide.split("\n").filter((l) => new RegExp(`(^|\\s)${t} ("|[a-z]+=)`).test(l));
      expect(used, `${profile} mentions ${t}`).toEqual([]);
    }
  });
});

describe("worked examples", () => {
  it("drops the booking example when its elements aren't exposed", () => {
    // booking needs card, row, stat and button: the forms profile has no stat.
    expect(languageGuide(all, { profile: "forms" })).not.toContain("Cabin booking");
    expect(languageGuide(all, { profile: ["card", "row", "stat", "button"] })).toContain("EXAMPLE\nstate guests=2");
  });

  it("is chosen explicitly with workedExamples", () => {
    const g = languageGuide(all, { mode: "compact", workedExamples: ["cart", "orders"] });
    expect(g).toContain("EXAMPLE (cart)");
    expect(g).toContain("EXAMPLE (orders)");
    expect(g).not.toContain("EXAMPLE (todo)");
    expect(languageGuide(all, { mode: "compact", workedExamples: false })).not.toMatch(/^EXAMPLE/m);
    expect(languageGuide(all, { workedExamples: false })).not.toMatch(/A to-do list:|^EXAMPLE/m);
    expect(languageGuide(all, { workedExamples: ["form"] })).toContain("A SIGN-UP FORM\nstate email=");
  });

  it("in compact mode, defaults to the first one the profile can build", () => {
    for (const profile of PROFILE_NAMES) {
      const exposed = resolveProfile(all, profile).registry;
      const expected = COMPACT_EXAMPLE_ORDER.find((n) => parse(WORKED_EXAMPLES[n] + "\n", exposed).diagnostics.length === 0);
      const g = languageGuide(all, { mode: "compact", profile });
      expect(g, profile).toContain(`EXAMPLE (${expected})`);
      expect(g.match(/^EXAMPLE/gm), profile).toHaveLength(1);
    }
  });

  it("in compact mode, leaves out the elements' own examples unless asked", () => {
    expect(languageGuide(all, { mode: "compact" })).not.toContain("example:");
    expect(languageGuide(all, { mode: "compact", examples: true })).toContain(`    example:`);
  });
});

describe("compact guide", () => {
  const compact = languageGuide(all, { ...playground, mode: "compact" });
  const elementLine = (type: string) => compact.split("\n").find((l) => l.startsWith(`- ${type} `) || l === `- ${type}`)!;

  it("is much smaller than the full guide", () => {
    expect(compact.length).toBeLessThan(languageGuide(all, playground).length / 2);
  });

  it("keeps every prop, its type, enum values, required marks and nesting", () => {
    for (const c of all.all()) {
      const line = elementLine(c.type);
      expect(line, c.type).toBeDefined();
      for (const [name, def] of Object.entries(c.props)) {
        const expected = def.type === "enum" ? `${name}=${def.values!.join("|")}` : `${name}=`;
        expect(line, `${c.type}.${name}`).toContain(expected + (def.type === "enum" && def.required ? "!" : ""));
        if (def.required) expect(line, `${c.type}.${name} required`).toMatch(new RegExp(`${name}=\\S*!`));
        else expect(line, `${c.type}.${name} optional`).not.toMatch(new RegExp(`${name}=\\S*!`));
      }
      if (c.text?.required) expect(line).toContain(`${c.type} "text"`);
      if (Array.isArray(c.children)) expect(line, c.type).toContain(`holds ${c.children.join(", ")}`);
      for (const p of c.parents ?? []) expect(line, c.type).toContain(p === "root" ? "top level" : p);
    }
  });

  it("keeps the rules that change what a spec does", () => {
    expect(compact).toMatch(/Indent children 2 spaces/);
    expect(compact).toMatch(/every value on one line/);
    expect(compact).toMatch(/A line holding only if=\{…\}/);
    expect(compact).toMatch(/quote text/);
    expect(compact).toMatch(/Change the screen \(runs here\)/);
    expect(compact).toMatch(/Tell the app \(host event\): emit:name/);
    expect(compact).toMatch(/computed list \(items=\{filter\(…\)\}\) is read-only/);
    expect(compact).toMatch(/No colors, sizes or fonts/);
    expect(compact).toMatch(/Images only load from these hosts: images\.unsplash\.com/);
    expect(compact).toMatch(/No JSX, HTML or JavaScript/);
    expect(compact).toMatch(/Output only Loom/);
  });

  it("puts the app's own context after everything that's the same for every app", () => {
    const a = languageGuide(all, { mode: "compact", imageHosts: ["a.com"], notes: "A bakery.", actions: [{ name: "order", description: "buy" }] });
    const b = languageGuide(all, { mode: "compact", imageHosts: ["b.org"], notes: "A gym.", actions: [{ name: "join", description: "sign up" }] });
    let shared = 0;
    while (a[shared] === b[shared]) shared++;
    // Everything up to the image rule is a shared prefix.
    expect(shared).toBeGreaterThanOrEqual(a.indexOf("IMAGES\n"));
    expect(guideSections(all, { mode: "compact", notes: "x", actions: [{ name: "a", description: "b" }] }).map((s) => s.name).slice(-3)).toEqual(["images", "app-actions", "notes"]);
  });

  it("is the same text every time", () => {
    expect(languageGuide(all, { mode: "compact", profile: "shop" })).toBe(languageGuide(all, { mode: "compact", profile: "shop" }));
  });
});

describe("describeGuide", () => {
  it("reports the mode, profile, size and an estimate labelled as one", () => {
    const d = describeGuide(all, { mode: "compact", profile: "forms" });
    expect(d.mode).toBe("compact");
    expect(d.profile).toBe("forms");
    expect(d.components).toContain("input");
    expect(d.chars).toBe(languageGuide(all, { mode: "compact", profile: "forms" }).length);
    expect(d.estimatedTokens).toBe(Math.round(d.chars / 4));
    expect(describeGuide(all).profile).toBe("all");
  });
});
