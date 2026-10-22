---
title: Conditional visibility
description: Showing and hiding SayShape elements with if=, and if blocks for several lines at once.
---

# Conditional visibility

Every element accepts `if=`. The element, and everything inside it, is shown only while the condition is true.

```loom live
state water=true read=false walk=true
card
  check "Water" bind=water
  check "Read" bind=read
  check "Walk" bind=walk
  text "Water packed" tone=good if=water
  text "All done" tone=good if={water && read && walk}
```

`if=` takes a state name (`if=water`) or an expression (`if={count > 0}`). Hidden elements take no space and can't be focused or pressed.

## Several lines under one condition

Put the lines under a line holding only `if=`. Like `each`, it has no look of its own:

```loom live
state todos=[{text: "Water", done: true}, {text: "Map", done: true}]
card
  each items=todos as=t
    check "{t.text}" bind=t.done
  if={count(todos, 'done') == len(todos)}
    text "All done!" tone=good
    button "Start over" variant=secondary on=clear:todos
  empty "Nothing left to do" if={len(todos) == 0}
```

## Choosing a look with an expression

Props that take a fixed set of values, such as `tone=` and `variant=`, can also be expressions, which is often clearer than two elements with opposite conditions:

```loom live
state remaining=-40
card
  stat label="Remaining" value={money(remaining)} tone={remaining < 0 ? 'bad' : 'good'}
  button "Adjust" variant={remaining < 0 ? 'primary' : 'secondary'} on=set:remaining:120
```

## Empty and loading states

An `empty` element with `if=` covers the "nothing to show" case. While data is on its way from your app, `skeleton` placeholders can stand in ([Loading, success and failure](../integration/states)).
