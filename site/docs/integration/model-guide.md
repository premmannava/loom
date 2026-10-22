---
title: The model guide
description: The instructions a model gets for writing Loom, generated from the component definitions, in full and compact modes, with profiles.
---

# The model guide

A model learns Loom from a guide: a system prompt that explains the syntax and describes every element it may use. The guide is **generated** by `languageGuide(registry, options)` from the same component definitions the parser validates against, so it can't describe a prop that doesn't exist or miss one that does.

```ts
import { languageGuide } from "loom-ui";

const guide = languageGuide(loom.registry, { mode: "compact", profile: "forms" });
```

`generateSpec` builds it for you from the `guide` option ([Connecting a model](./model#in-your-own-app)).

## Full and compact

- **Full** (the default) describes each element with its props, allowed values and an example, and includes several worked examples.
- **Compact** describes each element in one line: props with their types and values (`!` marks a required one), where it goes and what it's for. It keeps the rules that change what a spec does, and shows one worked example.

The development playground uses the compact guide with a few extra notes, to leave room on local models with small context windows.

## Profiles

A profile chooses which elements the model is told about: `forms`, `lists`, `shop`, `dashboard`, or a list of names. Elements bring what they need (`tab` brings `tabs`), and `column` and `text` are always included. A profile only changes the guide. The renderer can still show every registered element, and specs are checked against the renderer's elements unless you pass `enforceProfile: true` to `generateSpec`.

## Size

Computed from the current components when this site was built:

<!--@include: ../../.generated/guide-sizes.md-->

A smaller guide is cheaper and faster to read. Whether a model writes screens as good with it is a question for `npm run eval -- --guide full,compact` on that model; the full guide stays the default until that's been shown.

## Describing your app

```ts
languageGuide(registry, {
  imageHosts: ["cdn.example.com"],
  actions: [{ name: "book", value: "the number of guests", description: "when the person books" }],
  notes: "A cabin rental site. Prices are per night.",
});
```

- `imageHosts`: which image hosts work ([Images](./images)). With none, the model is told to use only URLs it was given.
- `actions`: the `emit:` names your app handles, so the model uses those names.
- `notes`: anything else about your app, its audience or its data.

The app's own context comes last, so the part that's the same for every app stays a shared prefix, which servers with prefix caching can reuse.

## The compact guide

This is `languageGuide(registry, { mode: "compact" })` with every component registered, as generated for this site. The [playground](/playground) has a **Copy model guide** button with the playground's version, for trying Loom in any chat assistant.

::: details Show the compact guide
<!--@include: ../../.generated/guide-compact.md-->
:::
