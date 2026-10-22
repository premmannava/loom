---
title: Expressions and functions
description: SayShape's expression language. Operators, field access, and the whitelisted list, math and formatting functions.
---

# Expressions and functions

Anything inside `{…}` is an expression, evaluated against state. Expressions appear in props (`value={price * qty}`), inside quoted text (`"Total: {total}"`), in conditions (`if={count > 0}`) and in action values (`set:total:{a + b}`).

```loom live
state qty=2 price=24 gift=true
card
  text "Total: ${qty * price + (gift ? 4 : 0)}" style=lead
  stat label="Each, split three ways" value={round(price / 3, 2)}
```

Expressions are evaluated by SayShape's own interpreter, not JavaScript. They can read state, do arithmetic and comparisons, and call the functions on this page. Nothing else: see [The expression boundary](../architecture/security).

## Operators

| Kind | Operators |
|---|---|
| Arithmetic | `+ - * / %` |
| Comparison | `== != < <= > >=` |
| Logic | `&& \|\| !` |
| Choice | `condition ? a : b` |
| Text | `+` joins text: `{'$' + price}` |

Words inside `{…}` are names, so quote literal text, with single quotes inside a quoted prop: `{done ? 'Packed' : 'To pack'}`.

## Reading data

| Syntax | Reads |
|---|---|
| `{order.city}` | A field of a record |
| `{cart[0].price}` | An item of a list, then a field |
| `{todos.length}` | How many items a list has (also `len(todos)`) |

Anything that can't be read (a missing field, an item past the end of a list) shows as `—` rather than a guess. The parser warns about names that nothing defines.

## Math

| Function | Result |
|---|---|
| `min(a, b, …)`, `max(a, b, …)` | Smallest or largest number |
| `round(n)`, `round(n, digits)` | Rounded, to whole numbers or to some digits |
| `floor(n)`, `ceil(n)`, `abs(n)` | Rounded down, rounded up, without sign |
| `fixed(n, digits)` | Text with exactly that many decimals (default 2) |

## Lists

| Function | Result |
|---|---|
| `len(list)` | Number of items (or characters, for text) |
| `count(list, 'done')`, `count(list, 'cat', 'Gas')` | Items whose field is true, or equals a value |
| `sum(list)`, `sum(list, 'price')`, `sum(list, 'price', 'qty')` | Total of the items, of a field, or of two fields multiplied per item |
| `avg(list, 'field')` | Average of a field |
| `min(list, 'field')`, `max(list, 'field')` | Smallest or largest value of a field |
| `filter(list, 'done')`, `filter(list, 'cat', 'Gas')` | The matching items, as a new list |
| `find(list, 'id', picked)` | The first item whose field equals a value, or `null` |
| `search(list, 'name', query)` | Items whose field contains the text, ignoring case; all items for empty text |
| `sort(list, 'price')`, `sort(list, 'price', 'desc')`, `sort(list)` | A sorted copy, by a field or by value |
| `take(list, 3)` | The first items |
| `first(list)`, `last(list)` | The first or last item, or nothing for an empty list: `first(sort(sales, 'revenue', 'desc')).month` is the best month |
| `join(list)`, `join(list, 'name', ' / ')` | Text listing the items, or a field of each |
| `includes(list, value)` | Whether the list holds a value (or text contains other text) |

Only numbers count in `sum`, `avg`, `min` and `max`: a missing field, `null`, true/false or text (even `"12"`) makes the result `—` instead of being read as a number. An empty list totals 0. Functions that return lists return new, frozen lists, so sorting or filtering never changes the list in state.

They combine:

```loom live
state tx=[{name: "Market", cat: "Food", amount: 64.5}, {name: "Fuel", cat: "Transit", amount: 42}, {name: "Bistro", cat: "Food", amount: 87.5}]
card
  text "Food: {money(sum(filter(tx, 'cat', 'Food'), 'amount'))}"
  text "Biggest: {first(sort(tx, 'amount', 'desc')).name}"
  text "{join(tx, 'name', ', ')}" tone=muted
```

## Formatting

| Function | Result |
|---|---|
| `money(2400)`, `money(-84.1)`, `money(n, 'EUR')` | `$2,400.00`, `-$84.10`, or another currency |
| `number(37000)`, `number(n, 2)` | `37,000`; with exactly two decimals |
| `compact(12345678)`, `compact(n, 'USD')` | `12.3M`, `$12.3M`: big figures in small spaces, like a `stat` |
| `plural(n, 'item')`, `plural(n, 'child', 'children')` | `1 item`, `3 items`, `2 children` |
| `lower(text)`, `upper(text)`, `trim(text)` | Lower case, upper case, without spaces at the ends |

Numbers and money are formatted in US English for now.

## Every function

The interpreter knows exactly these names, read from `src/expr.ts` when this site is built:

<!--@include: ../../.generated/functions.md-->

Calling anything else is a warning, and the expression shows as `—`.
