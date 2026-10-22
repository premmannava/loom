---
title: Loading, success and failure
description: Patterns for showing loading, empty, success and error states in a SayShape interface while your app does the work.
---

# Loading, success and failure

SayShape doesn't fetch data or submit forms itself. Your app does, and tells the interface how it went by setting state. A `status` value and a few `if=` lines cover most cases.

```loom live
state status="loading" orders=[]
card
  text "Recent orders" style=title
  if={status == 'loading'}
    skeleton lines=3
  if={status == 'ready' && len(orders) == 0}
    empty "No orders yet" detail="Orders you place show up here."
  if={status == 'ready' && len(orders) > 0}
    list
      each items=orders as=o key={o.id}
        list-item "{o.name}" trailing="{money(o.total)}"
  if={status == 'failed'}
    text "Orders couldn't be loaded." tone=bad
    button "Try again" variant=secondary on=emit:retry
  row
    button "Show loaded" variant=secondary on="set:status:'ready';set:orders:[{id: 1, name: 'Tent', total: 180}, {id: 2, name: 'Stove', total: 45}]"
    button "Show failure" variant=secondary on="set:status:'failed'"
```

The buttons at the bottom stand in for your app. In a real page:

```ts
ui.state.set("status", "loading");
try {
  ui.state.set("orders", await fetchOrders());
  ui.state.set("status", "ready");
} catch {
  ui.state.set("status", "failed");
}
ui.on("action", ({ name }) => { if (name === "retry") load(); });
```

## Submitting

The same pattern works the other way. The spec emits, your app does the work and reports back:

```loom known=saving,saved
button "Save" on=emit:save disabled={saving}
text "Saved" tone=good if={saved}
```

```ts
ui.on("action", async ({ name }) => {
  if (name !== "save") return;
  ui.state.set("saving", true);
  await save();
  ui.state.set("saving", false);
  ui.state.set("saved", true);
});
```

`notify:` messages, or `ui.notify("Saved")` from your app, are a lighter way to confirm something happened.
