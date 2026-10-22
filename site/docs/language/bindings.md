---
title: Bindings
description: How Loom controls read and write state through bind=, including paths into list items and records.
---

# Bindings

Controls connect to state with `bind=`. A bound control shows the state's current value and writes to it when someone uses it. Nothing else is needed: there are no change handlers.

```loom live
state agreed=false size="m" qty=1 volume=40 name=""
card
  check "I agree to the terms" bind=agreed
  row
    radio "Small" bind=size value=s
    radio "Medium" bind=size value=m
    radio "Large" bind=size value=l
  stepper "Quantity" bind=qty min=1 max=9
  slider "Volume: {volume}" bind=volume min=0 max=100
  input "Your name" bind=name placeholder="e.g. Ada"
  text "{name == '' ? 'Hello' : 'Hello, ' + name}: {qty} × size {upper(size)}, volume {volume}{agreed ? ', terms accepted' : ''}" tone=muted
```

## Which components bind

| Component | `bind=` holds |
|---|---|
| `check`, `switch`, `accordion` | `true` or `false` |
| `radio` | The chosen radio's `value=`; every radio in a group shares one `bind=` |
| `select` | The chosen option's value |
| `date-picker` | A date as `YYYY-MM-DD` text, or `""` for none |
| `stepper`, `slider`, `rating`, `pagination` | A number |
| `input` | Text, or a number (or `null` while empty) with `kind=number` |
| `tabs` | The selected tab's `value=` |
| `table` | The selected row's `key=` value; `sort=` and `direction=` hold its sort |
| `breadcrumb`, `map` | The pressed step's text, or the clicked country's name |

Each component's reference page lists its exact props.

## Running actions after a change

`bind=` already writes the value, so don't add `on=` just to copy it. Use `on=` for something *extra* that should happen after the value is stored, like telling your app:

```loom live
state plan="monthly"
card
  radio "Monthly" bind=plan value=monthly on="emit:plan:{plan}"
  radio "Yearly" bind=plan value=yearly on="emit:plan:{plan}"
```

The `on=` actions run with the new value already in place.

## Paths

`bind=` can name a field inside a record, or a field of the current item inside [`each`](./lists):

```loom live
state settings={theme: "light", alerts: true} todos=[{text: "Water", done: false}, {text: "Map", done: true}]
card
  switch "Alerts" bind=settings.alerts
  each items=todos as=t
    check "{t.text}" bind=t.done
  text "{count(todos, 'done')} of {len(todos)} done" tone=muted
```

Writes never change data in place: the whole list or record is replaced with an updated copy, so your app sees a `change` event for `todos` or `settings` and can save it.

## What can't be bound

- **Derived values.** They're read-only ([Derived values](./derived)). Binding to one is reported by the parser.
- **Items of a computed list.** `each items={filter(todos, 'done')}` repeats a copy, so `bind=t.done` inside it has nowhere to write. Loop over the list in state and hide items with `if=` instead ([Lists](./lists#hide-items-instead-of-filtering)).
- **Expressions.** `bind=` takes a name or a path, never `{…}`.
