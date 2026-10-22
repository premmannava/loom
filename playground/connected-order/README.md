# Build with a model

Open **http://localhost:5173/playground/connected-order/index.html** with the repository's `npm run dev` server and a configured model endpoint. The URL is retained from the earlier equipment demo.

Type any UI request into the box and press Enter or Generate. For example:

- Build a tip calculator with a tip slider and a total.
- Build an interactive packing checklist for a weekend trip.
- Build a monthly budget calculator with income and expenses.

Press **Load monthly budget example** to try a tested dashboard with October/November and category filters, derived totals, a budget slider, an expense chart, sortable/selectable table rows, and selected-expense details.

The page uses `LOOM_MODEL` when configured, or discovers a local Qwen model through the existing `/api/model` proxy (by default LM Studio on port 1234). Set `LOOM_MODEL_URL`, `LOOM_MODEL`, and `LOOM_API_KEY` in the ignored `.env.local` file to use an OpenAI-compatible hosted provider. The dev server adds authentication; never place the API key in browser code. Restart the dev server after changing these settings. It sends the compact SayShape guide and your request, validates the returned spec, and displays the interface below. Each request starts a new interface with fresh state. Cancel or a failed generation preserves the previous interface.

The prompt controls and result both render through SayShape. Generated controls and calculations run locally. No equipment catalog, order contract, or backend is attached. If a generated interface emits a host event, the page explains that no backend is connected for that action. Model generation still depends on the model's ability and SayShape's supported components.

`main.ts` is the complete general-purpose demo. The earlier equipment reference files (`spec.ts`, `service.ts`, `host.ts`, `generation.ts`) remain available as separate integration examples but are not used by this page.

## Timing diagnostics

Each request shows elapsed time while running. Generation diagnostics below the result show model discovery, first received token/chunk, first usable SayShape line, initial and repair attempt durations, token usage, approximate observed output speed, and synchronous SayShape parse/layout/paint time. First-token time combines server queueing, prompt processing and transport; these cannot be separated from client timings. Render time excludes browser compositing.

The page requests streaming usage from the model server. Missing usage stays unavailable; input estimates are explicitly marked. Output speed divides reported completion tokens by time after the first chunk through attempt completion, so it includes reasoning when counted by the server and may include final stream overhead. It is not the server's internal decode speed. Interrupted requests may have unavailable attempt metrics.

The latest 20 runs are kept in page memory and logged to the browser console. Download timing log exports JSON including the requests, model names, errors and metrics. Reloading clears this history; nothing is uploaded or stored in localStorage.

## Publishing

This page currently depends on the Vite development proxy. A static upload alone cannot serve model requests. Public hosting needs a server-side streaming model endpoint, server-side secrets, persistent request limits, and a production build entry for this page. The general sandbox has no connected purchasing backend.
