/**
 * A select's list in a real browser: real pointer, keyboard and wheel
 * events through the popup layer, plus baselines of the open list in light
 * and dark at phone and desktop widths.
 */
import { expect, test, type Page } from "@playwright/test";
import { THEMES, WIDTHS } from "./cases";

async function open(page: Page, theme: string, width: number, spec?: string): Promise<void> {
  await page.setViewportSize({ width: width + 40, height: 760 });
  await page.goto(`/visual/index.html?case=sample-directory&theme=${theme}&width=${width}`);
  await page.waitForFunction(() => window.__loomReady || window.__loomError);
  if (spec) await page.evaluate((s) => { window.__loom!.setSpec(s, { resetState: true }); window.__loom!.renderNow(); }, spec);
}

/** The page position of the select's field. */
async function field(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const loom = window.__loom!;
    loom.renderNow();
    const b = loom.hitRegions.find((h) => h.box.node.type === "select")!.box;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
  });
}

const popup = (page: Page) => page.evaluate(() => {
  window.__loom!.renderNow();
  const p = window.__loom!.openPopupInfo;
  return p && { area: p.area, state: { ...p.state } };
});
const state = (page: Page, key: string) => page.evaluate((k) => window.__loom!.state.get(k), key);

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`select open, ${theme} ${width}`, async ({ page }) => {
      await open(page, theme, width);
      const f = await field(page);
      await page.mouse.click(f.x, f.y);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(page.locator("#frame")).toHaveScreenshot(`select-open-${theme}-${width}.png`);
    });
  }
}

test("choosing with the pointer filters the directory and closes the list", async ({ page }) => {
  await open(page, "light", 375);
  const f = await field(page);
  await page.mouse.click(f.x, f.y);
  const p = await popup(page);
  expect(p).not.toBeNull();
  // The third row: Sales.
  const r = await page.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect().top);
  await page.mouse.click(f.x, r + p!.area!.y + 4 + 40 * 2.5);
  expect(await state(page, "department")).toBe("sales");
  expect(await popup(page)).toBeNull();
});

test("a click outside closes the list without pressing what's under it", async ({ page }) => {
  await open(page, "light", 375, `state n=0 xs=["Low", "High"] x=""\nselect items=xs bind=x\nbutton "Add" on=inc:n\n`);
  const f = await field(page);
  await page.mouse.click(f.x, f.y);
  // Far below the short list: an empty part of the page.
  await page.mouse.click(f.x, f.y + 400);
  expect(await popup(page)).toBeNull();
  expect(await state(page, "n")).toBe(0);
});

test("a long list opens above near the bottom of the window and scrolls with the wheel", async ({ page }) => {
  const opts = Array.from({ length: 30 }, (_, i) => `{id: ${i}, name: "Option ${i}"}`).join(", ");
  await open(page, "light", 375, `state x=3 xs=[${opts}]\nspacer size=400\nselect items=xs value=id label=name bind=x\n`);
  await page.setViewportSize({ width: 415, height: 540 });
  const f = await field(page);
  await page.mouse.click(f.x, f.y);
  const p = await popup(page);
  const top = await page.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect().top);
  expect(p!.area!.y + p!.area!.h).toBeLessThan(f.y - top);
  await page.mouse.move(f.x, top + p!.area!.y + 80);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await popup(page))!.state.scroll).toBeGreaterThan(3);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  expect(await state(page, "x")).toBe(29);
});
