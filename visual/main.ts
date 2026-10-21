/**
 * Renders one visual case, chosen by the URL:
 *
 *   /visual/index.html?case=sample-hike&theme=dark&width=375
 *
 * The page sets window.__loomReady once fonts are loaded and the frame is
 * painted, so screenshots never catch a half-rendered canvas.
 */
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import { Loom } from "../src/engine";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { darkTheme, lightTheme } from "../src/theme";
import { fixtureImageLoader } from "./fixture-image";
import { cases } from "./cases";

declare global {
  interface Window { __loomReady?: boolean; __loomError?: string; __loom?: Loom }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const name = params.get("case") ?? "";
  const dark = params.get("theme") === "dark";
  const width = Number(params.get("width") ?? 375);
  const visual = cases.find((c) => c.name === name);
  if (!visual) throw new Error(`No visual case named "${name}"`);

  const theme = dark ? darkTheme : lightTheme;
  // The root has no surface of its own, so the page shows through: use the theme's.
  document.body.style.background = theme.colors.surface;
  // Canvas text doesn't trigger web font loading, so load every weight first.
  await Promise.all([400, 600, 700].map((w) => document.fonts.load(`${w} 16px "Instrument Sans"`)));

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const loom = new Loom(canvas, {
    components: [...coreComponents, ...mapComponents],
    theme,
    width,
    animate: false,
    // The samples' real photo host, so their images are drawn by the fixture
    // instead of downloaded; other hosts stay blocked, as in the playground.
    imageHosts: ["images.unsplash.com"],
    loadImage: fixtureImageLoader,
  });
  // Interaction tests (typing.spec.ts) drive the engine directly.
  window.__loom = loom;
  loom.setSpec(visual.spec);
  loom.renderNow();
  await loom.imagesLoaded();
  window.__loomReady = true;
}

main().catch((e: unknown) => {
  window.__loomError = e instanceof Error ? e.message : String(e);
});
