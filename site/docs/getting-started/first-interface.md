---
title: Your first interface
description: Create a Loom instance on a canvas, give it a spec, and listen for what people do.
---

# Your first interface

A Loom interface needs three things: a `<canvas>`, the components the instance understands, and a spec.

```html
<div style="max-width: 480px">
  <canvas id="ui"></canvas>
</div>
```

```ts
import { Loom, coreComponents } from "loom-ui";

const canvas = document.querySelector<HTMLCanvasElement>("#ui")!;
const loom = new Loom(canvas, { components: coreComponents });

loom.setSpec(`state count=0
card
  text "Clicked {count} times"
  button "Click me" on=inc:count`);
```

The canvas fills its parent's width and grows to fit its content, so size the parent rather than the canvas. That spec renders as:

```loom live
state count=0
card
  text "Clicked {count} times"
  button "Click me" on=inc:count
```

The example above was checked by building a separate Vite app against the repository's `dist/` (see [Local setup](./setup#using-it-from-another-project)).

## Listen to it

Everything the interface does is visible to your page through events:

```ts
// Any state change: a click, a keystroke, a value the spec declares.
loom.on("change", ({ key, value }) => console.log(key, value));

// Actions the spec hands to your app with emit:
loom.on("action", ({ name, value }) => {
  if (name === "order") submitOrder(value);
});
```

`on()` returns a function that unsubscribes. Call `loom.destroy()` when you remove the canvas from the page: it removes the instance's listeners and stops rendering.

## Change it

- `loom.setSpec(text)` replaces the spec. Values the person already changed are kept when the new spec declares them the same way; pass `{ resetState: true }` to start over.
- `loom.state.set("count", 10)` changes state from your app.
- `loom.setTheme(theme)` switches themes ([Themes](../integration/themes)).

The full list of options, methods and events is in [Embedding Loom](../integration/embedding).

## Add the map

The world map ships separately because its country outlines are large:

```ts
import { Loom, coreComponents } from "loom-ui";
import { mapComponents } from "loom-ui/map";

const loom = new Loom(canvas, { components: [...coreComponents, ...mapComponents] });
```

Next: [what happens between the spec and the pixels](./pipeline).
