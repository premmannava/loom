---
title: Streaming, validation and repair
description: How SayShape renders a model's response as it streams, cleans it, checks it with the parser, and asks once for a fix.
---

# Streaming, validation and repair

## Streaming

The engine renders a spec while it arrives:

```ts
loom.beginStream();           // clears state unless { keepState: true }
loom.push(chunk);             // as often as text arrives; only complete lines render
loom.endStream();             // renders the last line
```

Any prefix of a valid spec, cut at a line boundary, is a valid and smaller spec, so the screen grows line by line instead of waiting for the whole response. The repository tests this for every sample and every way of chunking it.

## Cleaning

Models don't always send just SayShape. `loom-ui/model` cleans the text as it streams: it drops thinking (`<think>…</think>`, and reasoning a server sends separately), Markdown code fences and chatter before the spec starts, and joins a state value a model spread over several lines back into one line. When a model writes its whole spec inside a thinking block it never closes, the spec is recovered from there (`result.first.recovered`).

## Validation

When the response is complete, it's parsed with the same registry the engine uses. Every problem is a [diagnostic](../language/diagnostics) with a line number. You can do the same on a server without rendering:

```ts
import { parse, Registry, coreComponents } from "loom-ui";

const registry = new Registry(coreComponents);
const { diagnostics } = parse(specText, registry, { knownNames: ["products"] });
if (diagnostics.some((d) => d.severity === "error")) rejectOrRepair(diagnostics);
```

## Repair

If the parser finds problems, `generateSpec` asks the model once to write the spec again, listing each problem with its line number. Then:

- the final `result.spec` is the repaired spec unless the repair came back empty or with more problems, in which case the first is kept;
- `onReset` is called before the repair streams in, so you can start the screen over;
- `result.first` and `result.repair` record each attempt: its spec, diagnostics, timing, token usage as reported by the server, and the guide used.

| Option | Effect |
|---|---|
| `repairOn: "any"` (default) | Repair on any diagnostic |
| `repairOn: "errors"` | Repair only when a line was skipped |
| `repairOn: "never"` | Never repair |
| `repairGuide: "full"` | With a compact guide, send the full guide for the repair |
| `enforceProfile: true` | Elements outside the guide's profile count as problems |

There's one repair at most. A spec that's valid can still do the wrong thing, which is why the evaluation also renders specs and uses them ([Measure it](./model#measure-it)).

## Changing a screen

To change the current screen ("make the total bigger"), pass a `refine` context instead of the whole conversation. It sends the original task, requirements that must always hold, the changes asked for since, the current spec (hand edits included) and the new change, so a change costs about the same on the tenth turn as on the second.

```ts
import { generateSpec, nextRefineContext, type RefineContext } from "loom-ui/model";

let context: RefineContext = { task: "A packing list for a 3-day hike", requirements: ["Prices in euros"], spec: first.spec };
const r = await generateSpec({ config, registry, request: "Add a progress bar", refine: { ...context, spec: loom.spec } });
context = nextRefineContext(context, "Add a progress bar", r.spec);
```

## Usage and timing

`result.timings` has the time to the first token, the time to the first renderable line, and the total. `result.usage` adds up the server's token counts; a total is `undefined`, meaning unknown, when a server didn't report it, never zero. Many servers only report usage while streaming when asked: set `config.streamUsage: true` for those that support it.
