# Plan: lists and structured data

**Status:** proposed, not started. Part of [Phase 2](../PLAN.md#phase-2-language-02-data-lists-screens) (sections 2.1 and 2.2).
**Rough size:** 3 to 5 days, in six steps that each end in a working, tested commit.

## The problem

Loom's state holds single values only: a number, a string, true/false or null. Testing with a real model (Qwen3 14B through LM Studio) showed what that costs:

- "A to-do list with five tasks" forces the model to write five `check` lines and five separately named state values (`task1`, `task2`…), which it often gets wrong.
- "A cart with three items and a total" needs a hand-written sum of every price times every quantity.
- "A list of 20 products" can't be done sensibly at all.
- An app can't hand Loom its own data ("here are the products, lay them out"), which was the original goal: the model writes the layout, the app supplies the data.

## What it will look like

```
state todos=[{text:"Pack water", done:false}, {text:"Charge headlamp", done:true}]
card
  text "Packing list" style=title
  text "{count(todos, 'done')} of {len(todos)} packed" tone=muted
  each items=todos as=t
    row
      check "{t.text}" bind=t.done
      button "Remove" variant=secondary on=remove:t
  button "Add snacks" on="add:todos:{text:'Snacks', done:false}"
```

And a cart, where the total follows the quantities:

```
state cart=[{name:"Trail socks", price:24, qty:2}, {name:"Rain shell", price:129, qty:1}]
card
  each items=cart as=item
    row
      text "{item.name}"
      stepper bind=item.qty min=1
      text "\${item.price * item.qty}" align=right
  divider
  text "Total \${sum(cart, 'price', 'qty')}" style=title
```

An app passes its own data the same way, from JavaScript:

```ts
loom.state.set("products", await fetchProducts());
```

## The design, piece by piece

### 1. Lists and records as values

- `Value` grows from `number | string | boolean | null` to also include lists (`Value[]`) and records (`{ [name]: Value }`).
- **Literals on one line** in `state`: `[…]` and `{name: value}`, with bare or quoted names and single or double quotes. One line keeps streaming working (rule 3).
- **Data only.** A literal is parsed by a small data parser, not by running anything. Data from the host (`loom.state.set`) is copied into plain records with no prototype. Functions, class instances, dates and cycles are rejected with a clear error.
- **Limits**, so a runaway model can't freeze the page: nesting at most 20 levels deep, at most 10,000 values in one literal. Over the limit, the line becomes an error diagnostic.

### 2. Reading data in expressions

- **Property access:** `t.text`, `cart[0]`, `item["unit price"]`. It only reads a record's own fields and a list's numbered items. `__proto__`, `constructor` and `prototype` are always unknown, even if a record has a field with that name.
- **`length`** works on lists and strings, because models write `todos.length` out of habit. `len(todos)` does the same.
- **New functions:**

  | Function | Result |
  |---|---|
  | `len(list)` | Number of items |
  | `count(list, 'field')` | Items whose field is true (or not empty) |
  | `sum(list)` / `sum(list, 'price')` / `sum(list, 'price', 'qty')` | Total of the numbers, of a field, or of two fields multiplied (cart totals) |
  | `avg(list, 'field')` | Average of a field |
  | `join(list, 'field', ', ')` | Text listing a field of every item |
  | `includes(list, value)` | Whether a value is in the list |

- **Record and list literals inside `{…}`**, for actions: braces whose content starts with `name:` are a record (`{text:'Snacks', done:false}`); `[a, b]` is a list. A ternary always has `?` before its `:`, so the two can't be confused.
- **Showing data in text:** a list of plain values shows as `a, b, c`. A record, or a list of records, shows as `—`, so the model learns to pick a field.

### 3. `each`: repeat elements for every item

```
each items=todos as=t index=i key={t.id}
```

| Prop | Meaning |
|---|---|
| `items` | The list: a state name, a loop variable's field (`order.lines`), or an `{expression}` |
| `as` | The name for the current item inside (default `item`) |
| `index` | Optional name for its position, starting at 0 |
| `key` | Optional unique value per item. It keeps focus, hover and fade-in on the right row when items are added, removed or reordered (default: the position) |

- `each` is a container with no look of its own. Its children are laid out inside its parent as if they were written there, so `each` inside a `row`, `grid` or `list` gives one cell or row per item.
- **Loop variables only exist inside their `each`.** The parser checks this while parsing, so `bind=t.done` outside the `each` is a diagnostic ("t only exists inside each … as=t") rather than a silent blank.
- **At most 500 items render.** Beyond that, a warning says how many were left out. There's no scrolling yet, so very long lists belong to the scrolling work in Phase 3.
- Nested `each` works, for example orders with their lines.

**How the engine does it:** a new step between parsing and layout, *expand*, turns the parsed tree into an *instance tree*. Each `each` is replaced by copies of its children, one per item, and each copy carries its loop variables. Instance ids add the key (`7:check#3`), so focus, hover and the fade-in follow the item, not the line. Expand reruns when state changes, like layout does today.

Everything after expand reads values through the node's own scope (loop variables, then state) instead of the global one:

- `PropReader`, `isVisible`, layout, paint, press and actions all get the node's scope.
- The 10 places where components read state directly (`ctx.scope(key)`) move to two shared helpers, `readBind(node)` and `writeBind(node, value)`. These understand paths like `t.done`.

### 4. Changing data

- **`bind=` takes a path:** `bind=t.done`, `bind=item.qty`, `bind=settings.theme`. All 11 components with `bind` (`check`, `switch`, `radio`, `stepper`, `slider`, `rating`, `tabs`, `accordion`, `breadcrumb`, `pagination`, `map`) get it through the shared helpers, so none of them has its own path code.
- **Actions take paths too:** `set:t.done:true`, `toggle:t.done`, `inc:item.qty`, `dec:item.qty`.
- **New list actions:**

  | Action | Effect |
  |---|---|
  | `add:list:{record}` | Add an item at the end |
  | `remove:t` | Remove the item a loop variable points at |
  | `remove:list:{i}` | Remove the item at a position |
  | `clear:list` | Empty the list |

- **Updates never change data in place.** Changing `t.done` makes a new `todos` list with a new item, so the store notices the change and the host's `change` event reports `todos`. A loop variable remembers where its item lives (`todos`, item 2), which is how writing to `t.done` finds it.

### 5. The host app's data

- `loom.state.set(key, data)` accepts lists and records, copied and checked as above.
- The `change` event reports the new value, so an app can save it ("the user ticked an item").
- This gives apps a simple way to pass real data today, before data sources (Phase 2.4) exist.

### 6. Teaching the model

- **The guide** gets a DATA section: literals, `each`, paths, the functions and the list actions, with a to-do example and a cart example. Each new element's `example` flows into the guide automatically, as today.
- **Rule for models:** keep data on the `state` line. Never repeat an element by hand for each item; use `each`.
- **New eval category "data":** a to-do list, a cart with a total, a leaderboard, a product grid, orders with nested lines, a kanban with three columns, a contact list. They check that the model used `each` and that the numbers add up.
- **The "hard" cases** from testing (bill splitter, to-do with celebration) join the eval set.

## Steps

Each step ends with typecheck, tests and build passing, and its own commit.

| # | Step | Includes | Tests |
|---|---|---|---|
| 1 | **Data values** | `Value` type, data literal parser, tokenizer support for `[…]` on `state` lines, host data copying, limits, display in text | Literal parsing and errors; host data rejection (functions, cycles, class instances); limits |
| 2 | **Reading data** | Property access, `length`, record/list literals in `{…}`, the new functions | **Sandbox escapes**: `__proto__`, `constructor`, computed names, getters on host data, prototype pollution attempts; fuzzing with nested data |
| 3 | **`each`** | Parser (props, loop-variable scope check), expand step, per-node scope through layout, paint, hit testing and press; instance ids with keys | Rendering, nesting, 500-item limit, focus and fade staying on the right item when items move, streaming every prefix |
| 4 | **Writing data** | Path `bind=`, shared bind helpers in all 11 components, path actions, `add`/`remove`/`clear`, immutable updates | Ticking, removing and adding items; `bind` inside `each` for every bind component; change events |
| 5 | **Guide, eval and samples** | DATA section, examples, "data" and "hard" eval categories, a "Packing list" and a "Cart" sample, visual baselines | Guide examples parse; samples stream cleanly |
| 6 | **Docs** | README language section, CLAUDE.md, PLAN.md status | `docs:check` |

**After it ships:** run `npm run eval -- --only data` with Qwen3 14B, and compare with a run on today's `main` for the same requests.

## Risks

- **The sandbox (rule 1).** Property access is the first time expressions reach inside values, and that's exactly where prototype tricks live. Step 2 gets the same treatment as the earlier sandbox fix: own-property checks only, data copied into null-prototype records, blocked names, and fuzzing that tries to reach JavaScript.
- **Ten components change how they read state.** That's a wide refactor. The shared helpers keep it mechanical, and the contract tests plus the per-component behavior tests catch regressions.
- **Ids change for repeated elements.** Focus, hover, fade-in, the inspector and the test helpers all key on node ids. Ids for elements outside any `each` stay exactly the same, so existing screens and visual baselines don't move.
- **Performance.** Expand runs on every state change. A benchmark with a 500-item list joins `npm run bench` in step 3, to keep it fast.
- **Models may not use it well at first.** Small models might still copy elements by hand. The eval numbers will show it, and the guide's examples are the fix.

## Decisions to confirm

1. **`each items=todos as=t`**, not `each todos as=t`. It keeps Loom's one rule, "everything after the element name is `name=value`", which is easier for models than a special case. *Recommended.*
2. **`remove:t`** to remove the current item, with `remove:list:{i}` as the fallback. It's the simplest for models inside `each`. *Recommended.*
3. **Braces starting with `name:` are a record**, so `add:todos:{text:'Snacks'}` works without extra syntax. *Recommended.*
4. **A 500-item limit** until scrolling exists. *Recommended.*

## Not in this plan

- **Typing new items in** (an "add a to-do" box) needs the `input` component (Phase 3).
- **Sorting and filtering functions**, like `sort(list, 'price')`. They're easy to add later if the eval shows models want them. Until then, `if=` on items filters.
- **Data sources and host commands** (Phase 2.4 and 2.5): fetching data by name, and buttons that run the app's code with checked arguments. They build on this and get their own plan.
- **`table` and `chart`** become straightforward once lists exist. They come after this, as components.
