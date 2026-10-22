/**
 * The model proxy for the public website: a Cloudflare Worker that turns a
 * person's request into a SayShape spec with a model, without the API key
 * ever reaching the browser.
 *
 * The browser sends only the request text (and a Turnstile token). The
 * worker builds every message itself, with SayShape's own model client
 * (src/model): the guide, the request and at most one repair. So the key
 * can only ever be used for this one model and this one job.
 *
 *   POST /generate   {"request": "...", "token": "..."}
 *   → 200 application/x-ndjson, one JSON object per line:
 *       {"t":"phase","v":"writing"}   what the model is doing
 *       {"t":"text","v":"card\n"}     clean SayShape lines, to push into the engine
 *       {"t":"reset"}                 throw away what was shown: a repair is coming
 *       {"t":"done","spec":"…","problems":0,"repaired":false,"ms":1234}
 *       {"t":"error","message":"…"}   a message to show; the stream ends
 *
 * Plain functions with no Cloudflare types, so test/worker.test.ts can run
 * it in Node with a fake model.
 */
import { generateSpec, ModelError, type Phase } from "../../src/model";
import { coreComponents } from "../../src/components";
import { Registry } from "../../src/registry";
import { playgroundGuide } from "../../playground/model-guide";

export interface Env {
  /** The provider key. A secret: `wrangler secret put OPENROUTER_API_KEY`. */
  OPENROUTER_API_KEY?: string;
  /** The one model this proxy calls, e.g. nvidia/nemotron-3-ultra-550b-a55b:free. */
  MODEL?: string;
  /** OpenAI-compatible base URL. Default: OpenRouter. */
  MODEL_URL?: string;
  /** Comma-separated origins allowed to call, e.g. https://premmannava.github.io */
  ALLOWED_ORIGINS?: string;
  /** Turnstile secret. When set, every request needs a valid token. */
  TURNSTILE_SECRET?: string;
  /** "false" turns generation off without redeploying the site. */
  GENERATION_ENABLED?: string;
  /** Workers rate limiting binding, keyed by IP. Optional. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export interface Deps {
  fetch?: typeof fetch;
  /** Keeps the worker running until the stream ends (ctx.waitUntil on Cloudflare). */
  waitUntil?: (p: Promise<unknown>) => void;
}

export const MAX_REQUEST_CHARS = 400;
const MAX_BODY_BYTES = 8_000;
const MAX_TOKENS = 3_000;
const SITE = "https://premmannava.github.io/sayshape/";
const registry = new Registry(coreComponents);

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const allowedOrigins = (env: Env) => (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** What a person sees when the model call fails. Never the provider's raw reply. */
export function friendlyError(e: unknown): string {
  if (e instanceof ModelError) {
    if (e.status === 429) return "The free model has reached its limit for now. Try again later, or run SayShape locally with your own model.";
    if (e.status === 401 || e.status === 403) return "The model service rejected this site's credentials. Generation is unavailable right now.";
    if (e.status === 402) return "The model service needs credits for this request. Generation is unavailable right now.";
    if (e.status !== undefined && e.status >= 500) return "The model service had a problem. Try again in a minute.";
    return "The model didn't answer as expected. Try again, or with a shorter request.";
  }
  return "Something went wrong while generating. Try again.";
}

async function verifyTurnstile(env: Env, token: string, ip: string, doFetch: typeof fetch): Promise<boolean> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET!);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const url = new URL(req.url);
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins(env);

  if (url.pathname !== "/generate") return json(404, { error: "Not found" });
  // Only the site may call. (Origin can be forged outside a browser; Turnstile and rate limits cover that.)
  if (!allowed.includes(origin)) return json(403, { error: "This origin isn't allowed" });
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST" }, cors);

  if (env.GENERATION_ENABLED === "false") return json(503, { error: "Generation is turned off right now." }, cors);
  if (!env.OPENROUTER_API_KEY || !env.MODEL) return json(503, { error: "Generation isn't configured." }, cors);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Request too large" }, cors);
  let body: { request?: unknown; token?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return json(400, { error: "Send JSON" }, cors); }
  const request = typeof body.request === "string" ? body.request.trim() : "";
  if (!request) return json(400, { error: "Describe the interface you want." }, cors);
  if (request.length > MAX_REQUEST_CHARS) return json(400, { error: `Keep the request under ${MAX_REQUEST_CHARS} characters.` }, cors);

  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  if (env.TURNSTILE_SECRET) {
    const token = typeof body.token === "string" ? body.token : "";
    if (!token || !(await verifyTurnstile(env, token, ip, doFetch))) return json(403, { error: "The human check failed. Reload the page and try again." }, cors);
  }
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: ip || "unknown" });
    if (!success) return json(429, { error: "Too many requests. Wait a minute and try again." }, cors);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: Record<string, unknown>) => writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});

  const run = async () => {
    try {
      const result = await generateSpec({
        config: {
          url: env.MODEL_URL ?? "https://openrouter.ai/api/v1",
          model: env.MODEL!,
          apiKey: env.OPENROUTER_API_KEY,
          maxTokens: MAX_TOKENS,
          headers: { "HTTP-Referer": SITE, "X-Title": "SayShape playground" },
        },
        registry,
        request,
        guide: playgroundGuide([]),
        // One repair, only for lines the parser had to skip: a free model has few requests a day.
        repairOn: "errors",
        signal: req.signal,
        fetch: doFetch,
        onText: (v) => void send({ t: "text", v }),
        onReset: () => void send({ t: "reset" }),
        onPhase: (v: Phase) => void send({ t: "phase", v }),
      });
      await send({ t: "done", spec: result.spec, problems: result.diagnostics.length, repaired: !!result.repair, ms: Math.round(result.timings.totalMs) });
    } catch (e) {
      if (!req.signal?.aborted) await send({ t: "error", message: friendlyError(e) });
    } finally {
      await writer.close().catch(() => {});
    }
  };

  // Keep the worker alive until the stream finishes, where the platform offers waitUntil.
  const done = run();
  deps.waitUntil?.(done);
  return new Response(readable, { status: 200, headers: { ...cors, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
