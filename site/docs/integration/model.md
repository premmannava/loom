---
title: Connecting a model
description: Generating SayShape specs with a model. The development playground's local setup, loom-ui/model in your own app, and the evaluation script.
---

# Connecting a model

SayShape doesn't include a model. It works with any server that speaks the OpenAI chat completions format: LM Studio, Ollama, vLLM or llama.cpp on your own machine, or hosted APIs such as DeepSeek, OpenAI and OpenRouter.

::: info Generating on this website
GitHub Pages serves static files only, so it can't keep an API key secret. On the **Build with AI** page, requests go through a small proxy (`worker/` in the repository, a Cloudflare Worker) that holds the key and calls one fixed free model. The browser never sees the key. Without the proxy, that page isn't shown and the playground runs saved and edited specs only.
:::

## Try it locally

1. Start a model server. With **LM Studio**: load a model, open the Developer tab and start the server. It listens on `http://localhost:1234/v1`, which is the default, so no settings are needed.
2. For any other server, copy `.env.example` to `.env.local` and fill it in. `.env.local` is ignored by git.
3. Run `npm run dev`, choose the model in the **Ask a model** box, describe a screen and press **Ask**.

```bash
# .env.local
LOOM_MODEL_URL=http://localhost:1234/v1   # LM Studio (default); Ollama: http://localhost:11434/v1
LOOM_MODEL=                               # optional: the model to preselect
LOOM_API_KEY=                             # only for servers that need one
LOOM_USER_SUFFIX=                         # optional: added to every request, e.g. /no_think for Qwen3
```

The dev server forwards the playground's requests from `/api/model` to the model server and adds the key there, so the browser never sees it and the model server needs no CORS settings. While it runs, the status line says what the model is doing (waiting, thinking, writing, fixing problems) and, when it's done, how long it took and whether a repair was needed. **Refine this screen** asks for changes to the current screen instead of a new one.

Reasoning models think before writing, which delays the first line. Their thinking is hidden from the screen.

The repository also has a general-purpose demo at `/playground/connected-order/index.html` on the same dev server, with timing diagnostics for each request.

## In your own app

`loom-ui/model` does what the playground does: it streams a spec from an OpenAI-compatible endpoint, removes thinking and code fences, checks the result with SayShape's parser, and asks once for a fix if there are problems.

```ts
import { generateSpec } from "loom-ui/model";

ui.beginStream();
const result = await generateSpec({
  config: { url: "/api/model", model: "qwen3-14b" }, // a route on your server that adds the key
  registry: ui.registry,
  request: "A booking form for a cabin, 2 to 6 guests",
  guide: {
    mode: "compact",
    actions: [{ name: "book", value: "the number of guests", description: "when the person books" }],
    notes: "A cabin rental site. Prices are per night.",
  },
  onText: (text) => ui.push(text),
  onReset: () => ui.beginStream(), // a fix is coming: start the screen over
});
ui.endStream();
// result.spec, result.diagnostics, result.first, result.repair, result.timings, result.usage, result.messages
```

::: danger Keep API keys on a server
Point `config.url` at a route on your own backend that adds the key, as the dev server does. Never put a model API key in front-end code, and don't ask visitors to paste theirs into a page.
:::

### A backend for a hosted site

A public site that generates specs needs a server-side endpoint that:

- holds the provider key and adds it to requests;
- streams the response through, so specs still render line by line;
- limits who can call it and how often, since every request costs money.

The repository's `worker/` is a small example of exactly this, used by this website: a Cloudflare Worker with an origin check, an optional Turnstile check, per-IP rate limits and size caps, which builds every message itself so the key only ever serves its one job. A general production server package is still on the roadmap.

## Measure it

Whether a model writes good SayShape is something to measure, not assume. The repository's evaluation runs a fixed set of requests against your model and checks the results:

```bash
npm run eval                        # every request, with the model from .env.local
npm run eval -- --model qwen3-14b   # another model on the same server
npm run eval -- --only data,hard    # some categories or request ids
npm run eval -- --guide full,compact  # compare guide modes
```

`eval/cases.ts` covers forms, comparisons, dashboards, shopping, multi-screen flows, lists of data and traps like "a big red button" (SayShape has no colors). Some requests also have **behavior checks**: the spec is rendered with the real engine and used, so ticking a box must change a count and changing a quantity must change a total. The report shows how many specs were valid on the first try and after one repair, how many worked when used, invented props or elements, token usage as the server reports it, and time to the first line. Results go to `eval/results/`, which git ignores.
