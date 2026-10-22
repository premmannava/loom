---
title: Elements and nesting
description: SayShape's line syntax. One element per line, quoted text, props, indentation for nesting, and comments.
---

# Elements and nesting

A SayShape spec is a list of lines. Each line is one element: its type, then optional quoted text, then `name=value` props.

```loom live
button "Save changes" variant=secondary on=emit:save
```

## Props

A prop value can be written three ways:

| Form | Example | Use it for |
|---|---|---|
| Bare | `variant=secondary` | Single words and numbers |
| Quoted | `label="Water (L)"` | Text with spaces or symbols |
| Expression | `value={price * qty}` | Anything computed from state ([Expressions](./expressions)) |

Quotes inside quoted text are escaped with a backslash. Quoted text can also include `{expressions}`, which are filled in from state:

```loom live
state guests=2 nights=3
text "Cabin for {guests} guests, {nights} nights"
text "She said \"see you there\"" tone=muted
```

Each component accepts the props listed in the [component reference](../components/), and every element also accepts `if=` ([Conditional visibility](./conditions)). An unknown prop or a value outside a prop's allowed list is a warning: the element still renders and the bad part is ignored.

## Nesting

Indent children under their container. Two spaces is the convention; a tab counts as two spaces.

```loom live
card
  text "Your order" style=title
  row
    button "Cancel" variant=secondary
    button "Pay"
```

The top level of a spec behaves like a `column`: unindented elements stack vertically. Some elements only go inside a particular parent, like `list-item` inside `list` or `tab` inside `tabs`; the reference says where each one can go. Elements can nest at most 100 levels deep.

Indentation is the only structure. There are no closing lines, which is what lets a half-written spec render: every line is complete on its own ([Streaming](../getting-started/pipeline#streaming)).

## Lines that aren't elements

| Line | Meaning |
|---|---|
| `state name=value …` | Declares state ([State](./state)) |
| `derive name={expression} …` | Declares a derived value ([Derived values](./derived)) |
| `each items=… as=…` | Repeats what's indented under it ([Lists](./lists)) |
| `if={condition}` | Shows what's indented under it only while the condition holds ([Conditions](./conditions)) |
| `# a comment` | Ignored |

```loom live
# Starting values come first.
state ready=false
card
  check "Ready to go" bind=ready
  text "Let's go!" tone=good if=ready
```

## No colors, fonts or sizes

Specs never set colors, fonts or pixel sizes. They choose roles instead, and the theme decides what each role looks like:

```loom live
text "Section" style=title
text "Saved" tone=good
text "Card declined" tone=bad
button "Delete" variant=danger
badge "New" tone=accent
```

A few layout props take numbers (`gap=`, `pad=`, `size=`, `min=` on a grid), which are spacing in pixels within the theme's design, not styling. This keeps every generated screen consistent with your app, and it's why a request for "a big red button" can't be followed literally.
