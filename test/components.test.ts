/**
 * Behavior specific to each component. Documentation, layout bounds, theme
 * colors and keyboard reach are covered for all of them by contract.test.ts.
 */
import { describe, expect, it } from "vitest";
import { initials } from "../src/components/content";
import { pageSlots } from "../src/components/navigation";
import { render } from "../src/testing";

const types = (ui: ReturnType<typeof render>, root = ui.loom.boxes!) => root.children.map((b) => b.node.type);

describe("grid", () => {
  const spec = `grid min=200 gap=10\n  stat label="A" value=1\n  stat label="B" value=2\n  stat label="C" value=3\n  stat label="D" value=4\n`;

  it("fits as many columns as the width allows", () => {
    const cols = (width: number) => new Set(render(spec, { width }).loom.boxes!.children[0]!.children.map((b) => b.x)).size;
    expect(cols(320)).toBe(1);
    expect(cols(600)).toBe(2);
    expect(cols(1024)).toBe(4);
  });

  it("stacks rows with the gap between them", () => {
    const [a, , c] = render(spec, { width: 600 }).loom.boxes!.children[0]!.children;
    expect(c!.y - (a!.y + a!.h)).toBe(10);
    expect(c!.x).toBe(a!.x);
  });
});

describe("list and list-item", () => {
  const spec = `list\n  list-item "Socks" trailing="$24"\n  list-item "Shell" detail="Packs small" on=emit:shell\n`;

  it("makes only rows with on= pressable", () => {
    const ui = render(spec);
    expect(() => ui.press({ text: "Socks" })).toThrow(/isn't pressable/);
    ui.press({ text: "Shell" });
    expect(ui.emitted).toEqual([{ name: "shell", value: undefined }]);
  });

  it("draws the title, detail and trailing value", () => {
    expect(render(spec).text()).toEqual(expect.arrayContaining(["Socks", "$24", "Shell", "Packs small"]));
  });

  it("makes a row with a detail line taller", () => {
    const [a, b] = render(spec).loom.boxes!.children[0]!.children;
    expect(b!.h).toBeGreaterThan(a!.h);
  });
});

describe("accordion", () => {
  const spec = `state open=false n=0\naccordion "Returns" bind=open on=inc:n\n  text "Free returns within 30 days."\n`;

  it("shows its content only while open, and runs on= after toggling", () => {
    const ui = render(spec);
    expect(ui.isShown({ text: /Free returns/ })).toBe(false);
    ui.press("accordion");
    expect(ui.state).toMatchObject({ open: true, n: 1 });
    expect(ui.isShown({ text: /Free returns/ })).toBe(true);
    ui.press("accordion");
    expect(ui.isShown({ text: /Free returns/ })).toBe(false);
  });

  it("opens from the keyboard", () => {
    const ui = render(spec);
    ui.tab();
    ui.key(" ");
    expect(ui.state.open).toBe(true);
  });
});

describe("card on=", () => {
  const spec = `state n=0\ncard on=emit:open\n  text "Trail socks"\n  button "Add" on=inc:n\n`;

  it("is pressable as a whole", () => {
    const ui = render(spec);
    ui.press("card");
    expect(ui.emitted.map((e) => e.name)).toEqual(["open"]);
  });

  it("lets a button inside it take the press", () => {
    const ui = render(spec);
    ui.press("button");
    expect(ui.state.n).toBe(1);
    expect(ui.emitted).toEqual([]);
  });

  it("is not pressable without on=", () => {
    expect(() => render(`card\n  text "x"\n`).press("card")).toThrow(/isn't pressable/);
  });
});

describe("text strike=", () => {
  it("draws a line through each line of text", () => {
    const struck = render(`text "$160" strike=true\n`).drawOps.filter((d) => d.op === "fillRect");
    const plain = render(`text "$160"\n`).drawOps.filter((d) => d.op === "fillRect");
    expect(struck.length - plain.length).toBe(1);
  });
});

describe("badge, avatar and code", () => {
  it("badge draws its label", () => {
    expect(render(`badge "New"\n`).text()).toContain("New");
  });

  it("avatar shows initials and the name", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  cher ")).toBe("C");
    expect(initials("Émile van der Berg")).toBe("ÉB");
    expect(render(`avatar "Ada Lovelace" detail="Organizer"\n`).text()).toEqual(["AL", "Ada Lovelace", "Organizer"]);
    expect(render(`avatar "Ada Lovelace" name=false\n`).text()).toEqual(["AL"]);
  });

  it("code wraps long lines and grows taller", () => {
    const h = (w: number) => render(`code "${"npm run build -- --watch ".repeat(4)}"\n`, { width: w }).find("code").box!.h;
    expect(h(320)).toBeGreaterThan(h(1024));
  });
});

describe("skeleton and empty", () => {
  it("skeleton height follows the number of lines", () => {
    const h = (n: number) => render(`skeleton lines=${n}\n`).find("skeleton").box!.h;
    expect(h(1)).toBe(12);
    expect(h(3)).toBe(56);
  });

  it("skeleton draws a still frame when animation is off", () => {
    const ui = render(`skeleton shape=circle\n`);
    expect(ui.drawOps.map((d) => d.globalAlpha)).toEqual([1]);
  });

  it("empty runs on= from its button, and has no button without action=", () => {
    const ui = render(`empty "No results" action="Clear filters" on=emit:clear\n`);
    ui.press("empty");
    expect(ui.emitted.map((e) => e.name)).toEqual(["clear"]);
    expect(render(`empty "Nothing here"\n`).hits).toHaveLength(0);
  });
});

describe("switch and radio", () => {
  it("switch toggles and then runs on= with the new value", () => {
    const ui = render(`state on=false\nswitch "Updates" bind=on on="emit:changed:{on}"\n`);
    ui.press("switch");
    expect(ui.state.on).toBe(true);
    expect(ui.emitted).toEqual([{ name: "changed", value: true }]);
  });

  it("radios in a group share one value", () => {
    const ui = render(`state size=m\nradio "S" bind=size value=s\nradio "M" bind=size value=m\nradio "10" bind=size value=10\n`);
    ui.press({ text: "S" });
    expect(ui.state.size).toBe("s");
    ui.press({ text: "10" });
    expect(ui.state.size).toBe(10);
  });
});

describe("stepper", () => {
  const spec = `state qty=2\nstepper "Qty" bind=qty min=1 max=3\n`;
  const part = (ui: ReturnType<typeof render>, name: string) => ui.hits.find((h) => h.detail === name);
  const pressPart = (ui: ReturnType<typeof render>, name: string) => {
    const b = part(ui, name)!.box;
    ui.click(b.x + b.w / 2, b.y + b.h / 2);
  };

  it("steps within its limits and disables a side at its limit", () => {
    const ui = render(spec);
    pressPart(ui, "inc");
    expect(ui.state.qty).toBe(3);
    expect(part(ui, "inc")).toBeUndefined();
    pressPart(ui, "dec");
    pressPart(ui, "dec");
    expect(ui.state.qty).toBe(1);
    expect(part(ui, "dec")).toBeUndefined();
  });

  it("handles fractional steps without drift", () => {
    const ui = render(`state w=0\nstepper bind=w step=0.1\n`);
    for (let i = 0; i < 3; i++) pressPart(ui, "inc");
    expect(ui.state.w).toBe(0.3);
  });

  it("has a Tab stop for each button", () => {
    const ui = render(spec);
    ui.tab();
    ui.key("Enter");
    expect(ui.state.qty).toBe(1);
    ui.tab();
    ui.key("Enter");
    expect(ui.state.qty).toBe(2);
  });
});

describe("rating", () => {
  it("only shows a value when it has no bind=", () => {
    expect(render(`rating value=3.5\n`).hits).toHaveLength(0);
  });

  it("sets bind= to the pressed star", () => {
    const ui = render(`state stars=0\nrating bind=stars max=5\n`);
    const third = ui.hits.find((h) => h.detail === 3)!.box;
    ui.click(third.x + third.w / 2, third.y + third.h / 2);
    expect(ui.state.stars).toBe(3);
  });

  it("fills part of a star for a fractional value", () => {
    const ui = render(`rating value=2.5 max=3\n`);
    expect(ui.drawOps.filter((d) => d.op === "fill" && d.fillStyle === ui.loom.theme.colors.warn)).toHaveLength(3);
  });
});

describe("link", () => {
  it("runs on= when pressed, and only its text is pressable", () => {
    const ui = render(`link "Size guide" on=emit:sizes\n`, { width: 800 });
    ui.press("link");
    expect(ui.emitted.map((e) => e.name)).toEqual(["sizes"]);
    expect(ui.hits[0]!.box.w).toBeLessThan(ui.find("link").box!.w / 2);
  });
});

describe("tabs", () => {
  const spec = `state view=none\ntabs bind=view\n  tab "Overview"\n    text "About"\n  tab "Specs" value=specs\n    text "280 g"\n`;
  const pressTab = (ui: ReturnType<typeof render>, detail: string) => {
    const b = ui.hits.find((h) => h.detail === detail)!.box;
    ui.click(b.x + b.w / 2, b.y + b.h / 2);
  };

  it("shows the first tab when bind= matches none, and switches on press", () => {
    const ui = render(spec);
    expect(ui.isShown({ text: "About" })).toBe(true);
    expect(ui.isShown({ text: "280 g" })).toBe(false);
    pressTab(ui, "specs");
    expect(ui.state.view).toBe("specs");
    expect(ui.isShown({ text: "280 g" })).toBe(true);
    expect(ui.isShown({ text: "About" })).toBe(false);
  });

  it("uses the label as the value when value= is left out", () => {
    const ui = render(spec);
    pressTab(ui, "specs");
    pressTab(ui, "Overview");
    expect(ui.state.view).toBe("Overview");
  });

  it("gives each tab a Tab stop", () => {
    const ui = render(spec);
    ui.tab();
    ui.tab();
    ui.key("Enter");
    expect(ui.state.view).toBe("specs");
  });
});

describe("breadcrumb", () => {
  it("sets bind= to an earlier step; the current step isn't pressable", () => {
    const ui = render(`state at=x\nbreadcrumb "Shop / Shoes / Trail" bind=at\n`);
    expect(ui.hits.map((h) => h.detail)).toEqual(["Shop", "Shoes"]);
    const b = ui.hits[1]!.box;
    ui.click(b.x + b.w / 2, b.y + b.h / 2);
    expect(ui.state.at).toBe("Shoes");
  });

  it("is plain text without bind= or on=", () => {
    expect(render(`breadcrumb "Shop / Shoes"\n`).hits).toHaveLength(0);
  });

  it("wraps onto more lines when narrow", () => {
    const h = (w: number) => render(`breadcrumb "Outdoor gear / Footwear / Trail running / Waterproof"\n`, { width: w }).find("breadcrumb").box!.h;
    expect(h(260)).toBeGreaterThan(h(1024));
  });
});

describe("pagination", () => {
  it("chooses page slots around the current page", () => {
    expect(pageSlots(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageSlots(2, 12)).toEqual([1, 2, 3, 4, 5, "…", 12]);
    expect(pageSlots(6, 12)).toEqual([1, "…", 5, 6, 7, "…", 12]);
    expect(pageSlots(11, 12)).toEqual([1, "…", 8, 9, 10, 11, 12]);
  });

  it("moves between pages and stops at the ends", () => {
    const ui = render(`state page=1\npagination bind=page pages=3\n`);
    const press = (d: unknown) => {
      const b = ui.hits.find((h) => h.detail === d)?.box;
      if (!b) return false;
      ui.click(b.x + b.w / 2, b.y + b.h / 2);
      return true;
    };
    expect(press("prev")).toBe(false);
    press("next");
    expect(ui.state.page).toBe(2);
    press(3);
    expect(ui.state.page).toBe(3);
    expect(press("next")).toBe(false);
  });

  it("clamps an out-of-range page", () => {
    const ui = render(`state page=99\npagination bind=page pages=4\n`);
    expect(ui.text()).toContain("4");
    expect(types(ui)).toEqual(["pagination"]);
  });
});
