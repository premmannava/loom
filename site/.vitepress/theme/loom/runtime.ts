/**
 * Creating SayShape instances on the website.
 *
 * The engine needs a real canvas, fonts and `window`, so it is only ever
 * imported in the browser (from onMounted), never while VitePress renders
 * pages to static HTML. Every demo on the site goes through here, so they
 * all run the same engine from ../../src with no second implementation.
 */
import type { SayShape, Theme } from "@loom/index";

export type { SayShape, Theme };

/** The faces the engine draws with (theme.font). Canvas text doesn't trigger font loading by itself. */
const FACES = ['400 15px "Instrument Sans"', '600 15px "Instrument Sans"', '700 15px "Instrument Sans"', '400 13px "IBM Plex Mono"'];
let fontsLoading: Promise<unknown> | null = null;
function loadFonts(): Promise<unknown> {
  if (!fontsLoading) fontsLoading = document.fonts ? Promise.all(FACES.map((f) => document.fonts.load(f))).catch(() => undefined) : Promise.resolve();
  return fontsLoading;
}

export const usesMap = (spec: string) => /^\s*map\b/m.test(spec);

export interface CreateOptions {
  /** Include the world map components (a separate, larger chunk). */
  map?: boolean;
  /** Warnings from the engine while running. Default: collected silently. */
  onWarning?: (message: string) => void;
  /** Fixed "today" for date pickers, so examples look the same for everyone. */
  today?: string;
}

export interface LoomModules {
  SayShape: typeof import("@loom/index").SayShape;
  lightTheme: Theme;
  darkTheme: Theme;
  parse: typeof import("@loom/index").parse;
  Registry: typeof import("@loom/index").Registry;
}

let core: Promise<typeof import("@loom/index")> | null = null;
let mapMod: Promise<typeof import("@loom/components/map/index")> | null = null;

export async function loomModules(): Promise<LoomModules> {
  core ??= import("@loom/index");
  const m = await core;
  return { SayShape: m.SayShape, lightTheme: m.lightTheme, darkTheme: m.darkTheme, parse: m.parse, Registry: m.Registry };
}

export async function createLoom(canvas: HTMLCanvasElement, opts: CreateOptions = {}): Promise<SayShape> {
  core ??= import("@loom/index");
  if (opts.map) mapMod ??= import("@loom/components/map/index");
  const [m, map] = await Promise.all([core, opts.map ? mapMod : null, loadFonts()]);
  const components = [...m.coreComponents, ...(map ? map.mapComponents : [])];
  return new m.SayShape(canvas, {
    components,
    // The site shell decides light or dark; see watchSiteTheme.
    theme: isSiteDark() ? m.darkTheme : m.lightTheme,
    // Only the site's own origin: the examples ship no remote images.
    imageHosts: [],
    onWarning: opts.onWarning ?? (() => {}),
    today: opts.today ? () => opts.today! : undefined,
  });
}

/** VitePress marks dark mode with a class on <html>; the engine's "auto" theme reads data-theme instead. */
export const isSiteDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Keep an instance in step with the site's light/dark switch. Returns a cleanup function. */
export function watchSiteTheme(loom: SayShape, themes: { light: Theme; dark: Theme }, enabled: () => boolean = () => true): () => void {
  const apply = () => { if (enabled()) loom.setTheme(isSiteDark() ? themes.dark : themes.light); };
  const mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  apply();
  return () => mo.disconnect();
}

/** UTF-8 text from base64, for specs passed through HTML attributes and URLs. */
export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** URL-safe base64 of UTF-8 text, without padding. */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Plays a saved spec into an instance the way a model's stream arrives:
 * beginStream, push chunks, endStream. Nothing is generated; the text is
 * already known. Resolves false if cancelled.
 */
export function replayStream(loom: SayShape, spec: string, opts: { signal: { cancelled: boolean }; onProgress?: (shown: string) => void; instant?: boolean }): Promise<boolean> {
  loom.beginStream();
  if (opts.instant) {
    loom.push(spec);
    loom.endStream();
    opts.onProgress?.(spec);
    return Promise.resolve(true);
  }
  return new Promise((done) => {
    let i = 0;
    const tick = () => {
      if (opts.signal.cancelled) return done(false);
      // A few characters at a time, like tokens; only complete lines render.
      const n = Math.min(spec.length, i + 3 + Math.floor(Math.random() * 6));
      loom.push(spec.slice(i, n));
      i = n;
      opts.onProgress?.(spec.slice(0, i));
      if (i < spec.length) setTimeout(tick, 16);
      else { loom.endStream(); done(true); }
    };
    tick();
  });
}

export const prefersReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
