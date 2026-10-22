---
title: Host data and events
description: Passing your app's data into a Loom interface, and reacting to what people do with it.
---

# Host data and events

A spec declares its own starting state, but most real interfaces show data your app already has. Your app can set state at any time, and listen to everything that changes.

## Providing data

```ts
loom.state.set("products", await fetchProducts());
loom.state.set("user", { name: "Ada", plan: "pro" });
```

A spec reads host data like any other state:

```loom known=products
card
  text "{plural(len(products), 'product')}" style=title
  each items=products as=p key={p.id}
    row
      text "{p.name}"
      text "{money(p.price)}" align=right
```

What your app passes is copied into plain, frozen Loom data. Functions, class instances and cycles are refused with a clear error, so a spec can only ever see data, never your objects. Values your app sets are never replaced by a `state` line in the spec.

When a model writes a spec that reads host data, tell the parser and the model client which names your app supplies (`knownNames` for `parse`, `stateNames` for `generateSpec`), so reading them isn't reported as an unknown name.

## Reacting to changes

```ts
loom.on("change", ({ key, value }) => {
  if (key === "cart") saveCart(value);
});
```

Writes to items replace the whole list, so a change to `cart[1].qty` arrives as a `change` event for `cart` with the new list.

## Handling actions

`emit:` is how a spec asks your app to do something it can't do itself:

```ts
loom.on("action", ({ name, value }) => {
  switch (name) {
    case "checkout": return startCheckout(value);
    case "open_order": return router.push(`/orders/${value}`);
  }
});
```

Loom never makes a network request because of a spec: images aside ([Images](./images)), anything that leaves the page goes through your handlers. Which actions exist is a contract between your app and the model; describe them in the model guide's `actions` option so the model uses the names you handle ([The model guide](./model-guide#describing-your-app)).

## Moving between screens

`loom.go("cart")`, `loom.back()`, `loom.screens`, `loom.currentScreen` and the `navigate` event let your app follow and drive a spec's [screens](../language/actions#screens).

## Not built yet

Loom doesn't yet have declared data sources (a spec saying "load orders from here") or host commands that return results to the spec. Today your app fetches data and calls `state.set`.
