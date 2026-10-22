---
title: Embedding Loom
description: The Loom class. Options, methods and events for rendering specs in your own page.
---

# Embedding Loom

> Loom isn't published to npm yet. Build it and install the repository folder as a local dependency ([Local setup](../getting-started/setup#using-it-from-another-project)). The package name is `loom-ui`.

```ts
import { Loom, coreComponents } from "loom-ui";
import { mapComponents } from "loom-ui/map";

const canvas = document.querySelector("canvas")!;
const loom = new Loom(canvas, {
  components: [...coreComponents, ...mapComponents],
});

loom.setSpec(`state count=0
card
  text "Clicked {count} times"
  button "Click me" on=inc:count`);
```

The canvas fills its parent's width, follows it when the parent resizes, and grows to fit its content. It's focusable, and draws its own focus ring around the focused element.

## Options

| Option | Default | Description |
|---|---|---|
| `components` | required | The components this instance understands |
| `theme` | `"auto"` | A `Theme`, or `"auto"` to follow light and dark mode and `--loom-*` CSS variables ([Themes](./themes)) |
| `width` | parent width | A fixed width in CSS pixels |
| `minHeight` | `0` | Minimum canvas height |
| `padding` | `20` | Space around the whole screen |
| `animate` | `true` | Fade new elements in; off when the person prefers reduced motion |
| `imageHosts` | `[]` | Hosts images may load from besides your own site ([Images](./images)) |
| `loadImage` | an `<img>` with CORS | Custom image loading, for tests, server rendering or signed URLs |
| `onWarning` | `console.warn` | Problems found while running, like a blocked image |
| `editor` | an `<input>` over the field | How text fields are typed into; `loom-ui/testing` passes a fake one |
| `today` | the device's local day | Today's date as `() => "YYYY-MM-DD"`, for date pickers |
| `viewport` | from the window | The visible part of the canvas, for placing popups |

## Methods

| Method | Description |
|---|---|
| `setSpec(text, { resetState? })` | Replace the whole spec |
| `beginStream({ keepState? })` | Start a streamed spec; clears state unless `keepState` |
| `push(chunk)` | Append streamed text; only complete lines render |
| `endStream()` | Finish the stream and render the last line |
| `on(event, handler)` | Subscribe to an event; returns an unsubscribe function |
| `state.get(key)`, `state.set(key, value)` | Read or change state from your app |
| `go(screen)`, `back()` | Show another screen, or the previous one |
| `screens`, `currentScreen`, `canGoBack` | The spec's screen names, the visible one, and whether `back()` can move |
| `notify(text)` | Show a short message, as `notify:` does |
| `imagesLoaded()` | Resolves once every requested image has loaded or failed |
| `setTheme(theme)` | Switch themes |
| `find(type)` | All nodes of a type, e.g. `loom.find("button")` |
| `diagnostics`, `spec`, `tree` | The current problems, source text and parsed tree |
| `inspector` | Debugging overlays and frame capture ([Architecture](../architecture/#debugging)) |
| `destroy()` | Remove listeners and stop rendering |

## Events

| Event | Payload | When |
|---|---|---|
| `action` | `{ name, value, node }` | An `emit:` action ran |
| `change` | `{ key, value }` | A state value changed, including values a spec declares |
| `diagnostics` | `Diagnostic[]` | The spec's problems changed |
| `render` | `Metrics` | A frame was painted (element count and timings) |
| `navigate` | `{ screen, from }` | The visible screen changed |
| `notify` | `{ text }` | A message was shown |
| `inspect` | `{ node, box }` or `null` | Inspect mode selected something |

## Lifecycle in a component framework

Create the instance once the canvas is in the document, and destroy it when the canvas goes away. In Vue, for example (this site does exactly this):

```ts
let loom: Loom | null = null;
onMounted(() => {
  loom = new Loom(canvasRef.value!, { components: coreComponents });
  loom.setSpec(spec);
});
onBeforeUnmount(() => loom?.destroy());
```

With server-side rendering or static generation, import and construct Loom only in the browser: it needs a canvas, `window` and fonts.

## Fonts

The default theme draws with Instrument Sans and IBM Plex Mono, falling back to system fonts. Load them in your page if you want that look; the engine lays out again when web fonts finish loading. Canvas text doesn't start a font download on its own, so load them before the first render, for example with `document.fonts.load('400 15px "Instrument Sans"')`.

## Keyboard and touch

Tab and Shift+Tab move between interactive elements, and Enter or Space presses the focused one. Sliders also follow the arrow keys, Page Up, Page Down, Home and End; selects and date pickers open with Enter, Space or the arrows. On touch screens, vertical swipes still scroll the page and pinches still zoom, while horizontal drags go to the canvas, so sliders can be dragged.
