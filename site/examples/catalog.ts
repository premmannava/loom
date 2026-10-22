/**
 * The website's example gallery. Plain data with no browser or Vue imports,
 * so test/site.test.ts can check every spec parses cleanly and behaves as
 * described with the real engine.
 *
 * All names, prices and records here are fictional. Nothing on the site is
 * connected to a backend: emitted actions are shown as simulated.
 *
 * Adapted from the development playground's samples (playground/samples.ts),
 * the model guide's worked examples (src/prompt.ts) and the monthly budget
 * example (playground/connected-order/monthly-budget.loom).
 */

export interface Example {
  id: string;
  title: string;
  /** One or two sentences: what it is. */
  summary: string;
  /** The Loom features it demonstrates, as short phrases. */
  features: string[];
  /** Set when an action pretends to submit something. */
  simulated?: string;
  spec: string;
}

const tip: Example = {
  id: "tip-calculator",
  title: "Tip calculator",
  summary: "Split a restaurant bill. Every figure is a derived value, recalculated whenever an input changes.",
  features: ["state", "derive", "stepper and slider bindings", "set: actions", "variant chosen by an expression", "money()"],
  spec: `state bill=86 percent=18 people=2
derive tip={bill * percent / 100}
derive total={bill + tip}
derive perPerson={total / people}
card
  text "Tip calculator" style=title
  text "Change any input and every figure updates." tone=muted
  stepper "Bill ($)" bind=bill min=0 max=2000 step=2
  slider "Tip: {percent}%" bind=percent min=0 max=30
  row
    button "15%" variant={percent == 15 ? 'primary' : 'secondary'} on=set:percent:15
    button "18%" variant={percent == 18 ? 'primary' : 'secondary'} on=set:percent:18
    button "20%" variant={percent == 20 ? 'primary' : 'secondary'} on=set:percent:20
  stepper "People" bind=people min=1 max=20
  divider
  grid min=130 gap=10
    stat label="Tip" value={money(tip)}
    stat label="Total" value={money(total)}
    stat label="Each person pays" value={money(perPerson)} tone=accent`,
};

const grocery: Example = {
  id: "grocery-checklist",
  title: "Grocery checklist",
  summary: "A shopping list you can tick off, filter, add to and clear. The list lives in state; checking an item writes straight into it.",
  features: ["lists in state", "each with keys", "bind= on item paths", "add / remove / set with filter()", "switch", "if= and empty states"],
  spec: `state newItem="" hideDone=false nextId=6
state groceries=[{id: 1, name: "Oat milk", aisle: "Dairy", done: false}, {id: 2, name: "Eggs", aisle: "Dairy", done: true}, {id: 3, name: "Sourdough bread", aisle: "Bakery", done: false}, {id: 4, name: "Bananas", aisle: "Produce", done: false}, {id: 5, name: "Spinach", aisle: "Produce", done: true}]
derive total={len(groceries)}
derive inCart={count(groceries, 'done')}
card
  text "Grocery list" style=title
  text "{inCart} of {plural(total, 'item')} in the cart" tone=muted
  progress value={inCart} max={max(total, 1)}
  switch "Hide items already in the cart" bind=hideDone
  each items=groceries as=g key={g.id}
    row align=center if={!(hideDone && g.done)}
      check "{g.name}" bind=g.done
      badge "{g.aisle}" tone=muted
      button "Remove" variant=secondary on=remove:g
  empty "Your list is empty" detail="Add something below." if={total == 0}
  text "Everything is in the cart." tone=good if={total > 0 && inCart == total}
  row align=bottom
    input "Add an item" bind=newItem placeholder="e.g. Apples"
    button "Add" on="add:groceries:{id: nextId, name: trim(newItem), aisle: 'Other', done: false};inc:nextId;set:newItem:''" disabled={trim(newItem) == ''}
  button "Remove items in the cart" variant=secondary on="set:groceries:{filter(groceries, 'done', false)}" disabled={inCart == 0}`,
};

const budget: Example = {
  id: "monthly-budget",
  title: "Monthly budget dashboard",
  summary: "Filter a month of expenses by month and category, adjust the budget, and select a row for details. Charts, tables and totals all read the same derived list.",
  features: ["select", "derived filtering", "bar chart", "sortable, selectable table", "slider", "find()", "conditional text"],
  spec: `state transactions=[{id: "oct-groceries", month: "October", date: "2026-10-02", category: "Food", description: "Groceries", amount: 64.5}, {id: "oct-internet", month: "October", date: "2026-10-04", category: "Home", description: "Internet", amount: 80}, {id: "oct-fuel", month: "October", date: "2026-10-08", category: "Transit", description: "Fuel", amount: 42}, {id: "oct-restaurant", month: "October", date: "2026-10-11", category: "Food", description: "Restaurant", amount: 87.5}, {id: "oct-electricity", month: "October", date: "2026-10-15", category: "Home", description: "Electricity", amount: 132}, {id: "oct-parking", month: "October", date: "2026-10-19", category: "Transit", description: "Parking", amount: 35}, {id: "nov-groceries", month: "November", date: "2026-11-03", category: "Food", description: "Groceries", amount: 72}, {id: "nov-concert", month: "November", date: "2026-11-08", category: "Fun", description: "Concert", amount: 95}, {id: "nov-rent", month: "November", date: "2026-11-01", category: "Home", description: "Rent share", amount: 640}]
state months=["October", "November"] categories=["All", "Food", "Home", "Transit", "Fun"] month="October" category="All" budget=600 selectedId="oct-electricity" sortField="date" sortDirection="asc"
derive inMonth={filter(transactions, 'month', month)}
derive visible={category == 'All' ? inMonth : filter(inMonth, 'category', category)}
derive spent={sum(visible, 'amount')}
derive remaining={budget - spent}
derive selected={find(transactions, 'id', selectedId)}
column gap=14
  text "Monthly budget" style=title
  row
    select "Month" items=months bind=month
    select "Category" items=categories bind=category
  grid min=150 gap=10
    stat label="Expenses" value={len(visible)}
    stat label="Spent" value={money(spent)}
    stat label="Remaining" value={money(remaining)} tone={remaining < 0 ? 'bad' : 'good'}
  progress value={min(spent, budget)} max={budget} label="{round(spent / budget * 100, 0)}% of {money(budget)} used" tone={remaining < 0 ? 'bad' : 'accent'}
  text "Over budget by {money(-remaining)}" tone=bad if={remaining < 0}
  slider "Monthly budget: {money(budget)}" bind=budget min=100 max=1500 step=50
  chart "Spending by expense" kind=bar items=visible x=description y=amount format=money
  table "Expenses" items=visible key=id bind=selectedId sort=sortField direction=sortDirection
    table-column "Date" field=date
    table-column "Description" field=description
    table-column "Amount" field=amount format=money
  card
    text "Selected expense" weight=semibold
    text "{selected.description} · {selected.category} · {selected.date}" if={selected}
    text "{money(selected.amount)}" style=lead if={selected}
    text "Pick a row in the table to see it here." tone=muted if={!selected}`,
};

const request: Example = {
  id: "equipment-request",
  title: "Equipment request form",
  summary: "Pick an item, a quantity and a delivery date, then submit. Submission is simulated: the spec emits an event, and this page only shows that it would have been sent.",
  features: ["select with unavailable options", "date-picker", "input", "disabled conditions", "emit: with a record", "if= to swap the form for a confirmation"],
  simulated: "Submitting emits a request event to the page. Nothing is sent anywhere.",
  spec: `state item="" qty=1 needBy="" note="" submitted=false
state items=[{id: "laptop", name: "Laptop"}, {id: "monitor", name: "27-inch monitor"}, {id: "headset", name: "Headset"}, {id: "chair", name: "Desk chair (back-ordered)", backordered: true}]
derive chosen={find(items, 'id', item)}
derive ready={item != '' && needBy != ''}
card if={!submitted}
  text "Request equipment" style=title
  text "Fictional catalog. Submitting is simulated." tone=muted
  select "Item" items=items value=id label=name unavailable=backordered bind=item placeholder="Choose equipment"
  stepper "Quantity" bind=qty min=1 max=10
  date-picker "Needed by" bind=needBy min="2026-01-01" max="2028-12-31" placeholder="Choose a date"
  input "What is it for?" bind=note placeholder="e.g. New starter on the design team"
  card if={chosen}
    text "Summary" weight=semibold
    text "{plural(qty, chosen.name)}"
    text "{needBy == '' ? 'Choose a date to continue' : 'Needed by ' + needBy}" tone={needBy == '' ? 'warn' : 'muted'}
    text "{note}" tone=muted if={trim(note) != ''}
  button "Submit request" on="emit:request:{item: item, qty: qty, needBy: needBy, note: trim(note)};set:submitted:true" disabled={!ready}
card if={submitted}
  text "Request recorded" style=title
  badge "Simulated" tone=warn
  text "{plural(qty, chosen.name)}, needed by {needBy}."
  text "In a real app the host would receive the request event and decide what happens next. This page has no backend." tone=muted
  button "Start a new request" variant=secondary on="set:submitted:false;set:item:'';set:qty:1;set:needBy:'';set:note:''"`,
};

const configurator: Example = {
  id: "product-builder",
  title: "Product builder and cart",
  summary: "Configure a fictional backpack, add it to a cart, change quantities and check out. Two screens share one state; checkout is simulated.",
  features: ["screens with go:", "radio groups from each", "select", "derived prices", "add: records to a list", "notify:", "sum() with two fields"],
  simulated: "Check out emits a checkout event. No order is placed.",
  spec: `state model="ridge28" size="m" color="slate" qty=1 nextId=1 cart=[]
state models=[{id: "ridge28", name: "Ridge 28 L", price: 129}, {id: "ridge18", name: "Ridge 18 L", price: 99}]
state colors=[{id: "slate", name: "Slate"}, {id: "moss", name: "Moss"}, {id: "ember", name: "Ember (sold out)", soldOut: true}]
derive pick={find(models, 'id', model)}
derive colorName={find(colors, 'id', color).name}
derive unit={pick.price + (size == 'l' ? 10 : 0)}
derive units={sum(cart, 'qty')}
derive subtotal={sum(cart, 'price', 'qty')}
derive shipping={subtotal == 0 || subtotal >= 150 ? 0 : 9}
derive total={subtotal + shipping}
screen name=build title="Build your pack"
  text "A made-up product with made-up prices." tone=muted
  text "Model" weight=semibold
  each items=models as=m key={m.id}
    radio "{m.name} · {money(m.price)}" bind=model value={m.id}
  select "Color" items=colors value=id label=name unavailable=soldOut bind=color
  text "Size" weight=semibold
  row
    radio "S" bind=size value=s
    radio "M" bind=size value=m
    radio "L (+$10)" bind=size value=l
  stepper "Quantity" bind=qty min=1 max=5
  card
    text "{pick.name} · {colorName} · size {upper(size)}" weight=semibold
    stat label="Price" value={money(unit * qty)}
  row
    button "Add to cart" on="add:cart:{id: nextId, name: pick.name, detail: colorName + ' · size ' + upper(size), price: unit, qty: qty};inc:nextId;notify:'Added to your cart'"
    button "View cart ({units})" variant=secondary on=go:cart
screen name=cart title="Your cart"
  each items=cart as=line key={line.id}
    row align=top
      column gap=2
        text "{line.name}" weight=semibold
        text "{line.detail}" tone=muted
        link "Remove" on=remove:line
      stepper bind=line.qty min=1 max=5
      text "{money(line.price * line.qty)}" weight=semibold align=right
  empty "Your cart is empty" detail="Build a pack and add it." action="Build a pack" on=go:build if={len(cart) == 0}
  divider
  list
    list-item "Subtotal" trailing="{money(subtotal)}"
    list-item "Shipping" detail="Free over $150" trailing="{shipping == 0 ? 'Free' : money(shipping)}"
    list-item "Total" trailing="{money(total)}"
  row
    button "Keep shopping" variant=secondary on=go:build
    button "Check out" on="emit:checkout:{cart};notify:'Demo only: no order was placed'" disabled={len(cart) == 0}`,
};

const inventory: Example = {
  id: "equipment-table",
  title: "Searchable equipment table",
  summary: "Search as you type, filter by category, sort by any column and select a row for its details.",
  features: ["input kind=search", "search() and filter()", "table sorting through state", "row selection", "empty state with a reset action"],
  spec: `state query="" category="All" selected="mon27" sortField="name" sortDirection="asc"
state categories=["All", "Computers", "Displays", "Audio", "Accessories"]
state equipment=[{id: "lap14", name: "Laptop 14-inch", category: "Computers", price: 1180, stock: 9}, {id: "lap16", name: "Laptop 16-inch", category: "Computers", price: 1640, stock: 4}, {id: "mon27", name: "Monitor 27-inch", category: "Displays", price: 349, stock: 18}, {id: "mon32", name: "Monitor 32-inch", category: "Displays", price: 529, stock: 0}, {id: "head", name: "Noise-cancelling headset", category: "Audio", price: 199, stock: 12}, {id: "spk", name: "Conference speaker", category: "Audio", price: 145, stock: 3}, {id: "dock", name: "USB-C dock", category: "Accessories", price: 189, stock: 22}, {id: "kbd", name: "Wireless keyboard", category: "Accessories", price: 79, stock: 31}]
derive matches={search(equipment, 'name', query)}
derive shown={category == 'All' ? matches : filter(matches, 'category', category)}
derive item={find(equipment, 'id', selected)}
card
  text "Equipment catalog" style=title
  row align=bottom
    input "Search" bind=query kind=search placeholder="e.g. monitor"
    select "Category" items=categories bind=category
  text "{len(shown)} of {plural(len(equipment), 'item')} · sorted by {sortField}, {sortDirection == 'asc' ? 'ascending' : 'descending'}" tone=muted
  table items=shown key=id bind=selected sort=sortField direction=sortDirection
    table-column "Item" field=name
    table-column "Price" field=price format=money
    table-column "Stock" field=stock format=number
  empty "No equipment matches" detail="Try another search or category." action="Clear filters" on="set:query:'';set:category:'All'" if={len(shown) == 0}
  card if={item}
    row align=center
      text "{item.name}" weight=semibold
      badge "{item.stock == 0 ? 'Out of stock' : 'In stock'}" tone={item.stock == 0 ? 'bad' : 'good'}
    text "{item.category}" tone=muted
    grid min=130 gap=10
      stat label="Price" value={money(item.price)}
      stat label="In stock" value={item.stock}
      stat label="Stock value" value={money(item.price * item.stock)}`,
};

const metrics: Example = {
  id: "store-metrics",
  title: "Store metrics with charts",
  summary: "A bar chart you can adjust with steppers and a line chart you can extend. Charts redraw from the list in state whenever it changes.",
  features: ["bar and line charts", "stepper on list items", "add: and remove: by position", "number()"],
  spec: `state depts=[{name: "Footwear", units: 610}, {name: "Outdoor", units: 420}, {name: "Apparel", units: 380}, {name: "Camping", units: 270}]
state months=[{month: "May", visits: 8200}, {month: "Jun", visits: 9600}, {month: "Jul", visits: 11800}, {month: "Aug", visits: 10900}, {month: "Sep", visits: 12700}, {month: "Oct", visits: 14100}]
card
  text "Units sold this month" style=title
  text "{number(sum(depts, 'units'))} units across {len(depts)} departments" tone=muted
  chart kind=bar items=depts x=name y=units
  each items=depts as=d key={d.name}
    row align=center
      text "{d.name}"
      stepper bind=d.units min=0 max=2000 step=10
card
  text "Store visits" style=title
  text "{number(sum(months, 'visits'))} visits over {plural(len(months), 'month')}" tone=muted
  chart kind=line items=months x=month y=visits
  row
    button "Add November" on="add:months:{month: 'Nov', visits: 15200}" disabled={len(months) > 6}
    button "Drop oldest month" variant=secondary on=remove:months:0 disabled={len(months) < 2}`,
};

export const examples: readonly Example[] = [tip, grocery, budget, request, configurator, inventory, metrics];

/** The three the landing page offers beside the hero demo. */
export const heroExamples = [
  { example: tip, label: "Calculator", shows: "Derived values" },
  { example: grocery, label: "Checklist", shows: "Lists and state" },
  { example: budget, label: "Dashboard", shows: "Charts and tables" },
] as const;

export const exampleById = (id: string): Example | undefined => examples.find((e) => e.id === id);
