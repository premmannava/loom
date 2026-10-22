# SayShape model proxy

A Cloudflare Worker that lets the public website generate specs with a model **without exposing the API key**. GitHub Pages only serves files, so the key can't live there: it lives here, as a Cloudflare secret.

```
playground (GitHub Pages) ──request text──▶ this worker ──key + guide + request──▶ OpenRouter
          ▲                                      │
          └──────── SayShape lines, streamed ────┘
```

The browser sends only what the person typed (at most 400 characters) and a Turnstile token. The worker builds every message itself with SayShape's model client (`src/model`): the playground's guide, the request, and one repair if the parser had to skip lines. It always calls the one model set in `wrangler.toml`, so the key can't be borrowed for anything else.

Protections, all in `src/handler.ts` and tested in `test/worker.test.ts`:

- only origins in `ALLOWED_ORIGINS` may call it;
- an optional [Turnstile](https://developers.cloudflare.com/turnstile/) check on every request;
- a per-IP rate limit (4 a minute, `[[ratelimits]]` in `wrangler.toml`);
- request size limits and a cap on reply length;
- provider errors become plain messages; the provider's raw reply is never forwarded;
- `GENERATION_ENABLED = "false"` turns it off without touching the site.

OpenRouter's free models also allow 20 requests a minute and 50 a day per account (1,000 a day once you've bought $10 of credits), shared by every visitor.

## Deploy (one time)

You need a free Cloudflare account. Run these from this folder:

```bash
npm ci
npx wrangler login                          # opens the browser to sign in to Cloudflare
npx wrangler secret put OPENROUTER_API_KEY  # paste the key when asked; it's stored encrypted by Cloudflare
npx wrangler deploy                         # prints the worker's URL, e.g. https://sayshape-model.<you>.workers.dev
```

Recommended, against bots:

1. In the Cloudflare dashboard, **Turnstile → Add widget**. Hostname: `premmannava.github.io`. Mode: Managed.
2. `npx wrangler secret put TURNSTILE_SECRET` with the widget's **secret key**.

Then tell the website where the worker is. In GitHub: **Settings → Secrets and variables → Actions → Variables**, add:

| Variable | Value |
|---|---|
| `SAYSHAPE_MODEL_ENDPOINT` | `https://sayshape-model.<you>.workers.dev/generate` |
| `SAYSHAPE_MODEL_LABEL` | `NVIDIA Nemotron 3 Ultra (free)` |
| `TURNSTILE_SITE_KEY` | the widget's **site key** (public), if you made one |

These are public values, so they're Variables, not Secrets. Re-run the **Website** workflow (or push to `main`) and the site gets a **Build with AI** page in its navigation. Without `SAYSHAPE_MODEL_ENDPOINT`, the site keeps running saved specs only.

Also in OpenRouter, give this key a **credit limit of $0** (Settings → Keys), so even if something went wrong it couldn't spend money.

## Change or turn off

- Another model: edit `MODEL` in `wrangler.toml` and `npx wrangler deploy`.
- Turn generation off: set `GENERATION_ENABLED = "false"` and deploy. The site says generation is off.
- Rotate the key: create a new one in OpenRouter, `npx wrangler secret put OPENROUTER_API_KEY`, delete the old one.

## Run it locally

```bash
printf 'OPENROUTER_API_KEY=sk-or-...\nALLOWED_ORIGINS=http://localhost:4173\n' > .dev.vars   # ignored by git
npx wrangler dev                            # http://localhost:8787/generate
```

Build the site against it with `VITE_SAYSHAPE_MODEL_ENDPOINT=http://localhost:8787/generate npm run site:build`, then `npm run site:preview`.
