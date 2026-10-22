---
title: From spec to pixels
description: How a Loom spec becomes an interface. The model's part ends at the text; the engine parses, lays out, paints and runs it.
---

# From spec to pixels

There are two halves to every Loom interface, and they never mix.

**Generating** is a model's job (or a person's). The output is text in Loom's language and nothing else. The model is told what it may write by a [guide generated from the components](../integration/model-guide), and its text is checked by Loom's own parser before anything relies on it.

**Rendering and running** is the engine's job, in the browser. From here on no model is involved: state changes, totals, filtering, screen changes and focus are all handled locally.

<EngineDiagram />

## The stages

1. **Parse** (`src/parser.ts`). Each line becomes a node, and indentation decides its parent. Props are checked against the component definitions, and every problem becomes a [diagnostic](../language/diagnostics) with a line number. The parser never throws. While a spec streams in, an unfinished last line is ignored.
2. **Layout** (`src/layout.ts`). Each component sets its own height for a given width; containers place their children. The result is a box (x, y, width, height) for every element. Layout only needs a text measurer, so it runs and is tested in Node, without a canvas.
3. **Paint** (`src/engine.ts`). Boxes are drawn in order with canvas calls, in colors and sizes from the [theme](../integration/themes). Interactive elements register hit regions while they paint.
4. **Input.** A click, tap or key press is matched against the hit regions, the element's [actions](../language/actions) run, state changes, and layout runs again.

## Streaming

Because a spec is one element per line and nothing needs a closing line, any prefix of a valid spec, cut at a line boundary, is itself a valid and smaller spec. That's what lets an interface appear while a model is still writing:

```ts
loom.beginStream();
for await (const chunk of modelResponse) loom.push(chunk); // only complete lines render
loom.endStream();
```

The repository's tests check this property for every sample: each prefix must parse into a valid tree. The [landing page demo](/) and the playground's **Replay as stream** use the same three calls with a saved spec, so you can see the effect without a model.

## What the engine owns

- **Its own layout.** No HTML elements or CSS layout are used for the interface. The one exception is text entry: while someone types in a field, a real `<input>` is placed exactly over it so the browser handles typing, selection, input methods and autofill. It's removed when they leave the field.
- **Its own state.** Declared in the spec, readable and writable from your app ([Host data and events](../integration/host-data)).
- **Its own expressions.** `{…}` is evaluated by Loom's own small language, which can't reach JavaScript ([The expression boundary](../architecture/security)).
- **The look.** Specs choose roles such as `tone=` and `variant=`; the theme decides colors, fonts, spacing and radii.

More detail is in [How the engine works](../architecture/).
