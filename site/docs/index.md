---
title: What SayShape is
description: SayShape is a line-based UI language for models to write, and an engine that parses, lays out, paints and runs it on a canvas.
---

# What SayShape is

SayShape is two things designed together:

1. **A UI language for models to write.** One element per line, indentation for nesting. A spec describes elements, state, calculations and actions. It can't run code, and it never contains colors, fonts or pixel sizes.
2. **An engine that renders that language on its own.** SayShape has its own parser, layout, painter, state store and pointer and keyboard handling, and draws onto a single `<canvas>`. It doesn't use HTML elements, CSS layout, React or any other UI framework for the interface it renders.

```loom live
state days=2 hikers=3
card
  text "Weekend hike" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
```

The goal is **generative UI**: a model produces an interface at runtime, in response to a person, and the engine renders it safely and consistently. SayShape isn't trying to replace frameworks for interfaces people build by hand. It's meant to be the layer a model speaks.

## Two separate jobs

| | Who does it | What it produces |
|---|---|---|
| **Writing the spec** | A model (or a person) | Text in SayShape's language |
| **Running the interface** | The SayShape engine, in the browser | Pixels, state, and events for your app |

A model never writes JavaScript, CSS or components. It writes a spec using the [components](./components/) that are registered with the engine, and the engine checks every line against their definitions. Once a spec is on screen, everything it describes runs locally: typing filters a list, a stepper changes a total, a button moves to another screen. Nothing goes back to the model unless your app sends it, for example when a spec [emits an action](./language/actions#talking-to-the-host).

## Why a language instead of code

| | Model writes React or JSX | Model writes SayShape |
|---|---|---|
| Half-finished output | Can't render until it compiles | Every finished line renders |
| A mistake in the output | One syntax error can break the component | The bad line is skipped with a line-numbered message |
| Safety | Generated code has to be sandboxed | Specs can't run code |
| The look | Whatever styles the model writes | The engine's theme; the model only picks roles like `variant=secondary` |
| Build step | Compile and bundle | None: text in, pixels out |

These are design properties, not benchmark results. SayShape hasn't been measured against other generative UI formats yet, and whether a given model writes good SayShape depends on the model; the repository has an [evaluation script](./integration/model#measure-it) for checking that.

## Status

SayShape is an **early prototype, version 0.1**. The engine, the language, 41 components, a model client and the tests are working. It isn't on npm yet, canvas content isn't available to screen readers, and there's no scrolling region, dialog or menu. Read [Limits and status](./architecture/limitations) before relying on it.

::: info Earlier working name
SayShape was called Loom while it was being built, and a few names still say so: the package (`loom-ui`), the CSS variables (`--loom-*`), the ` ```loom ` code fence, and the model guide, which tells models they're writing "Loom". These will be renamed before the first npm release.
:::

## Where to go next

- [Local setup](./getting-started/setup): clone, install and run the development playground.
- [Your first interface](./getting-started/first-interface): render a spec in your own page.
- [From spec to pixels](./getting-started/pipeline): what happens to each line.
- The [playground](/playground) and [examples](/examples/), to try specs without installing anything.
