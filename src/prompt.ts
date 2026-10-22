/**
 * Generates the language guide a model needs to write Loom specs, straight
 * from the component registry. Because it's generated, the model's view of
 * the language can never drift from what the engine actually supports.
 *
 * The guide starts with a one-line index of every element and then gives each
 * one's details and example, so it can later be split (index in the prompt,
 * details on request) without being rewritten.
 *
 * Two modes, both generated from the same ComponentDefs:
 * - full (the default): every element with its props explained and its example.
 * - compact: the same facts (names, props, types, enum values, what's
 *   required, where elements may go, the rules) in one line per element, with
 *   fewer worked examples. Smaller prompts; whether they generate as well is a
 *   question for `npm run eval -- --guide full,compact`, not an assumption.
 *
 * A profile limits the elements the model is told about (see profiles.ts).
 * Every example shown is checked by parsing it against those elements, so the
 * guide never shows the model something it can't use.
 */
import { ACTION_OPS, ACTION_SYNTAX } from "./actions";
import { CATEGORIES, COMMON_PROPS, type ComponentDef, type PropDef } from "./component";
import { EXPRESSION_FUNCTIONS } from "./expr";
import { parse } from "./parser";
import { resolveProfile, type ComponentProfile } from "./profiles";
import type { Registry } from "./registry";

/** An emit: action the host app listens for. */
export interface AppAction {
  /** The emit name, e.g. add_to_cart. */
  name: string;
  /** What the value should be, e.g. "the product id". Leave out if the action takes none. */
  value?: string;
  /** When to use it. */
  description: string;
}

export interface GuideOptions {
  /**
   * Hosts images may load from: pass the same list as the engine's imageHosts.
   * With none, the model is told to use images only with URLs it was given.
   */
  imageHosts?: readonly string[];
  /** The emit: actions the app understands, so the model uses the right names. */
  actions?: readonly AppAction[];
  /**
   * Include each element's own example. Default true in full mode (as
   * before), false in compact mode, where they're most of the size.
   */
  examples?: boolean;
  /** Extra instructions from the app, such as its domain, audience or tone. */
  notes?: string;
  /** "full" (default) or "compact". */
  mode?: GuideMode;
  /**
   * Which elements the model is told about: a profile name ("forms",
   * "lists", "shop", "dashboard"), a list of element names, or a
   * ComponentProfile. Default: every registered element. Dependencies (a tab
   * needs tabs) are added; see profiles.ts.
   */
  profile?: string | ComponentProfile | readonly string[];
  /**
   * The larger worked examples, by name: todo, form, cart, orders, booking, equipment, calculator, shopping.
   * true or left out = the mode's default (full: todo, cart, orders and
   * booking, exactly as before, or if a profile rules all of them out, the
   * first of COMPACT_EXAMPLE_ORDER it can build; compact: the first of COMPACT_EXAMPLE_ORDER
   * that the exposed elements can build); false = none. An example that uses
   * an element outside the profile is always left out. This is separate from
   * examples, which only covers each element's own short example.
   */
  workedExamples?: boolean | readonly WorkedExampleName[];
}

export type GuideMode = "full" | "compact";
export type WorkedExampleName = "todo" | "form" | "cart" | "orders" | "booking" | "equipment" | "calculator" | "shopping";

function propLine(name: string, d: PropDef): string {
  const type = d.type === "enum" && d.values ? d.values.join("|") : d.type;
  const req = d.required ? ", required" : "";
  return `    ${name}=<${type}${req}>  ${d.description}`;
}

function componentBlock(c: ComponentDef, examples: boolean): string {
  const head = c.text ? `${c.type} "<text>"` : c.type;
  const lines = [`  ${head}  — ${c.description}`];
  if (c.text) lines.push(`    "<text>"${c.text.required ? " (required)" : ""}  ${c.text.description}`);
  for (const [n, d] of Object.entries(c.props)) lines.push(propLine(n, d));
  if (c.children) lines.push(`    children: ${c.children === "any" ? "any elements" : c.children.join(", ")}`);
  if (c.parents) lines.push(`    only inside: ${c.parents.map((p) => (p === "root" ? "the top level" : p)).join(", ")}`);
  if (examples && c.example) {
    lines.push("    example:");
    for (const l of c.example.split("\n")) lines.push("      " + l);
  }
  return lines.join("\n");
}

/**
 * Full documentation for some elements, for tools that hand a model only what
 * it asks for (the MCP server's sayshape_docs). Elements an element needs come
 * along: a table's table-column, a tab's tabs. Unknown names are returned so
 * the caller can say so.
 */
export function elementGuide(registry: Registry, names: readonly string[]): { text: string; unknown: string[] } {
  const wanted: ComponentDef[] = [];
  const unknown: string[] = [];
  const add = (name: string) => {
    const def = registry.get(name);
    if (!def) { if (name !== "root") unknown.push(name); return; }
    if (!wanted.includes(def)) wanted.push(def);
  };
  for (const n of names) {
    const def = registry.get(n);
    add(n);
    if (!def) continue;
    if (Array.isArray(def.children)) def.children.forEach(add);
    def.parents?.forEach(add);
  }
  return { text: wanted.map((c) => componentBlock(c, true)).join("\n\n"), unknown };
}

/** One line per element, grouped by category, so the model sees the whole menu first. */
export function elementIndex(comps: readonly ComponentDef[]): string {
  return CATEGORIES.map((cat) => [cat, comps.filter((c) => c.category === cat)] as const)
    .filter(([, defs]) => defs.length)
    .map(([cat, defs]) => `- ${cat}: ${defs.map((d) => d.type).join(", ")}`)
    .join("\n");
}

function imageRules(hosts: readonly string[]): string {
  if (!hosts.length) {
    return "- Only use image with a URL the user or app gave you. Never make up image URLs; leave images out instead.";
  }
  return `- Images only load from these hosts: ${hosts.join(", ")}. Only use image URLs from them that you were given or know exist. Never make up URLs; leave images out instead.
- Always describe what the image shows in its quoted text; it's displayed if the image can't load.`;
}

function appActions(actions: readonly AppAction[]): string {
  return actions
    .map((a) => `- emit:${a.name}${a.value ? `:<${a.value}>` : ""}  ${a.description}`)
    .join("\n");
}

/**
 * Complete specs the DATA section shows, exported so tests can check they
 * parse cleanly and behave as described.
 */
export const WORKED_EXAMPLES = {
  shopping: `state groceries=[{name: "Milk", purchased: false}, {name: "Eggs", purchased: false}, {name: "Bread", purchased: false}] newItem=""
derive remaining={count(groceries, 'purchased', false)}
card
  text "Grocery list" style=title
  text "{remaining} items left" tone=muted
  each items=groceries as=item
    row
      check "{item.name}" bind=item.purchased
      button "Remove" variant=secondary on=remove:item
  input "Add an item" bind=newItem placeholder="e.g. Apples" on="add:groceries:{name: trim(newItem), purchased: false};set:newItem:''"
  button "Add" on="add:groceries:{name: trim(newItem), purchased: false};set:newItem:''" disabled={trim(newItem) == ''}`,
  calculator: `state bill=50 percent=15 people=1
derive tip={bill * percent / 100}
derive total={bill + tip}
derive perPerson={total / people}
card
  text "Tip calculator" style=title
  text "Bill amount"
  stepper bind=bill min=0 max=1000 step=5
  slider "Tip percentage: {percent}%" bind=percent min=0 max=30
  text "People"
  stepper bind=people min=1 max=20
  stat label="Tip" value={money(tip)}
  stat label="Total" value={money(total)}
  stat label="Per person" value={money(perPerson)}`,
  equipment: `state equipment=[{id: "laptop", name: "Laptop", team: "Engineering", price: 1200}, {id: "monitor", name: "Monitor", team: "Engineering", price: 350}, {id: "headset", name: "Headset", team: "Sales", price: 120}]
state departments=["All", "Engineering", "Sales"] department="All" selected="laptop" quantity=1 delivery="" sortField="name" sortDirection="asc"
derive visible={department == 'All' ? equipment : filter(equipment, 'team', department)}
derive item={find(equipment, 'id', selected)}
derive subtotal={item ? item.price * quantity : 0}
derive tax={subtotal * 0.08}
derive total={subtotal + tax}
card
  text "Equipment request" style=title
  select "Department" items=departments bind=department
  table items=visible key=id bind=selected sort=sortField direction=sortDirection
    table-column "Equipment" field=name
    table-column "Price" field=price format=money
  text "Quantity"
  stepper bind=quantity min=1 max=5
  date-picker "Delivery date" bind=delivery
  text "{item ? item.name : 'Choose equipment'} × {quantity}"
  text "Delivery: {delivery == '' ? 'Choose a date' : delivery}"
  stat label="Subtotal" value={money(subtotal)}
  stat label="Tax" value={money(tax)}
  stat label="Total" value={money(total)}`,
  todo: `state task="" todos=[{text: "Pack water", done: true}, {text: "Charge headlamp", done: false}, {text: "Snacks", done: false}]
card
  text "Packing list" style=title
  text "{count(todos, 'done')} of {len(todos)} packed" tone=muted
  each items=todos as=t
    row
      check "{t.text}" bind=t.done
      button "Remove" variant=secondary on=remove:t
  row
    input bind=task placeholder="Add an item" on="add:todos:{text: task, done: false};set:task:''"
    button "Add" on="add:todos:{text: task, done: false};set:task:''" disabled={trim(task) == ''}`,
  cart: `state cart=[{name: "Trail socks", price: 24, qty: 2}, {name: "Rain shell", price: 129, qty: 1}]
card
  text "Your cart" style=title
  each items=cart as=item
    row
      text "{item.name}"
      stepper bind=item.qty min=1 max=9
      text "\${item.price * item.qty}"
  divider
  text "Total \${sum(cart, 'price', 'qty')}" style=title`,
  orders: `state orders=[{date: "May 2", lines: [{name: "Tent", price: 180}, {name: "Stove", price: 45}]}, {date: "May 9", lines: [{name: "Headlamp", price: 30}]}]
each items=orders as=o
  card
    text "Order of {o.date}" weight=semibold
    each items=o.lines as=line
      row
        text "{line.name}"
        text "\${line.price}" align=right
    text "Total \${sum(o.lines, 'price')}" align=right`,
  form: `state email="" agree=false
card
  text "Join the trail club" style=title
  input "Email" bind=email kind=email placeholder="you@example.com"
  check "I agree to the club rules" bind=agree
  button "Sign up" on="emit:signup:{email};notify:'Welcome!'" disabled={!agree || trim(email) == ''}`,
  booking: `state guests=2 nights=3
card
  text "Cabin booking" style=title
  text "\${guests*nights*45} for {nights} nights" tone=muted
  row
    stat label="Guests" value={guests}
    stat label="Nights" value={nights}
  row
    button "Fewer nights" variant=secondary on=dec:nights
    button "More nights" variant=secondary on=inc:nights
  button "Book" on=emit:book`,
};

/** The worked examples the full guide's DATA section shows. Kept under its old name for existing imports. */
export const DATA_EXAMPLES = { todo: WORKED_EXAMPLES.todo, cart: WORKED_EXAMPLES.cart, orders: WORKED_EXAMPLES.orders };

const isStateLine = (l: string) => /^state\s/.test(l);

/**
 * A component's example as a complete spec. Components that only go inside a
 * parent (pin, tab, list-item) are wrapped in the parent's own example line,
 * along with that example's state, so the snippet parses as it would in use.
 */
export function componentExampleSpec(def: ComponentDef, all: readonly ComponentDef[]): string {
  const example = def.example ?? "";
  const parentType = def.parents?.find((p) => p !== "root");
  if (!parentType) return example + "\n";
  const parent = all.find((d) => d.type === parentType);
  const parentLines = (parent?.example ?? parentType).split("\n");
  const head = parentLines.find((l) => l.startsWith(parentType)) ?? parentType;
  const lines = example.split("\n");
  return [...parentLines.filter(isStateLine), ...lines.filter(isStateLine), head, ...lines.filter((l) => !isStateLine(l)).map((l) => "  " + l)].join("\n") + "\n";
}

/** What the guide is being built for: the exposed elements and the options. */
interface GuideContext {
  comps: ComponentDef[];
  exposed: Registry;
  has: (type: string) => boolean;
  opts: GuideOptions;
  mode: GuideMode;
  /** Whether a spec only uses exposed elements, and parses with no problems. */
  valid: (spec: string) => boolean;
}

function context(registry: Registry, opts: GuideOptions): GuideContext {
  const profile = resolveProfile(registry, opts.profile);
  const exposed = profile.registry;
  return {
    comps: exposed.all(),
    exposed,
    has: (type) => exposed.has(type),
    opts,
    mode: opts.mode ?? "full",
    valid: (spec) => parse(spec.endsWith("\n") ? spec : spec + "\n", exposed).diagnostics.length === 0,
  };
}

/** Compact mode shows the first of these that the exposed elements can build. */
export const COMPACT_EXAMPLE_ORDER: readonly WorkedExampleName[] = ["todo", "form", "cart", "orders", "booking"];

/** The worked examples to show: the asked-for or default ones that are valid for the exposed elements. */
function workedExamples(ctx: GuideContext): WorkedExampleName[] {
  const w = ctx.opts.workedExamples;
  if (w === false) return [];
  if (Array.isArray(w)) return (w as readonly WorkedExampleName[]).filter((n) => ctx.valid(WORKED_EXAMPLES[n]));
  const first = COMPACT_EXAMPLE_ORDER.find((n) => ctx.valid(WORKED_EXAMPLES[n]));
  if (ctx.mode === "full") {
    const shown = (["todo", "cart", "orders", "booking"] as const).filter((n) => ctx.valid(WORKED_EXAMPLES[n]));
    // A profile that can build none of them still gets one example.
    return shown.length || !first ? shown : [first];
  }
  // Compact: one example, the first that works with the exposed elements.
  return first ? [first] : [];
}

const indent = (spec: string, by = "  ") => spec.split("\n").map((l) => by + l).join("\n");

const LIST_OPS = new Set<string>(["add", "remove", "clear"]);

// ---------------------------------------------------------------- full mode

function dataSection(ctx: GuideContext): string {
  const { has } = ctx;
  const shown = workedExamples(ctx).filter((n) => n === "todo" || n === "cart" || n === "orders");
  const titles: Record<string, string> = { todo: "A to-do list:", cart: "A cart whose total follows the quantities:", orders: "Orders, each with its own list of lines:" };
  const lines = [
    `DATA AND LISTS`,
    `- Keep data in state as lists and records, on one line: state todos=[{text: "Pack water", done: false}, {text: "Snacks", done: true}]`,
    `- Repeat elements with each, once per item. Never copy an element by hand for every item:\n  each items=todos as=t`,
    `- Inside each, the current item is t (from as=t; item if as= is left out). index=i gives its position from 0. t only exists inside its each.`,
    `- Read fields: {t.text}, {cart[0].price}, {todos.length}`,
    `- Compute numbers from the list instead of writing them yourself: len(list), count(list, 'done') counts items whose field is true, count(list, 'cat', 'Gas') counts items whose field equals a value, sum(list, 'price'), sum(list, 'price', 'qty') multiplies two fields per item, avg(list, 'field'), min(list, 'field'), max(list, 'field'), join(list, 'name'), includes(list, value). These count only numbers: write prices and quantities as numbers (24, not "24")`,
    `- Narrow and order lists: filter(list, 'done'), filter(list, 'cat', 'Gas'), find(list, 'id', picked) for one item, search(list, 'name', query), sort(list, 'price'), sort(list, 'price', 'desc'), take(list, 3), first(list) and last(list) for one item. Combine them: first(sort(sales, 'revenue', 'desc')).month for the best one, sum(filter(tx, 'cat', 'Gas'), 'amount'), find(rooms, 'id', room).rate`,
    `- Use filter() for counts and totals. To hide items that people can still change (bind=t.done), keep each items=todos and put if= on the repeated element`,
    `- Share one computed list or total between elements instead of repeating it: derive open={filter(orders, 'status', 'open')}, then items=open and {len(open)}`,
    ...(has("radio") ? [`- To compare two fields of an item (an answer and its correct answer), set a field when choosing, then count it: radio "{o}" bind=q.pick value={o} on="set:q.ok:{o == q.answer}" and later count(qs, 'ok')`] : []),
    `- Format for people: money(2400) shows $2,400.00, number(37000) shows 37,000, compact(12345678) shows 12.3M and compact(n, 'USD') shows $12.3M (use it for big figures in stats), plural(n, 'item') shows 1 item or 3 items, lower(), upper(), trim()`,
    `- Change an item through its fields: bind=t.done, on=toggle:t.done, on=inc:item.qty, on="set:t.text:'Done'"`,
    `- Change the list: on="add:todos:{text: 'Map', done: false}", on=remove:t (inside each), on=clear:todos`,
    has("check") ? `- Show only some items with if= on the repeated element: check "{t.text}" bind=t.done if={!t.done}` : `- Show only some items with if= on the repeated element: text "{t.text}" if={!t.done}`,
    `- For a list inside each item (an order's lines, a day's activities), put an each inside the each: each items=o.lines as=line`,
    `- Loom has no JSX, HTML or JavaScript. {…} only computes values; it never makes elements. Repeat with each.`,
    ...(has("input") ? [`- To let people add an item they name, bind an input to a state value, add it, then clear it: input "New item" bind=task on="add:todos:{text: task, done: false};set:task:''"`] : []),
    ...(has("input") && has("list") ? [`- To filter a list as people type, bind an input and show matching items: each items=trails as=t, then list-item "{t.name}" if={includes(lower(t.name), lower(query))}; count matches with len(search(trails, 'name', query))`] : []),
  ];
  const examples = shown.map((n) => `${titles[n]}\n${indent(WORKED_EXAMPLES[n])}`);
  return [lines.join("\n"), ...examples].join("\n\n");
}

function fullSections(ctx: GuideContext): GuideSection[] {
  const { comps, has, opts } = ctx;
  const examples = opts.examples ?? true;
  const out: GuideSection[] = [];
  const add = (name: string, text: string) => out.push({ name, text });

  add("intro", `You write user interfaces in Loom, a line-based UI language. Output only Loom: no prose, no explanations and no code fences.`);
  add("format", `FORMAT
- One element per line: type "optional text" name=value name="quoted value" name={expression}
- Indent children with 2 spaces under a container.
- Props go on their element's own line: ${has("list") ? `list-item "{t.text}"` : `text "{t.text}"`} if={!t.done}
- To show several lines only when something is true, put them under a line holding only if={…}:
  if={count(todos, 'done') == len(todos)}
    text "All done!" tone=good
- Declare state first, at the top, unindented: state count=0 done=false name="Ada"
- Work a value out once with derive, unindented, one per line: derive total={sum(cart, 'price', 'qty')}. Read it like state ({total}), in text, props and other derive lines; it updates by itself. bind= and actions can't change it, and a derive can't read itself
- Every element and every state value fits on one line, even a long list: state trails=[{name: "Camelback", miles: 2.5}, {name: "Piestewa", miles: 2.1}]
- Lines starting with # are comments.`);
  add("expressions", `EXPRESSIONS
- {…} reads state: {count}, {price*qty}, {done ? 'Yes' : 'No'}, {round(total, 2)}
- Text can mix words and expressions: "Total: \${price*qty}"
- Operators: + - * / % == != < <= > >= && || ! and a ? b : c
- Functions: ${EXPRESSION_FUNCTIONS.join(", ")}
- Words inside {…} are state names. Quote text: {done ? 'Packed' : 'To pack'}, tone={late ? 'bad' : 'good'}`);
  // Screen and list actions only where their elements are exposed.
  const ops = ACTION_OPS.filter((o) => (has("screen") || (o !== "go" && o !== "back")) && (has("each") || !LIST_OPS.has(o)));
  add("actions", `ACTIONS (on=…)
- ${ops.map((o) => ACTION_SYNTAX[o]).join("\n- ")}
- Run several with ; e.g. on="set:step:2;emit:next"
- Quote on= when it has spaces: on="inc:n;notify:'Saved {n}'"`);
  if (has("each")) add("data", dataSection(ctx));
  if (opts.actions?.length) {
    add("app-actions", `APP ACTIONS
The app listens for these. Use them, with these names, for anything the app must do:
${appActions(opts.actions)}`);
  }
  add("common-props", `EVERY ELEMENT ACCEPTS
${Object.entries(COMMON_PROPS).map(([n, d]) => propLine(n, d)).join("\n")}`);
  add("index", `ELEMENTS AT A GLANCE
${elementIndex(comps)}`);
  // An element's example is shown only if it works with the exposed elements.
  add("elements", `ELEMENTS
${comps.map((c) => componentBlock(c, examples && ctx.valid(componentExampleSpec(c, comps)))).join("\n\n")}`);

  const rules = [
    "- Use only the elements and props above. Never invent colors, sizes or fonts; use style=, tone= and variant=. If asked for a specific color or size, use the closest role instead.",
    ...(has("card") ? ["- Start with a card unless the screen needs several."] : []),
    "- Keep screens focused: one task per screen, short labels, real-looking values.",
    ...(has("grid") || has("stat") ? [`- Screens may be narrow (a phone, a chat).${has("grid") ? " For side-by-side figures use grid min=140 rather than row." : ""}${has("stat") ? " Keep stat values short: compact() for large numbers." : ""}`] : []),
  ];
  if (has("screen")) rules.push("- For several screens, write the starting screen first: it shows as soon as it arrives.");
  if (has("image")) rules.push(imageRules(opts.imageHosts ?? []));
  add("rules", `RULES\n${rules.join("\n")}`);
  if (opts.notes?.trim()) add("notes", `ABOUT THIS APP\n${opts.notes.trim()}`);
  if (workedExamples(ctx).includes("form")) add("example-form", `A SIGN-UP FORM\n${WORKED_EXAMPLES.form}`);
  if (workedExamples(ctx).includes("equipment")) add("example-equipment", `EXAMPLE (equipment)\n${WORKED_EXAMPLES.equipment}`);
  if (workedExamples(ctx).includes("calculator")) add("example-calculator", `EXAMPLE (calculator)\n${WORKED_EXAMPLES.calculator}`);
  // Kept last: tests and tools read everything after "EXAMPLE\\n" as a spec.
  if (workedExamples(ctx).includes("booking")) add("example", `EXAMPLE\n${WORKED_EXAMPLES.booking}\n`);
  return out;
}

// ---------------------------------------------------------------- compact mode

const COMPACT_TYPES: Record<PropDef["type"], string> = {
  number: "number", string: "text", boolean: "true|false", enum: "", condition: "cond", expression: "expr", action: "action", state: "path", name: "name",
};

/** One line for an element: its signature, where it may go, and what it's for. */
function compactLine(c: ComponentDef): string {
  const parts: string[] = [c.type];
  if (c.text) parts.push(c.text.required ? `"text"` : `["text"]`);
  for (const [n, d] of Object.entries(c.props)) {
    const type = d.type === "enum" && d.values ? d.values.join("|") : COMPACT_TYPES[d.type];
    parts.push(`${n}=${type}${d.required ? "!" : ""}`);
  }
  const where: string[] = [];
  if (c.children) where.push(c.children === "any" ? "holds elements" : `holds ${c.children.join(", ")}`);
  if (c.parents) where.push(`only in ${c.parents.map((p) => (p === "root" ? "top level" : p)).join(", ")}`);
  const purpose = c.description.split(/(?<=\.)\s/)[0]!;
  return `${parts.join(" ")}${where.length ? ` [${where.join("; ")}]` : ""} — ${purpose}`;
}

function compactSections(ctx: GuideContext): GuideSection[] {
  const { comps, has, opts } = ctx;
  const out: GuideSection[] = [];
  const add = (name: string, text: string) => out.push({ name, text });

  add("intro", `You write user interfaces in Loom, a line-based UI language. Output only Loom: no prose, no explanations and no code fences.`);
  add("format", `FORMAT
- One element per line: type "text" prop=value prop="quoted value" prop={expression}. Indent children 2 spaces.
- Props stay on their element's line. A line holding only if={…} shows the lines indented under it while true.
- State first, unindented, every value on one line: state count=0 name="Ada" todos=[{text: "Water", done: false}]
- derive name={expr}, unindented, one per line, keeps a value worked out from state: derive total={sum(cart, 'price', 'qty')}, then {total}. Read-only (no bind= or actions); no loops through itself
- # starts a comment.`);
  add("expressions", `EXPRESSIONS
- {…} reads state and loop variables: {count}, {price*qty}, {t.text}, {cart[0].price}, {todos.length}. Text mixes words and {…}: "Total: \${price*qty}"
- Operators: + - * / % == != < <= > >= && || ! a ? b : c. Words inside {…} are names, so quote text: {done ? 'Yes' : 'No'}
- Functions: ${EXPRESSION_FUNCTIONS.join(", ")}
- On lists: count(l, 'done'), count(l, 'cat', 'Gas'), sum(l, 'price'), sum(l, 'price', 'qty') multiplies per item, avg/min/max(l, 'f'), filter(l, 'f'[, value]), find(l, 'id', x), search(l, 'f', text), sort(l, 'f'[, 'desc']), take(l, n), first(l)/last(l) (best: first(sort(l, 'f', 'desc')).name), join(l, 'f'), includes(l, x). Compute totals; never type them
- Formatting: money(2400) = $2,400.00, number(37000) = 37,000, compact(12345678) = 12.3M, compact(n, 'USD') = $12.3M for big figures in stats, plural(n, 'item') = 1 item / 3 items`);
  const local = ["inc:key[:by]", "dec:key[:by] (never below 0)", "toggle:key", "set:key:value or set:key:{expr}", ...(has("each") ? ["add:list:value", "remove:t (current item) or remove:list:index", "clear:list"] : []), "notify:'text {expr}'", ...(has("screen") ? ["go:screen", "back"] : [])];
  add("actions", `ACTIONS on=…, several joined with ; and quoted when they have spaces: on="inc:n;notify:'Saved {n}'"
- Change the screen (runs here): ${local.join(", ")}
- Tell the app (host event): emit:name[:value]. Use emit for anything the app must do, like book, pay or save
${has("each") ? "- A key can be a path into an item: toggle:t.done, inc:item.qty, set:t.text:'Done'\n" : ""}- A key can be a path into a record: set:form.email:'', toggle:settings.dark`);
  if (has("each")) {
    add("data", `DATA AND LISTS
- Keep data in state and repeat with each; never copy an element by hand per item: each items=todos as=t (t exists only inside; index=i is the 0-based position; key={t.id} keeps focus on items)
- A list inside each item: an each inside the each, items=o.lines
- bind=t.done and actions on t write back only when items= names a list in state. A computed list (items={filter(…)}) is read-only: to hide items that stay editable, keep items=todos and put if= on the repeated element${has("radio") ? `
- To compare two fields of an item, set one when choosing: radio "{o}" bind=q.pick value={o} on="set:q.ok:{o == q.answer}", then count(qs, 'ok')` : ""}${has("input") ? `
- To add what people type: input bind=task on="add:todos:{text: task, done: false};set:task:''"` : ""}
- No JSX, HTML or JavaScript: {…} computes values, never elements`);
  }
  const showExample = (c: ComponentDef) => opts.examples === true && !!c.example && ctx.valid(componentExampleSpec(c, comps));
  add("elements", `ELEMENTS (prop=type: ! required, a|b one of these, cond/expr an expression, path a state name or t.field, action an on= value)
- every element: if=cond
${comps.map((c) => `- ${compactLine(c)}${showExample(c) ? `\n    example:\n${indent(c.example!, "      ")}` : ""}`).join("\n")}`);
  const rules = [
    "- Use only these elements and props. No colors, sizes or fonts: choose roles with tone=, variant= and style=; for \"red\" or \"big\", use the closest role.",
    `- ${has("card") ? "Start with a card unless the screen needs several. " : ""}One task per screen, short labels, realistic values.`,
    ...(has("grid") || has("stat") ? [`- Screens may be narrow.${has("grid") ? " Side-by-side figures: grid min=140, not row." : ""}${has("stat") ? " Short stat values: compact() for large numbers." : ""}`] : []),
    ...(has("screen") ? ["- For several screens, write the starting screen first."] : []),
  ];
  add("rules", `RULES\n${rules.join("\n")}`);
  for (const n of workedExamples(ctx)) add(`example-${n}`, `EXAMPLE (${n})\n${WORKED_EXAMPLES[n]}`);
  // The app's own context goes last, after everything that's the same for every app.
  if (has("image")) add("images", `IMAGES\n${imageRules(opts.imageHosts ?? [])}`);
  if (opts.actions?.length) add("app-actions", `APP ACTIONS (emit these names for what the app must do)\n${appActions(opts.actions)}`);
  if (opts.notes?.trim()) add("notes", `ABOUT THIS APP\n${opts.notes.trim()}`);
  return out;
}

// ---------------------------------------------------------------- public

export interface GuideSection {
  /** A stable name, for measuring: intro, format, expressions, actions, data, elements, rules… */
  name: string;
  text: string;
}

/** The guide in sections, in order. languageGuide() joins them with blank lines. */
export function guideSections(registry: Registry, opts: GuideOptions = {}): GuideSection[] {
  const ctx = context(registry, opts);
  return ctx.mode === "compact" ? compactSections(ctx) : fullSections(ctx);
}

export function languageGuide(registry: Registry, opts: GuideOptions = {}): string {
  return guideSections(registry, opts).map((s) => s.text).join("\n\n");
}

/** What a guide covers, for reports: its mode, profile, elements and size. */
export interface GuideInfo {
  mode: GuideMode;
  profile: string;
  components: readonly string[];
  chars: number;
  /** Characters / 4: a rough estimate, not a tokenizer count. */
  estimatedTokens: number;
}

export function describeGuide(registry: Registry, opts: GuideOptions = {}): GuideInfo {
  const profile = resolveProfile(registry, opts.profile);
  const chars = languageGuide(registry, opts).length;
  return { mode: opts.mode ?? "full", profile: profile.name, components: profile.types, chars, estimatedTokens: Math.round(chars / 4) };
}
