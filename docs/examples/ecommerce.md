# Example: an ecommerce store built with Loom

This is the design for **Loom Shop**, the reference app in [Phase 6 of the plan](../PLAN.md#phase-6-loom-shop-the-reference-app): a small outdoor-gear store called *Trailhead Outfitters*. It shows how a complete, working store fits together: fixed screens for the parts that must be exact, a shopping assistant whose screens a model generates on the fly, and the host code that connects both to real data and payments.

> **This uses proposed syntax.** Lists (`each`), data (`source`), host commands (`call:`), screens, `notify:` and the components `input`, `image`, `grid`, `select`, `stepper`, `slider`, `badge`, `rating`, `skeleton` and `empty` are designed in [Phase 2](../PLAN.md#phase-2-language-02-data-lists-screens) and [Phase 3](../PLAN.md#phase-3-components-and-engine-capabilities). None of them work in Loom 0.1. This document is the target those phases build toward.

---

## Contents

- [The shape of the app](#the-shape-of-the-app)
- [Data the store provides](#data-the-store-provides)
- [The fixed screens](#the-fixed-screens)
  - [Catalog](#1-catalog)
  - [Product](#2-product)
  - [Cart](#3-cart)
  - [Checkout](#4-checkout)
  - [Order confirmation](#5-order-confirmation)
- [Host code](#host-code)
- [The shopping assistant: UI generated on the fly](#the-shopping-assistant-ui-generated-on-the-fly)
- [Generated, then reviewed: promotional pages](#generated-then-reviewed-promotional-pages)
- [Safety rules for commerce](#safety-rules-for-commerce)
- [Testing the store](#testing-the-store)
- [What each screen needs from the plan](#what-each-screen-needs-from-the-plan)

---

## The shape of the app

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  Shop canvas (fixed screens)            Assistant canvas (generated)│
│  catalog → product → cart → checkout    "waterproof shoes for…"     │
│        ▲            │                         │            ▲        │
│        │  sources   │ commands       emit     │            │ stream │
└────────┼────────────┼─────────────────────────┼────────────┼────────┘
         │            ▼                         ▼            │
┌────────┴──────────────────────── Server ───────────────────┴────────┐
│  Catalog API   Cart API   Orders API   Assistant endpoint ──► Model │
│                    │                                                │
│                    └──► Payment provider (hosted checkout page)     │
└─────────────────────────────────────────────────────────────────────┘
```

Two Loom instances share one set of registered sources and commands:

- **The shop** runs a fixed, reviewed spec with five screens. It never involves the model, so it is fast, predictable and exact.
- **The assistant** is a side panel. The user describes what they need, and a model generates a screen to answer: a comparison, a short list, an outfit. Its buttons open products in the shop or ask the model a follow-up.

Payment details never touch Loom. Checkout hands off to the payment provider's hosted page and comes back to the confirmation screen.

---

## Data the store provides

The host registers these with Loom. The model guide describes them from their registrations, exactly like components, so a model knows what data exists and what each command does.

### Sources (read)

| Source | Parameters | Returns |
|---|---|---|
| `catalog.search` | `query`, `category`, `sort`, `max_price` | `{ items: Product[], total }` |
| `catalog.get` | `id` | `Product` |
| `catalog.get_many` | `ids` (comma-separated) | `Product[]`, in the order given |
| `catalog.categories` | none | `{ value, label }[]` |
| `cart.get` | none | `Cart` |
| `orders.get` | `id` | `Order` |

```ts
interface Product {
  id: string;
  name: string;
  description: string;
  highlights: string[];      // short selling points, e.g. "Gore-Tex membrane"
  image: string;             // URL on the store's image host
  price: number;             // in the currency's main unit, e.g. 129.00
  was_price: number | null;
  on_sale: boolean;
  currency: string;          // "USD"
  rating: number;            // 0–5
  reviews: number;
  sizes: string[];
  stock: number;
  weight_g: number;
  waterproof: boolean;
}

interface Cart {
  id: string;
  currency: string;
  items: Array<{ line_id: string; id: string; name: string; image: string; size: string; qty: number; line_total: number }>;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;             // computed by the server, never by the spec
}
```

### Commands (write)

| Command | Arguments | Effect | Refreshes |
|---|---|---|---|
| `cart.add` | `id`, `size`, `qty` | Add a line | `cart.get` |
| `cart.set_qty` | `line`, `qty` | Change a quantity; 0 removes the line | `cart.get` |
| `checkout.start` | `cart` | Create a hosted payment session and go to it. **Fixed screens only.** | none |
| `shop.open_product` | `id` | Show a product in the shop canvas (used by the assistant) | none |

---

## The fixed screens

All five screens live in one spec, `shop.loom`. It's written once (by a developer, or drafted by a model and then reviewed) and loaded with `loom.setSpec()`.

### Shared state and sources

```
# Trailhead Outfitters: fixed screens
state query="" category="all" sort="popular" maxPrice=300
state selected=null size=null qty=1 orderId=null

source categories from=catalog.categories
source products from=catalog.search query={query} category={category} sort={sort} max_price={maxPrice}
source product from=catalog.get id={selected} if={selected != null}
source cart from=cart.get
source order from=orders.get id={orderId} if={orderId != null}
```

`selected`, `size` and `qty` describe the product being viewed. `orderId` is set by the host when the payment provider sends the shopper back.

### 1. Catalog

```
screen name=catalog title="Trailhead Outfitters"
  row
    text "Trailhead Outfitters" style=title
    button "Cart ({len(cart.data.items)})" variant=secondary on=go:cart
  input "Search" bind=query type=search placeholder="Search shoes, jackets, packs"
  grid min=180 gap=12
    select "Category" bind=category options={categories.data}
    select "Sort by" bind=sort
      option "Most popular" value=popular
      option "Price: low to high" value=price_asc
      option "Price: high to low" value=price_desc
      option "Newest" value=newest
    slider "Up to {money(maxPrice, 'USD')}" bind=maxPrice min=20 max=300 step=10
  text "{products.data.total} results" tone=muted if={!products.loading}
  skeleton "product-card" count=6 if={products.loading}
  empty "No matches" if={!products.loading && len(products.data.items) == 0}
    text "Try another search or raise the price limit." tone=muted
    button "Clear filters" variant=secondary on="set:query:{''};set:category:all;set:maxPrice:300"
  grid min=220 gap=16 if={!products.loading}
    each items={products.data.items} as=p key={p.id}
      card pad=0 gap=0 on="set:selected:{p.id};set:size:null;set:qty:1;go:product"
        image src={p.image} alt={p.name} ratio=1
        column pad=14 gap=4
          row align=top
            text "{p.name}" weight=semibold
            badge "Sale" tone=bad if={p.on_sale}
          rating value={p.rating} count={p.reviews}
          row
            text "{money(p.price, p.currency)}" style=lead weight=bold
            text "{money(p.was_price, p.currency)}" tone=muted strike=true if={p.on_sale}
```

What happens at runtime:

- Typing in the search box changes `query`. The `products` source sees its parameter change, waits for the user to pause, and calls `catalog.search` again. While it loads, six skeleton cards show.
- Every price is `{money(...)}` reading data. The spec contains no prices.
- Pressing a card sets the product to view and goes to the product screen.

### 2. Product

```
screen name=product title="{product.data.name}"
  button "Back to results" variant=secondary on=back
  skeleton "product-page" if={product.loading}
  grid min=320 gap=24 if={!product.loading}
    image src={product.data.image} alt={product.data.name} ratio=1
    column gap=12
      text "{product.data.name}" style=title
      rating value={product.data.rating} count={product.data.reviews}
      row
        text "{money(product.data.price, product.data.currency)}" style=title
        badge "Sale" tone=bad if={product.data.on_sale}
      text "{product.data.description}"
      each items={product.data.highlights} as=h key={h}
        text "• {h}"
      select "Size" bind=size options={product.data.sizes}
      stepper "Quantity" bind=qty min=1 max={min(product.data.stock, 10)}
      text "Only {product.data.stock} left" tone=warn if={product.data.stock > 0 && product.data.stock < 5}
      text "Out of stock" tone=bad if={product.data.stock == 0}
      button "Add to cart" on="call:cart.add(id: product.data.id, size: size, qty: qty);notify:'Added {product.data.name} to your cart'" disabled={size == null || product.data.stock == 0}
      button "Ask the assistant about this" variant=secondary on="emit:ask_about:{product.data.id}"
```

- `grid min=320` puts the photo beside the details on a wide screen and stacks them on a phone.
- "Add to cart" stays disabled until a size is chosen. When pressed, it runs the trusted `cart.add` command. The cart source refreshes on its own, so the cart count in the catalog header updates without the model or the spec doing anything.
- "Ask the assistant" sends an `emit` the host forwards to the assistant panel, which asks the model about that product.

### 3. Cart

```
screen name=cart title="Your cart"
  row
    text "Your cart" style=title
    button "Keep shopping" variant=secondary on=go:catalog
  empty "Your cart is empty" if={len(cart.data.items) == 0}
    button "Browse the shop" on=go:catalog
  card if={len(cart.data.items) > 0}
    each items={cart.data.items} as=item key={item.line_id}
      row align=center
        image src={item.image} alt={item.name} ratio=1
        column gap=2
          text "{item.name}" weight=semibold
          text "Size {item.size}" tone=muted
        stepper value={item.qty} min=0 max=10 on="call:cart.set_qty(line: item.line_id, qty: $value)"
        text "{money(item.line_total, cart.data.currency)}" align=right weight=semibold
    divider
    row
      text "Subtotal" tone=muted
      text "{money(cart.data.subtotal, cart.data.currency)}" align=right
    row
      text "Shipping" tone=muted
      text "{cart.data.shipping == 0 ? 'Free' : money(cart.data.shipping, cart.data.currency)}" align=right
    row
      text "Estimated tax" tone=muted
      text "{money(cart.data.tax, cart.data.currency)}" align=right
    divider
    row
      text "Total" style=lead weight=semibold
      text "{money(cart.data.total, cart.data.currency)}" style=title align=right
  button "Checkout" on=go:checkout if={len(cart.data.items) > 0}
```

The spec displays totals but never calculates them. Tax, shipping, discounts and rounding are the server's job, so a mistake in a spec can't change what anyone pays.

### 4. Checkout

```
screen name=checkout title="Checkout"
  text "Review your order" style=title
  card
    each items={cart.data.items} as=item key={item.line_id}
      row
        text "{item.qty} × {item.name}, size {item.size}"
        text "{money(item.line_total, cart.data.currency)}" align=right
    divider
    row
      text "Total" weight=semibold
      text "{money(cart.data.total, cart.data.currency)}" weight=bold align=right
  text "You'll enter your address and payment details on our payment provider's secure page." tone=muted
  button "Continue to secure payment" on="call:checkout.start(cart: cart.data.id)"
  button "Back to cart" variant=secondary on=back
```

`checkout.start` creates a session with the payment provider and sends the browser to its hosted page. Card numbers, addresses and payment authentication all happen there. This keeps the store out of scope for most card-data compliance work and keeps Loom away from the most sensitive data in the app.

### 5. Order confirmation

```
screen name=confirmation title="Thank you"
  skeleton "card" if={order.loading}
  card if={!order.loading}
    text "Thanks, {order.data.first_name}!" style=title
    text "Order {order.data.number} is confirmed. A receipt is on its way to {order.data.email}."
    progress value={order.data.step} max=4 label="{order.data.status_label}"
    divider
    each items={order.data.items} as=item key={item.line_id}
      row
        text "{item.qty} × {item.name}"
        text "{money(item.line_total, order.data.currency)}" align=right
    row
      text "Paid" weight=semibold
      text "{money(order.data.total, order.data.currency)}" weight=bold align=right
  button "Continue shopping" on=go:catalog
```

When the payment provider redirects back (for example to `/order/ord_8841`), the host sets `orderId` and opens this screen.

---

## Host code

The host registers sources and commands with their schemas, loads the fixed spec, and connects the assistant. The API names below are the ones proposed in Phase 2 and Phase 4.

```ts
import { Loom, coreComponents } from "loom-ui";
import { connectAssistant } from "loom-ui/client";
import shopSpec from "./shop.loom?raw";
import { api } from "./api";

const shop = new Loom(document.querySelector("#shop")!, {
  components: coreComponents,
  rules: ["commerce"],                 // see "Safety rules for commerce"
});

// ---------- sources (read-only data)

shop.sources.register("catalog.search", {
  description: "Search products in the catalog.",
  params: {
    query: { type: "string", description: "Words to search for." },
    category: { type: "string", default: "all", description: "A category value from catalog.categories." },
    sort: { type: "enum", values: ["popular", "price_asc", "price_desc", "newest"], default: "popular", description: "Result order." },
    max_price: { type: "number", description: "Highest price to include." },
  },
  returns: "{ items: Product[], total: number }",
  fetch: (p, { signal }) => api.get("/products", p, { signal }),
});

shop.sources.register("catalog.get", {
  description: "One product by id.",
  params: { id: { type: "string", required: true, description: "Product id." } },
  returns: "Product",
  fetch: ({ id }, { signal }) => api.get(`/products/${id}`, {}, { signal }),
});

shop.sources.register("catalog.get_many", {
  description: "Several products by id, in the order given.",
  params: { ids: { type: "string", required: true, description: "Comma-separated product ids." } },
  returns: "Product[]",
  fetch: ({ ids }, { signal }) => api.get("/products", { ids }, { signal }),
});

shop.sources.register("catalog.categories", {
  description: "Product categories for filters.",
  params: {},
  returns: "{ value: string, label: string }[]",
  fetch: (_, { signal }) => api.get("/categories", {}, { signal }),
});

shop.sources.register("cart.get", {
  description: "The shopper's cart, with totals computed by the server.",
  params: {},
  returns: "Cart",
  fetch: (_, { signal }) => api.get("/cart", {}, { signal }),
});

shop.sources.register("orders.get", {
  description: "A placed order.",
  params: { id: { type: "string", required: true, description: "Order id." } },
  returns: "Order",
  fetch: ({ id }, { signal }) => api.get(`/orders/${id}`, {}, { signal }),
});

// ---------- commands (trusted actions)

shop.commands.register("cart.add", {
  description: "Add a product in a size to the cart.",
  params: {
    id: { type: "string", required: true, description: "Product id." },
    size: { type: "string", required: true, description: "One of the product's sizes." },
    qty: { type: "number", default: 1, description: "How many." },
  },
  run: (a) => api.post("/cart/items", a),
  refreshes: ["cart.get"],
});

shop.commands.register("cart.set_qty", {
  description: "Change the quantity of a cart line. 0 removes it.",
  params: {
    line: { type: "string", required: true, description: "Cart line id." },
    qty: { type: "number", required: true, description: "New quantity." },
  },
  run: ({ line, qty }) => api.patch(`/cart/items/${line}`, { qty }),
  refreshes: ["cart.get"],
});

shop.commands.register("checkout.start", {
  description: "Go to the secure payment page for this cart.",
  params: { cart: { type: "string", required: true, description: "Cart id." } },
  fixedScreensOnly: true,              // generated specs can't call it
  run: async ({ cart }) => {
    const { url } = await api.post("/checkout/sessions", { cart });
    location.assign(url);              // the payment provider's hosted page
  },
});

// ---------- the fixed screens

shop.setSpec(shopSpec, { trusted: true }); // trusted = reviewed, may use fixedScreensOnly commands

// Coming back from the payment provider: /order/<id>
const match = location.pathname.match(/^\/order\/(\w+)$/);
if (match) {
  shop.state.set("orderId", match[1]!);
  shop.go("confirmation");
}

// ---------- the assistant panel

const assistant = new Loom(document.querySelector("#assistant")!, {
  components: coreComponents,
  rules: ["commerce"],
  sources: shop.sources,               // same data
  commands: shop.commands.only(["cart.add", "shop.open_product"]),
});

assistant.commands.register("shop.open_product", {
  description: "Open a product page in the shop.",
  params: { id: { type: "string", required: true, description: "Product id." } },
  run: ({ id }) => {
    shop.state.set("selected", id);
    shop.state.set("size", null);
    shop.state.set("qty", 1);
    shop.go("product");
  },
});

connectAssistant(assistant, { endpoint: "/api/assistant" });

// "Ask the assistant about this" on the product screen
shop.on("action", ({ name, value }) => {
  if (name === "ask_about") assistant.ask(`Tell me about product ${value}. Is it a good choice for me?`);
});
```

### The assistant endpoint (server)

The server builds the prompt from the same registrations, gives the model tools to look at the catalog, streams Loom to the browser, and repairs once if the spec has errors.

```ts
import { languageGuide, parse, sourceGuide, commandGuide } from "loom-ui/server";
import { registry, sources, commands } from "./loom-setup";
import { streamModel } from "./model"; // your model provider's streaming client

export async function assistant(req: Request): Promise<Response> {
  const { messages } = await req.json();

  const system = [
    "You are the shopping assistant for Trailhead Outfitters, an outdoor gear store.",
    "Answer every request with one Loom screen. Use the tools to find real products first.",
    "Show prices only with {money(...)} reading source data. Never write a price yourself.",
    "To let the shopper continue, add buttons that call shop.open_product or cart.add, or emit ask:<question>.",
    languageGuide(registry),
    sourceGuide(sources),
    commandGuide(commands.only(["cart.add", "shop.open_product"])),
  ].join("\n\n");

  const tools = [
    {
      name: "search_catalog",
      description: "Search products. Returns ids, names, prices and highlights so you can choose what to show.",
      input: { query: "string", max_price: "number?", category: "string?" },
      run: (a) => sources.call("catalog.search", { ...a, sort: "popular" }),
    },
  ];

  return streamToBrowser(async (send) => {
    let spec = "";
    for await (const chunk of streamModel({ system, messages, tools })) {
      spec += chunk;
      send(chunk);                                 // the browser renders line by line
    }
    const { diagnostics } = parse(spec, registry, { rules: ["commerce"], sources, commands });
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length) {
      const fixed = await completeModel({
        system,
        messages: [...messages, { role: "assistant", content: spec },
          { role: "user", content: "Fix these problems and send the whole screen again:\n" +
            errors.map((e) => `Line ${e.line}: ${e.message}`).join("\n") }],
      });
      send({ replace: fixed });                    // swap in the corrected screen
    }
  });
}
```

---

## The shopping assistant: UI generated on the fly

### A complete turn

The shopper types into the assistant:

> I'm hiking in the Pacific Northwest in November. I need waterproof shoes, my budget is $150. Which should I get?

**1. The model looks first.** It calls the `search_catalog` tool with `{ query: "waterproof hiking shoes", max_price: 150 }`. The server runs the real `catalog.search` and returns twelve products. The model reads them to decide what to recommend and in what order.

**2. The model streams a screen.** Lines appear in the assistant panel as they arrive:

```
state focus=null
source picks from=catalog.get_many ids="p_2210,p_1042,p_0877"
card
  text "Three waterproof picks for wet November trails" style=title
  text "All have waterproof membranes and soles that grip on wet rock. Ordered by how well they suit muddy, rocky Pacific Northwest trails." tone=muted
  grid min=200 gap=12
    each items={picks.data} as=p key={p.id}
      card pad=0 gap=0
        image src={p.image} alt={p.name} ratio=1
        column pad=12 gap=4
          badge "Top pick" tone=good if={p.id == 'p_2210'}
          text "{p.name}" weight=semibold
          rating value={p.rating} count={p.reviews}
          text "{money(p.price, p.currency)}" style=lead weight=bold
          text "{p.highlights[0]}" tone=muted
          text "{p.weight_g} g per shoe" tone=muted
          button "View" variant=secondary on="call:shop.open_product(id: p.id)"
  text "My pick: {picks.data[0].name}. It has the stickiest outsole of the three, which matters most on wet rock." 
  row
    button "Show lighter options" variant=secondary on="emit:ask:'Show lighter options'"
    button "What socks go with these?" variant=secondary on="emit:ask:'What socks go with these?'"
```

Things to notice:

- **Prices, ratings, weights and photos come from data.** The model chose *which* products and *in what order* (the `ids` list), and wrote the advice. Everything factual reads `picks.data`.
- **The top pick is referenced by data**, `{picks.data[0].name}`, so the product name can't be misspelled or invented.
- **"View" calls a trusted command** that opens the product in the shop, where the shopper chooses a size and adds to cart. The generated screen doesn't need its own size picker.
- **Follow-up buttons use `emit`.** "Show lighter options" goes back to the model as the next message, and a new screen streams in.

**3. If the model makes a mistake, the server repairs it.** Suppose the model had written a price as text:

```
  text "Only $129 and built to last"
```

The commerce rules turn that into an error:

```
Line 14: Prices must come from data. Use {money(p.price, p.currency)} instead of "$129".
```

The server sends the diagnostic back once, the model returns a corrected screen, and the corrected version replaces the first one. The shopper never sees a made-up price.

### Why this split works

| The model decides | The system guarantees |
|---|---|
| What to show and in what order | Prices, stock and totals are real |
| How to explain the recommendation | Payment only happens on reviewed screens |
| Which follow-ups to offer | Adding to cart runs the same trusted code as the shop |
| Layout, from the available components | Design stays on-brand: no colors or sizes in specs |

---

## Generated, then reviewed: promotional pages

The same pipeline can save design time for content that changes often. A merchant writes:

> Make a landing page for our winter sale: 20% off insulated jackets, ends January 15.

The model drafts a spec with a hero text, a `source jackets from=catalog.search category=jackets` grid and a countdown. The merchant previews it in the playground, edits it if needed, and publishes it as a fixed screen with `trusted: true`. Unlike assistant screens, it goes live only after a person approves it.

---

## Safety rules for commerce

`rules: ["commerce"]` adds parser checks on top of the normal ones. Each produces an error, so a generated screen that breaks one gets repaired or rejected before it's shown.

| Rule | Example that fails |
|---|---|
| No currency amounts written as text | `text "Only $129"` |
| No arithmetic on prices in specs (totals come from the server) | `{p.price * qty}` |
| `fixedScreensOnly` commands can't be called from untrusted specs | `call:checkout.start(...)` in an assistant screen |
| Sources and commands must be registered | `source x from=catalog.discounts` |
| No inputs that look like payment or login fields | `input "Card number"`, `input "Password"` |
| Image URLs must be on allowed hosts | `image src="https://elsewhere.example/x.png"` |

These rules are why the assistant can be trusted with generated screens in a store at all. They're written as parser rules, not prompt instructions, so they hold even when a model ignores its instructions.

---

## Testing the store

Following the [testing strategy](../PLAN.md#testing-strategy):

**Spec tests:** `shop.loom` parses with the commerce rules and no diagnostics; every prefix parses while streaming.

**Interaction tests** with mocked sources and commands:

```ts
import { render } from "loom-ui/testing";
import shopSpec from "../shop.loom?raw";

test("adding to cart needs a size and calls cart.add", async () => {
  const cartAdd = vi.fn();
  const ui = render(shopSpec, {
    sources: { "catalog.get": () => boots, "cart.get": () => emptyCart, /* … */ },
    commands: { "cart.add": cartAdd },
    state: { selected: "p_2210" },
    screen: "product",
  });
  await ui.ready();

  expect(ui.get({ type: "button", text: "Add to cart" }).disabled).toBe(true);
  ui.choose({ type: "select", text: "Size" }, "10");
  ui.press({ type: "button", text: "Add to cart" });

  expect(cartAdd).toHaveBeenCalledWith({ id: "p_2210", size: "10", qty: 1 });
  expect(ui.notifications).toContain("Added Ridgeline GTX to your cart");
});
```

**Visual baselines** for every screen in light and dark, at phone and desktop widths, with fixed fixture data.

**End-to-end** with Playwright against a test catalog and the payment provider's test mode: search, open a product, add to cart, check out with a test card, and land on the confirmation screen.

**Accessibility:** the full purchase flow by keyboard only, an axe audit of the accessibility mirror on every screen, and a manual screen reader pass each release.

**Assistant evaluations:** about 30 shopping prompts ("gift under $50", "compare these two", "what goes with this jacket"). Each must produce a screen with no errors after one repair, use only real product ids from the tool results, contain no price literals, and offer at least one way to continue (a `View` or `emit` button).

---

## What each screen needs from the plan

| Needs | Catalog | Product | Cart | Checkout | Confirmation | Assistant |
|---|---|---|---|---|---|---|
| Structured data, `each` (Phase 2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `source`, `call:` (Phase 2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Screens, `go:`, `back` (Phase 2) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `grid` (Phase 2) | ✓ | ✓ | | | | ✓ |
| `input` (Phase 3) | ✓ | | | | | |
| `image` (Phase 3) | ✓ | ✓ | ✓ | | | ✓ |
| `select`, `stepper`, `slider` (Phase 3) | ✓ | ✓ | ✓ | | | |
| `badge`, `rating`, `skeleton`, `empty` (Phase 3) | ✓ | ✓ | ✓ | | ✓ | ✓ |
| Model loop, repair, commerce rules (Phase 4) | | | | | | ✓ |
| Hosted payment integration (Phase 6) | | | | ✓ | ✓ | |
