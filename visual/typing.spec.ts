/**
 * Typing in a real browser: the <input> placed over a field while it's
 * being edited (src/dom-editor.ts). No baselines; these check behavior and
 * that the input lines up with the field.
 */
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, spec: string): Promise<void> {
  await page.goto(`/visual/index.html?case=component-button&theme=light&width=600`);
  await page.waitForFunction(() => window.__loomReady || window.__loomError);
  await page.evaluate((s) => { window.__loom!.setSpec(s, { resetState: true }); window.__loom!.renderNow(); }, spec);
}

/** The page position of the nth field's centre. */
async function field(page: Page, n = 0): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const loom = window.__loom!;
    loom.renderNow();
    const hits = loom.hitRegions.filter((h) => h.box.node.type === "input");
    const b = hits[i]!.box;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
  }, n);
}

const state = (page: Page, key: string) => page.evaluate((k) => window.__loom!.state.get(k), key);
const editor = (page: Page) => page.locator("input[data-loom-editor]");

/** Where the input is versus where the engine says the field's text sits, in page pixels. */
async function offset(page: Page): Promise<{ dx: number; dy: number }> {
  return page.evaluate(() => {
    const el = document.querySelector("input[data-loom-editor]") as HTMLInputElement;
    const loom = window.__loom!;
    const t = loom.editing!;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    // The field's own pressable box, under its label.
    const box = loom.hitRegions.find((h) => h.box.node.id === t.node.id)!.box;
    const e = el.getBoundingClientRect();
    // The field's text starts 12 px in from its box (FIELD_PAD in components/input.ts).
    return { dx: e.left - (r.left + box.x + 12), dy: e.top - (r.top + box.y + 1) };
  });
}

test("click and type: each keystroke writes state and redraws the screen", async ({ page }) => {
  await open(page, `state name=""\ninput "Name" bind=name placeholder="e.g. Ada"\ntext "Hello {name}!"\n`);
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("Ada");
  expect(await state(page, "name")).toBe("Ada");
  await expect(editor(page)).toHaveValue("Ada");
  const { dx, dy } = await offset(page);
  expect(Math.abs(dx)).toBeLessThan(1);
  expect(Math.abs(dy)).toBeLessThan(1);
});

test("Tab moves through fields and buttons, and Enter presses the button", async ({ page }) => {
  await open(page, `state first="" last="" saved=false\ninput "First" bind=first\ninput "Last" bind=last\nbutton "Save" on=set:saved:true\n`);
  // Arriving on the canvas by keyboard starts typing in its first field.
  await page.focus("#canvas");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("Ada");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Lovelace");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("#canvas")).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__loom!.state.snapshot())).toMatchObject({ first: "Ada", last: "Lovelace", saved: true });
  await page.keyboard.press("Shift+Tab");
  await expect(editor(page)).toHaveValue("Lovelace");
});

test("Tab past the last element leaves the canvas", async ({ page }) => {
  await open(page, `state a=""\ninput "A" bind=a\n`);
  await page.evaluate(() => {
    const after = document.createElement("button");
    after.id = "after";
    after.textContent = "After";
    document.getElementById("canvas")!.parentElement!.append(after);
  });
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Tab");
  await expect(page.locator("#after")).toBeFocused();
  await expect(editor(page)).toHaveCount(0);
});

test("Enter runs on=, the field clears, and the input follows the field as the list above grows", async ({ page }) => {
  await open(page, `state task="" todos=[]\neach items=todos as=t\n  text "{t}"\ninput "New item" bind=task on="add:todos:{task};set:task:''"\n`);
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  for (const item of ["Milk", "Eggs", "Bread"]) {
    await page.keyboard.type(item);
    await page.keyboard.press("Enter");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(editor(page)).toHaveValue("");
    await expect(editor(page)).toBeFocused();
    const { dy } = await offset(page);
    expect(Math.abs(dy)).toBeLessThan(1);
  }
  expect(await state(page, "todos")).toEqual(["Milk", "Eggs", "Bread"]);
});

test("the input follows the field when the page scrolls", async ({ page }) => {
  await open(page, `state a=""\ninput "A" bind=a\n`);
  await page.evaluate(() => { document.body.style.paddingTop = "300px"; document.body.style.height = "3000px"; });
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  await page.mouse.wheel(0, 200);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const { dy } = await offset(page);
  expect(Math.abs(dy)).toBeLessThan(1);
});

test("input methods: state is written when composition finishes, not mid-way", async ({ page }) => {
  await open(page, `state city=""\ninput "City" bind=city\n`);
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  const during = await page.evaluate(() => {
    const el = document.querySelector("input[data-loom-editor]") as HTMLInputElement;
    el.dispatchEvent(new CompositionEvent("compositionstart"));
    el.value = "とうきょう";
    el.dispatchEvent(new InputEvent("input", { isComposing: true }));
    return window.__loom!.state.get("city");
  });
  expect(during).toBe("");
  await page.evaluate(() => {
    const el = document.querySelector("input[data-loom-editor]") as HTMLInputElement;
    el.value = "東京";
    el.dispatchEvent(new CompositionEvent("compositionend"));
  });
  expect(await state(page, "city")).toBe("東京");
});

test("Escape stops typing and keeps focus on the canvas; a hidden field closes its input", async ({ page }) => {
  await open(page, `state a="" show=true\ninput "A" bind=a if=show\nbutton "Hide" on=set:show:false\n`);
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("#canvas")).toBeFocused();
  await page.mouse.click(p.x, p.y);
  await expect(editor(page)).toHaveCount(1);
  await page.evaluate(() => { window.__loom!.state.set("show", false); window.__loom!.renderNow(); });
  await expect(editor(page)).toHaveCount(0);
});

test("kind sets the input type, and number fields write numbers", async ({ page }) => {
  await open(page, `state pw="" qty=null\ninput "Password" bind=pw kind=password\ninput "Qty" bind=qty kind=number\n`);
  await page.mouse.click(...Object.values(await field(page, 0)) as [number, number]);
  await expect(editor(page)).toHaveAttribute("type", "password");
  await page.keyboard.type("secret");
  await page.mouse.click(...Object.values(await field(page, 1)) as [number, number]);
  await expect(editor(page)).toHaveAttribute("inputmode", "decimal");
  await page.keyboard.type("2.5");
  expect(await state(page, "qty")).toBe(2.5);
  expect(await state(page, "pw")).toBe("secret");
});

test("the typed text lines up with the text the canvas draws", async ({ page }) => {
  await open(page, `state name="Ada Lovelace"\ninput "Name" bind=name\n`);
  await page.addStyleTag({ content: "input[data-loom-editor]{caret-color:transparent!important}" });
  const clip = await page.evaluate(() => {
    const loom = window.__loom!;
    const b = loom.hitRegions.find((h) => h.box.node.type === "input")!.box;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    // Just the text, inside the border.
    return { x: r.left + b.x + 8, y: r.top + b.y + 6, width: 140, height: b.h - 12 };
  });
  const before = (await page.screenshot({ clip })).toString("base64");
  const p = await field(page);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => (document.querySelector("input[data-loom-editor]") as HTMLInputElement).setSelectionRange(0, 0));
  const after = (await page.screenshot({ clip })).toString("base64");
  const changed = await page.evaluate(async ([a, b]) => {
    const load = (src: string) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${src}`; });
    const [ia, ib] = await Promise.all([load(a!), load(b!)]);
    const px = (img: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d")!; g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const da = px(ia), db = px(ib);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) > 120) diff++;
    return diff / (da.length / 4);
  }, [before, after]);
  // Shifted text changes a large share of these pixels; aligned text only a few at glyph edges.
  expect(changed).toBeLessThan(0.03);
});
