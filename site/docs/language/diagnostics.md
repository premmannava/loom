---
title: Validation and diagnostics
description: How SayShape reports problems in a spec. Errors skip a line, warnings ignore the bad part, and the parser never stops.
---

# Validation and diagnostics

SayShape never stops on a mistake. Every problem becomes a **diagnostic** with a line number, and the rest of the spec still renders. This matters most for model output: one invented prop shouldn't blank the whole screen.

| Severity | Caused by | What happens |
|---|---|---|
| **Error** | An unknown element, an element in the wrong place, nesting more than 100 levels | That line and everything indented under it are skipped |
| **Warning** | An unknown prop, a value outside a prop's list, a broken expression, a name nothing defines, a loop variable outside its `each`, writing to a derived value | The element renders; the bad part is ignored |

```loom invalid live
state qty=2
card
  text "Order" style=title
  sparkle "Shiny"
  button "Pay" colour=red variant=huge on=emit:pay
  text "Total: {qty * pricee}"
```

Messages say what was wrong and how to fix it, for example:

```text
L4  Unknown element "sparkle". It was skipped, along with anything inside it
L5  "button" has no prop "colour". Known props: on, variant, disabled, if
L5  variant should be one of primary, secondary, danger; got "huge"
L6  "pricee" isn't state or a loop variable, so it shows as nothing. To show it as text, quote it: 'pricee'. To use state, declare it: state pricee=…
```

## Where diagnostics go

- `ui.diagnostics` holds the current list, and the `diagnostics` event fires when it changes.
- `parse(text, registry)` returns `{ root, diagnostics, … }` without rendering, which is how a server can check a spec ([Streaming, validation and repair](../integration/streaming)).
- The [playground](/playground) lists them under **Problems**, marks their lines, and jumps to a line when you click one.

## Problems found while running

Some problems only appear once a spec runs: a blocked image, a chart given something that isn't a list, a table too wide for its space, a derived value that can't be worked out. These go to the `onWarning` option (by default `console.warn`), once per spec rather than every frame. In `loom-ui/testing` they're collected in `ui.warnings`.

## Validating examples

Every SayShape example on this website is parsed in the repository's tests, and must produce no diagnostics unless it's one of the examples marked as invalid on purpose, like the ones on this page.
