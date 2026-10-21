/**
 * Image loading for the engine. A spec can name any URL, and a model writes
 * specs, so images only load from the page's own origin or from hosts the app
 * allows: otherwise a generated screen could make the browser contact any
 * server (tracking, probing internal addresses).
 */

/** An image ready to draw. */
export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export type ImageStatus = "loading" | "ready" | "error" | "blocked";

export interface ImageState {
  status: ImageStatus;
  image?: LoadedImage;
  /** When it finished loading, for fading in. */
  readyAt?: number;
}

export type ImageLoader = (url: string) => Promise<LoadedImage>;

/** Loads with an <img>, requesting CORS so the canvas stays readable (for tests and capture). */
export const browserImageLoader: ImageLoader = (url) =>
  new Promise((resolve, reject) => {
    if (typeof Image === "undefined") { reject(new Error("No Image in this environment")); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });

/** Whether a host matches an allowlist entry: exact, or "*.example.com" for any subdomain. */
function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
  return host === p;
}

export interface ImagePolicy {
  /** The page's origin; images from it are always allowed. */
  origin: string;
  /** Base URL for relative src values. */
  base: string;
  hosts: readonly string[];
}

/**
 * Resolve a spec's src against the policy. Returns the absolute URL, or the
 * reason it isn't allowed.
 */
export function resolveImageUrl(src: string, policy: ImagePolicy): { url: string } | { blocked: string } {
  let u: URL;
  try { u = new URL(src, policy.base); } catch { return { blocked: `"${src}" isn't a valid URL` }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { blocked: `${u.protocol} URLs aren't allowed` };
  if (u.username || u.password) return { blocked: "URLs with credentials aren't allowed" };
  if (u.origin === policy.origin) return { url: u.href };
  if (u.protocol !== "https:") return { blocked: `${u.host} must use https` };
  const host = u.hostname.toLowerCase();
  if (policy.hosts.some((h) => hostMatches(host, h))) return { url: u.href };
  return { blocked: `${host} isn't in imageHosts` };
}

/** Caches loads by URL and tells the engine when one settles. */
export class ImageCache {
  private entries = new Map<string, ImageState>();
  private pending = new Set<Promise<unknown>>();
  private warned = new Set<string>();

  constructor(
    private policy: () => ImagePolicy,
    private loader: ImageLoader,
    private onSettle: () => void,
    private now: () => number,
    private max = 200,
  ) {}

  get(src: string): ImageState {
    const r = resolveImageUrl(src, this.policy());
    if ("blocked" in r) {
      if (!this.warned.has(src) && typeof console !== "undefined") {
        this.warned.add(src);
        console.warn(`Loom: image "${src}" was not loaded: ${r.blocked}. Allow its host with the imageHosts option.`);
      }
      return { status: "blocked" };
    }
    const hit = this.entries.get(r.url);
    if (hit) {
      // Keep recently used images at the end, so the oldest are evicted first.
      this.entries.delete(r.url);
      this.entries.set(r.url, hit);
      return hit;
    }
    const entry: ImageState = { status: "loading" };
    this.entries.set(r.url, entry);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    const p = this.loader(r.url).then(
      (image) => { entry.status = "ready"; entry.image = image; entry.readyAt = this.now(); },
      () => { entry.status = "error"; },
    ).finally(() => { this.pending.delete(p); this.onSettle(); });
    this.pending.add(p);
    return entry;
  }

  /** Resolves once every image requested so far has loaded or failed. */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
