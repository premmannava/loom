---
title: State
description: Declaring state in a SayShape spec. Numbers, text, true/false, null, lists and records, and what happens to state when a spec changes.
---

# State

State is what an interface remembers: a quantity, whether a box is ticked, the list of items in a cart. Declare it on unindented `state` lines, usually at the top:

```loom
state qty=2 price=24 gift=false name="Ada" picked=null
state todos=[{text: "Pack water", done: false}, {text: "Snacks", done: true}]
```

Values can be numbers, `true` and `false`, `null`, quoted text, lists `[…]` and records `{name: value}`. Several pairs can share one line, and a spec can have as many `state` lines as it needs.

```loom live
state qty=2 price=24
card
  stepper "Quantity" bind=qty min=1 max=10
  text "Total: ${qty * price}" style=lead
```

## Rules

- **One line per value.** A value must fit on one line, however long, so a streamed spec can render line by line.
- **Data only.** Lists and records are parsed as data, never run. They can nest at most 20 levels and hold at most 10,000 values.
- **Read anywhere.** A state name can be read in text, props, conditions and expressions anywhere in the spec, on any screen.
- **Changed by the interface.** Controls write state through [`bind=`](./bindings), and buttons through [actions](./actions).
- **Changed by your app.** `ui.state.set("products", rows)` and `ui.state.get("qty")` ([Host data and events](../integration/host-data)).

## When the spec changes

A `state` line sets a **starting** value. What happens to it later depends on what changed:

| Situation | Result |
|---|---|
| The spec is re-parsed with the same declaration (while streaming, or after an edit elsewhere) | A value the person already changed is kept |
| A new spec declares a different starting value (a refined screen with new data, say) | The new value replaces the old one |
| Your app set the value with `ui.state.set` | A declaration never replaces it |
| `ui.setSpec(text, { resetState: true })` | Everything starts over |

This is what the playground's **Reset state** button does: it keeps the spec and starts its state over.

## The visible screen

The engine keeps the name of the visible [screen](./actions#screens) in `{screen}`. Don't use `screen` as a name of your own.
