/**
 * Popups: a panel drawn above everything else on the canvas, owned by one
 * element (a select's list of options). The engine keeps at most one open.
 *
 * - It's drawn after the whole screen, and its hit regions are checked
 *   first. A press outside it closes it and goes no further, so nothing
 *   underneath is pressed by the same click.
 * - While it's open, keys go to it (Escape and Tab close it), and focus
 *   returns to its owner when it closes.
 * - It closes when its owner disappears (hidden, removed, a new spec).
 * - What it shows (which option is highlighted, how far it's scrolled) is
 *   kept in a PopupState the engine holds, never in the app's state.
 * - It's placed in the part of the canvas people can see: below its owner,
 *   or above it when there's room only there. A canvas can't draw outside
 *   itself, so when neither fits, the canvas grows downward to make room.
 */
import type { Rect } from "./types";

/** Transient state of an open popup, owned by the engine, changed by the component. */
export type PopupState = Record<string, number | string | null>;

/** The part of the canvas people can see, in canvas CSS pixels. bottom may be past the canvas. */
export interface Viewport {
  top: number;
  bottom: number;
}

/** How big a popup wants to be: its full height, and the least height worth showing. */
export interface PopupSize {
  w: number;
  h: number;
  minH: number;
  /** When it has to be shorter than h: keep base plus whole steps (whole rows), so no row is cut. */
  snap?: { base: number; step: number };
}

/** Space between the owner and the popup, and between the popup and the viewport's edge. */
export const POPUP_GAP = 4;
export const POPUP_MARGIN = 8;

/**
 * Where a popup goes for an owner: below it if it fits in the viewport,
 * above it if it fits only there, otherwise on the side with more room,
 * shrunk to that room but never below minH. It never goes above the
 * canvas's top; below, the canvas grows to hold it (see the engine).
 * Horizontally it lines up with the owner and stays inside the canvas width.
 */
export function placePopup(anchor: Rect, size: PopupSize, view: Viewport, canvasWidth: number): Rect & { side: "below" | "above" } {
  const w = Math.max(0, Math.min(Math.max(size.w, anchor.w), canvasWidth));
  const x = Math.max(0, Math.min(anchor.x, canvasWidth - w));
  const want = Math.max(0, size.h);
  const least = Math.min(want, Math.max(0, size.minH));
  const top = Math.max(0, view.top);
  const below = view.bottom - (anchor.y + anchor.h) - POPUP_GAP - POPUP_MARGIN;
  const above = anchor.y - top - POPUP_GAP - POPUP_MARGIN;
  let side: "below" | "above";
  let h: number;
  if (below >= want) { side = "below"; h = want; }
  else if (above >= want) { side = "above"; h = want; }
  // Neither fits whole: the roomier side, unless above can't even hold the least.
  else if (above > below && above >= least) { side = "above"; h = Math.min(want, above); }
  else { side = "below"; h = Math.max(least, Math.min(want, below)); }
  if (h < want && size.snap && size.snap.step > 0) {
    const { base, step } = size.snap;
    h = Math.max(least, base + Math.floor((h - base) / step + 1e-9) * step);
  }
  const y = side === "below" ? anchor.y + anchor.h + POPUP_GAP : anchor.y - POPUP_GAP - h;
  return { x, y, w, h, side };
}
