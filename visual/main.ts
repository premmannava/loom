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
import type { LoadedImage } from "../src/images";
import { cases } from "./cases";

/**
 * Every image in a visual case is the same drawn landscape, so screenshots
 * test the image component's cropping and corners without the network.
 */
function fixtureImage(): Promise<LoadedImage> {
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 500;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 500);
  sky.addColorStop(0, "#9BC7E8");
  sky.addColorStop(1, "#F3E3C3");
  g.fillStyle = sky;
  g.fillRect(0, 0, 800, 500);
  g.fillStyle = "#F2B84B";
  g.beginPath();
  g.arc(620, 130, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5D7F72";
  g.beginPath();
  g.moveTo(0, 420);
  g.lineTo(220, 200);
  g.lineTo(380, 360);
  g.lineTo(520, 230);
  g.lineTo(800, 430);
  g.lineTo(800, 500);
  g.lineTo(0, 500);
  g.fill();
  g.fillStyle = "#2F4F48";
  g.fillRect(0, 440, 800, 60);
  return Promise.resolve({ source: c, width: c.width, height: c.height });
}

declare global {
  interface Window { __loomReady?: boolean; __loomError?: string }
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
    loadImage: fixtureImage,
  });
  loom.setSpec(visual.spec);
  loom.renderNow();
  await loom.imagesLoaded();
  window.__loomReady = true;
}

main().catch((e: unknown) => {
  window.__loomError = e instanceof Error ? e.message : String(e);
});
