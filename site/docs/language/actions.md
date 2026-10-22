---
title: Actions and navigation
description: SayShape's on= actions. Changing state, talking to the host app with emit, moving between screens, and showing messages.
---

# Actions and navigation

Interactive elements run actions from their `on=` prop: buttons, links, pressable cards and list items, and controls after their value changes.

| Action | Effect |
|---|---|
| `inc:key` or `inc:key:by` | Add 1, or `by` |
| `dec:key` or `dec:key:by` | Subtract 1, or `by`; never below 0 |
| `toggle:key` | Flip true and false |
| `set:key:value` | Set a literal, or an expression: `set:total:{a + b}` |
| `emit:name` or `emit:name:value` | Tell the host app what the person chose |
| `go:screen` | Show another screen |
| `back` | Return to the previous screen |
| `notify:'message'` | Show a short message for a few seconds; it can include `{expressions}` |
| `add:list:value` | Add an item to the end of a list |
| `remove:t` or `remove:list:index` | Remove the current item inside `each`, or the item at a position |
| `clear:list` | Empty a list |

The key of `inc`, `dec`, `toggle` and `set` can be a path, like `toggle:t.done`. A quoted value is text: `set:msg:'Hi there'`.

## Several actions

Separate them with `;`, and quote the whole value. They run in order:

```loom live
state items=0
card
  text "{plural(items, 'item')} in your cart"
  button "Add to cart" on="inc:items;notify:'Added. {items} in your cart'"
  button "Empty cart" variant=secondary on="set:items:0;notify:'Cart emptied'" disabled={items == 0}
```

## Talking to the host

`emit` is how an interface hands something to the app around it. The engine fires an `action` event with the name and value; what happens next is up to your app.

```loom live
state qty=2 placed=false
card
  stepper "Quantity" bind=qty min=1 max=5
  button "Place order" on="set:placed:true;emit:order:{qty}" disabled=placed
  text "Order sent to the app." tone=good if=placed
```

```ts
loom.on("action", ({ name, value }) => {
  if (name === "order") submitOrder(value); // your code; SayShape never calls a server itself
});
```

On this website nothing listens for these events except a log that shows them. Every submission in the docs and examples is simulated.

A value can be a record built from state: `emit:request:{item: item, qty: qty}` sends `{ item: "…", qty: 2 }`.

## Screens

A spec can hold several screens. Only one shows at a time: the first, until an action moves to another with `go:name`. `back` returns to the previous one.

```loom live
state qty=1
screen name=product title="Trail socks"
  stepper "Quantity" bind=qty min=1
  button "Add to cart" on=go:cart
screen name=cart title="Your cart"
  text "{qty} pairs"
  button "Keep shopping" variant=secondary on=back
```

State is shared by every screen. Screens only go at the top level, and their names are plain words (letters, digits and `_`). `go:` to a screen that doesn't exist does nothing. The visible screen's name is in `{screen}`. Your app can move between screens with `loom.go("cart")` and `loom.back()`, and hears every move through the `navigate` event.

## Messages

`notify` shows a message at the bottom of the visible area, drawn by the engine in the theme's colors, and fires a `notify` event so your app can announce it too. Quote the message when it has spaces or `;`.
