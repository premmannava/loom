/**
 * A drawn stand-in for photos in the visual tests, so screenshots never depend
 * on a server. The playground itself loads the samples' real photos.
 */
import type { ImageLoader } from "../src/images";

/** A simple trail landscape: sky, sun, two ridges and a path. */
export function drawLandscape(width = 800, height = 500): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  const sx = width / 800, sy = height / 500;
  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#9BC7E8");
  sky.addColorStop(1, "#F3E3C3");
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#F2B84B";
  g.beginPath();
  g.arc(620 * sx, 130 * sy, 50 * Math.min(sx, sy), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5D7F72";
  g.beginPath();
  g.moveTo(0, 420 * sy);
  g.lineTo(220 * sx, 200 * sy);
  g.lineTo(380 * sx, 360 * sy);
  g.lineTo(520 * sx, 230 * sy);
  g.lineTo(800 * sx, 430 * sy);
  g.lineTo(width, height);
  g.lineTo(0, height);
  g.fill();
  g.fillStyle = "#2F4F48";
  g.fillRect(0, 440 * sy, width, 60 * sy);
  return c;
}

/** Draws the same landscape for every URL, so visual tests never depend on the network. */
export const fixtureImageLoader: ImageLoader = () => {
  const c = drawLandscape();
  return Promise.resolve({ source: c, width: c.width, height: c.height });
};
