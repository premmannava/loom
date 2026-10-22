/**
 * A date picker's calendar in a real browser: pointer and keys through the
 * popup layer, and baselines of the open calendar in light and dark at
 * phone and desktop widths. The visual page fixes today at 2026-10-21.
 */
import { expect, test, type Page } from "@playwright/test";
import { THEMES, WIDTHS } from "./cases";

async function open(page: Page, theme: string, width: number, spec?: string): Promise<void> {
  await page.setViewportSize({ width: width + 40, height: 900 });
  await page.goto(`/visual/index.html?case=sample-request&theme=${theme}&width=${width}`);
  await page.waitForFunction(() => window.__loomReady || window.__loomError);
  if (spec) await page.evaluate((s) => { window.__loom!.setSpec(s, { resetState: true }); window.__loom!.renderNow(); }, spec);
}

async function field(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const loom = window.__loom!;
    loom.renderNow();
    const b = loom.hitRegions.find((h) => h.box.node.type === "date-picker")!.box;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
  });
}

/** The page position of one of the open calendar's regions, like "day:2026-11-12". */
async function part(page: Page, detail: string): Promise<{ x: number; y: number }> {
  return page.evaluate((d) => {
    const loom = window.__loom!;
    loom.renderNow();
    const b = loom.openPopupInfo!.regions.find((h) => h.detail === d)!.box;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
  }, detail);
}

const state = (page: Page, key: string) => page.evaluate((k) => window.__loom!.state.get(k), key);
const isOpen = (page: Page) => page.evaluate(() => { window.__loom!.renderNow(); return !!window.__loom!.openPopupInfo; });

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`date-picker open, ${theme} ${width}`, async ({ page }) => {
      await open(page, theme, width, `state due="2026-11-12"\ndate-picker "Delivery date" bind=due min="2026-11-02" max="2027-12-31"\n`);
      const f = await field(page);
      await page.mouse.click(f.x, f.y);
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("#frame")).toHaveScreenshot(`date-picker-open-${theme}-${width}.png`);
    });
  }
}

test("choosing a day with the pointer writes the date and closes the calendar", async ({ page }) => {
  await open(page, "light", 375);
  const f = await field(page);
  await page.mouse.click(f.x, f.y);
  const day = await part(page, "day:2026-11-12");
  await page.mouse.click(day.x, day.y);
  expect(await state(page, "needBy")).toBe("2026-11-12");
  expect(await isOpen(page)).toBe(false);
});

test("the keyboard pages to the next month and chooses; Escape changes nothing", async ({ page }) => {
  await open(page, "light", 375, `state due=""\ndate-picker bind=due\n`);
  const f = await field(page);
  await page.mouse.click(f.x, f.y);
  await page.keyboard.press("Escape");
  expect(await isOpen(page)).toBe(false);
  expect(await state(page, "due")).toBe("");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("Enter");
  expect(await state(page, "due")).toBe("2026-11-21");
});
