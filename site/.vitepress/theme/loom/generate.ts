/**
 * Asking the hosted model proxy (worker/) for a spec, from the browser.
 *
 * Everything here is public: the proxy's URL, the Turnstile site key and the
 * model's display name come from build-time variables (VITE_*), and the API
 * key never leaves the proxy. When no proxy URL is set, generation is off
 * and the playground only runs saved and edited specs.
 */

const ENDPOINT = (import.meta.env.VITE_SAYSHAPE_MODEL_ENDPOINT as string | undefined)?.trim() || "";
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || "";
export const MODEL_LABEL = (import.meta.env.VITE_SAYSHAPE_MODEL_LABEL as string | undefined)?.trim() || "a hosted model";
export const MAX_REQUEST_CHARS = 400;

// https only, except a local proxy (wrangler dev) while developing.
export const generationAvailable = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(ENDPOINT);
export const needsHumanCheck = generationAvailable && !!TURNSTILE_SITE_KEY;

export type GenerateEvent =
  | { t: "phase"; v: string }
  | { t: "text"; v: string }
  | { t: "reset" }
  | { t: "done"; spec: string; problems: number; repaired: boolean; ms: number }
  | { t: "error"; message: string };

/** Send a request and call onEvent for each line the proxy streams back. */
/** What a follow-up message changes: the first request, the changes since, and the current spec. */
export interface Refinement {
  task: string;
  changes: string[];
  spec: string;
}
/** The proxy accepts at most this many earlier changes; older ones are dropped (the spec already has their effect). */
export const MAX_CHANGES = 10;

export async function generate(request: string, opts: { token?: string; refine?: Refinement; signal: AbortSignal; onEvent: (e: GenerateEvent) => void }): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request,
      token: opts.token,
      refine: opts.refine ? { ...opts.refine, changes: opts.refine.changes.slice(-MAX_CHANGES) } : undefined,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let message = `The model service answered ${res.status}.`;
    try { message = ((await res.json()) as { error?: string }).error ?? message; } catch { /* keep the status */ }
    opts.onEvent({ t: "error", message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try { opts.onEvent(JSON.parse(line) as GenerateEvent); } catch { /* skip a broken line */ }
      }
    }
    if (done) return;
  }
}

// ---------------------------------------------------------------- Turnstile

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptLoading: Promise<TurnstileApi> | null = null;

/** Load Cloudflare's script only when someone starts to use generation, so other visits make no third-party request. */
function loadTurnstile(): Promise<TurnstileApi> {
  scriptLoading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load")));
    s.onerror = () => { scriptLoading = null; reject(new Error("The human check couldn't load. Check your connection or content blocker.")); };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

/** A Turnstile widget in `el`. Each token works once; take() waits for a fresh one. */
export function humanCheck(el: HTMLElement) {
  let id: string | null = null;
  let token: string | null = null;
  let waiting: Array<(t: string) => void> = [];
  let api: TurnstileApi | null = null;

  async function start() {
    if (id || !TURNSTILE_SITE_KEY) return;
    api = await loadTurnstile();
    id = api.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      size: "flexible",
      callback: (t: string) => { token = t; waiting.splice(0).forEach((w) => w(t)); },
      "expired-callback": () => { token = null; },
    });
  }

  return {
    start,
    async take(): Promise<string> {
      await start();
      const t = token ?? (await new Promise<string>((r) => waiting.push(r)));
      token = null;
      // Ask for the next token right away, so a second request doesn't wait.
      if (api && id) api.reset(id);
      return t;
    },
    destroy() {
      if (api && id) api.remove(id);
      id = null;
      waiting = [];
    },
  };
}
