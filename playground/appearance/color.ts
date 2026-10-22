/**
 * Colors for the playground's Appearance panel: reading hex input, WCAG
 * contrast, and making a requested accent readable on a theme's surface.
 * No DOM, so it's tested in Node.
 */

export interface RGB { r: number; g: number; b: number }

/**
 * A hex color as #rrggbb, from #RGB or #RRGGBB (the # optional, any case,
 * surrounding spaces ignored), or null for anything else, including the
 * half-typed values a text field passes through ("#3c", "#3cc2b").
 */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`Not a hex color: ${hex}`);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** a mixed toward b by t (0 = a, 1 = b), in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** What a color painted at some opacity over a background looks like. */
export const over = (color: string, alpha: number, background: string) => mix(background, color, alpha);

/** WCAG targets: ordinary text, and boundaries and focus indicators. */
export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

export const WHITE = "#ffffff";
export const NEAR_BLACK = "#0b0f14";

/** Text for on top of a color: white or near-black, whichever reads better. */
export function onColor(fill: string): string {
  return contrast(fill, WHITE) >= contrast(fill, NEAR_BLACK) ? WHITE : NEAR_BLACK;
}

export interface EffectiveAccent {
  /** The accent to use. */
  accent: string;
  /** Text on the accent (a filled button's label). */
  onAccent: string;
  /** Whether accent had to change from what was asked for. */
  adjusted: boolean;
  /** The contrast of the accent on the surface, after any change. */
  ratio: number;
}

/**
 * An accent that works on a surface both as text and strokes (at least
 * 4.5:1 against it) and as a filled control under onAccent text (at least
 * 4.5:1, which white or near-black always reaches). A color that's too
 * close to the surface is darkened (on a light surface) or lightened (on a
 * dark one) by the least amount that's enough, keeping its hue.
 */
export function effectiveAccent(requested: string, surface: string): EffectiveAccent {
  const want = normalizeHex(requested) ?? requested;
  const result = (accent: string, adjusted: boolean): EffectiveAccent =>
    ({ accent, onAccent: onColor(accent), adjusted, ratio: contrast(accent, surface) });
  if (contrast(want, surface) >= TEXT_CONTRAST) return result(want, false);
  const toward = luminance(surface) > 0.5 ? NEAR_BLACK : WHITE;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    if (contrast(mix(want, toward, t), surface) >= TEXT_CONTRAST) hi = t;
    else lo = t;
  }
  let accent = mix(want, toward, hi);
  // Rounding to whole channels can land just under the target: step on until it's met.
  for (let t = hi; contrast(accent, surface) < TEXT_CONTRAST && t < 1; t = Math.min(1, t + 0.01)) accent = mix(want, toward, t);
  return result(accent, true);
}
