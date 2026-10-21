/**
 * Visual regression: each case in light and dark at phone and desktop widths,
 * compared against the baselines in visual/__screenshots__.
 *
 * Baselines are made on Linux in the Playwright Docker image (see
 * `npm run test:visual:docker`), because font rendering differs by platform.
 */
import { expect, test } from "@playwright/test";
import { cases, THEMES, WIDTHS } from "./cases";

for (const c of cases) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`${c.name} ${theme} ${width}`, async ({ page }) => {
        await page.goto(`/visual/index.html?case=${c.name}&theme=${theme}&width=${width}`);
        await page.waitForFunction(() => window.__loomReady || window.__loomError);
        expect(await page.evaluate(() => window.__loomError ?? null)).toBeNull();
        // Let any frame scheduled by the font-loading listener finish first.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await expect(page.locator("#frame")).toHaveScreenshot(`${c.name}-${theme}-${width}.png`);
      });
    }
  }
}
