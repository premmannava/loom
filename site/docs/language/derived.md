---
title: Derived values
description: derive lines in SayShape. Read-only values computed from state, cached until their inputs change.
---

# Derived values

A `derive` line works a value out from state and keeps it up to date. A total, a filtered list or a chart's data is written once, and every element reads the same thing.

```loom live
state quantity=2 price=350 taxRate=0.08
derive subtotal={quantity * price}
derive tax={subtotal * taxRate}
derive total={subtotal + tax}
card
  stepper "Quantity" bind=quantity min=1 max=10
  stat label="Subtotal" value={money(subtotal)}
  stat label="Tax" value={money(tax)}
  stat label="Total" value={money(total)} tone=accent
```

## Rules

- **Grammar.** `derive name={expression}`, unindented, at the top level. Several pairs can share a line, as with `state`. The expression is the same [safe kind](./expressions) as everywhere else: no functions of your own, callbacks or side effects.
- **Reading.** A derived name reads like state, in text, props, `if=`, `items=` and other `derive` lines. It can read state, data your app sets with `ui.state.set`, and other derived values.
- **Order.** Declarations can come in any order. While a spec streams in, a value whose inputs haven't arrived yet shows as `—` until they do.
- **Updates.** A value is worked out the first time it's read, then kept until something it reads changes, directly or through other derived values.
- **Failures.** If a value can't be worked out (it reads an item that's gone, say), it's `—`, never the last good result, and so is everything derived from it. The reason is reported once through the engine's `onWarning`.
- **Read-only.** `bind=` and actions (`set:`, `inc:`, `toggle:`, `add:`, `remove:`, `clear:`) can't change a derived value or items of a derived list. The parser reports it, the engine refuses with a warning, and `ui.state.set` throws a `DerivedWriteError`.
- **Limit.** A spec can derive at most 200 values.

## Filtering with derive

Derived lists are the usual way to filter, search and sort for display, because every element can read the result:

```loom live
state category="All" categories=["All", "Food", "Home"] tx=[{id: 1, cat: "Food", name: "Market", amount: 64.5}, {id: 2, cat: "Home", name: "Internet", amount: 80}, {id: 3, cat: "Food", name: "Bistro", amount: 87.5}]
derive shown={category == 'All' ? tx : filter(tx, 'cat', category)}
card
  select "Category" items=categories bind=category
  text "{plural(len(shown), 'expense')}, {money(sum(shown, 'amount'))}" tone=muted
  chart kind=bar items=shown x=name y=amount format=money
```

To let people *change* items while some are hidden, keep the list in state and hide items with `if=` instead ([Lists](./lists#hide-items-instead-of-filtering)), because a derived list is a copy.

## Problems the parser reports

Each of these skips only the value concerned:

- an expression that isn't in braces, or has a syntax error;
- a name declared twice, or already used by `state`;
- a name that's reserved (`__proto__`, `constructor`, `prototype`) or used by the engine (`screen`);
- a name nothing defines;
- a cycle, direct or through other values. The values in the loop are left out, with the loop named:

```loom invalid live
derive p={q + 1}
derive q={p * 2}
text "p is {p}"
```

`ui.state.snapshot()` holds state only; `ui.state.derivedSnapshot()` holds the derived values.
