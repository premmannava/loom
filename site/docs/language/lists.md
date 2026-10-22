---
title: Lists and iteration
description: Repeating elements with each in Loom, writing to list items, and adding and removing items.
---

# Lists and iteration

`each` repeats what's indented under it once per item of a list. It has no look of its own: the copies sit in the container around it, so `each` inside a `row`, `grid`, `list` or `tabs` makes one cell, row or tab per item.

```loom live
state todos=[{text: "Pack water", done: true}, {text: "Charge headlamp", done: false}]
card
  text "{count(todos, 'done')} of {len(todos)} packed" tone=muted
  each items=todos as=t
    row
      check "{t.text}" bind=t.done
      button "Remove" variant=secondary on=remove:t
  button "Add snacks" on="add:todos:{text: 'Snacks', done: false}"
```

| Prop | Meaning |
|---|---|
| `items` | The list: a state name, a field (`o.lines`) or an `{expression}` |
| `as` | Name for the current item inside (default `item`) |
| `index` | Name for its position, from 0 |
| `key` | A value unique to each item, like `{t.id}`, so focus stays with the item when the list changes (default: the position) |

A loop variable exists only inside its `each`; using it outside is a warning.

## Changing items

Inside `each`, `bind=` and actions can write to the current item: `bind=t.done`, `toggle:t.done`, `inc:item.qty`. This works only when `items=` names a list in state, not a computed one. The whole list is replaced with an updated copy, so the `change` event reports `todos` and your app can save it.

## Changing the list

| Action | Effect |
|---|---|
| `add:todos:{text: 'Map', done: false}` | Adds an item to the end |
| `remove:t` | Removes the current item, inside `each` |
| `remove:todos:0` | Removes the item at a position |
| `clear:todos` | Empties the list |
| `set:todos:{filter(todos, 'done', false)}` | Replaces the list with a computed one |

```loom live
state task="" nextId=3 todos=[{id: 1, text: "Book campsite", done: false}, {id: 2, text: "Check weather", done: true}]
card
  each items=todos as=t key={t.id}
    check "{t.text}" bind=t.done
  row align=bottom
    input "New task" bind=task placeholder="e.g. Buy fuel"
    button "Add" on="add:todos:{id: nextId, text: trim(task), done: false};inc:nextId;set:task:''" disabled={trim(task) == ''}
  button "Clear finished" variant=secondary on="set:todos:{filter(todos, 'done', false)}"
```

## Lists in lists

Put an `each` inside an `each`. Inner items can read outer ones:

```loom live
state orders=[{date: "May 2", lines: [{name: "Tent", price: 180}, {name: "Stove", price: 45}]}, {date: "May 9", lines: [{name: "Headlamp", price: 30}]}]
each items=orders as=o
  card
    text "Order of {o.date}" weight=semibold
    each items=o.lines as=line
      row
        text "{line.name}"
        text "{money(line.price)}" align=right
    text "Total {money(sum(o.lines, 'price'))}" align=right
```

## Hide items instead of filtering

A filtered list is a copy, so its items can't be written to. To let people tick items off while hiding some, loop over the list in state and put `if=` on the repeated element:

```loom live
state hide=false gear=[{id: 1, name: "Tent", done: true}, {id: 2, name: "Stove", done: false}, {id: 3, name: "Headlamp", done: false}]
card
  switch "Hide packed" bind=hide
  each items=gear as=g key={g.id}
    check "{g.name}" bind=g.done if={!(hide && g.done)}
```

## Limits

At most 500 items per `each`, and 10,000 repeated elements per screen however lists nest. Past either, the rest are left out with a warning.
