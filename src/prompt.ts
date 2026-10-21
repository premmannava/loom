/**
 * Generates the language guide a model needs to write Loom specs, straight
 * from the component registry. Because it's generated, the model's view of
 * the language can never drift from what the engine actually supports.
 *
 * The guide starts with a one-line index of every element and then gives each
 * one's details and example, so it can later be split (index in the prompt,
 * details on request) without being rewritten.
 */
import { ACTION_OPS, ACTION_SYNTAX } from "./actions";
import { CATEGORIES, COMMON_PROPS, type ComponentDef, type PropDef } from "./component";
import { EXPRESSION_FUNCTIONS } from "./expr";
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
  /** Include each element's example (default true). Examples help models more than prop lists. */
  examples?: boolean;
  /** Extra instructions from the app, such as its domain, audience or tone. */
  notes?: string;
}

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

/** One line per element, grouped by category, so the model sees the whole menu first. */
function index(comps: readonly ComponentDef[]): string {
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
export const DATA_EXAMPLES = {
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
};

function dataSection(): string {
  const indent = (spec: string) => spec.split("\n").map((l) => "  " + l).join("\n");
  return `DATA AND LISTS
- Keep data in state as lists and records, on one line: state todos=[{text: "Pack water", done: false}, {text: "Snacks", done: true}]
- Repeat elements with each, once per item. Never copy an element by hand for every item:
  each items=todos as=t
- Inside each, the current item is t (from as=t; item if as= is left out). index=i gives its position from 0. t only exists inside its each.
- Read fields: {t.text}, {cart[0].price}, {todos.length}
- Compute numbers from the list instead of writing them yourself: len(list), count(list, 'done') counts items whose field is true, count(list, 'cat', 'Gas') counts items whose field equals a value, sum(list, 'price'), sum(list, 'price', 'qty') multiplies two fields per item, avg(list, 'field'), min(list, 'field'), max(list, 'field'), join(list, 'name'), includes(list, value)
- Narrow and order lists: filter(list, 'done'), filter(list, 'cat', 'Gas'), find(list, 'id', picked) for one item, search(list, 'name', query), sort(list, 'price'), sort(list, 'price', 'desc'), take(list, 3). Combine them: sum(filter(tx, 'cat', 'Gas'), 'amount'), find(rooms, 'id', room).rate
- Use filter() for counts and totals. To hide items that people can still change (bind=t.done), keep each items=todos and put if= on the repeated element
- To compare two fields of an item (an answer and its correct answer), set a field when choosing, then count it: radio "{o}" bind=q.pick value={o} on="set:q.ok:{o == q.answer}" and later count(qs, 'ok')
- Format for people: money(2400) shows $2,400.00, number(37000) shows 37,000, plural(n, 'item') shows 1 item or 3 items, lower(), upper(), trim()
- Change an item through its fields: bind=t.done, on=toggle:t.done, on=inc:item.qty, on="set:t.text:'Done'"
- Change the list: on="add:todos:{text: 'Map', done: false}", on=remove:t (inside each), on=clear:todos
- Show only some items with if= on the repeated element: check "{t.text}" bind=t.done if={!t.done}
- For a list inside each item (an order's lines, a day's activities), put an each inside the each: each items=o.lines as=line
- Loom has no JSX, HTML or JavaScript. {…} only computes values; it never makes elements. Repeat with each.
- To let people add an item they name, bind an input to a state value, add it, then clear it: input "New item" bind=task on="add:todos:{text: task, done: false};set:task:''"
- To filter a list as people type, bind an input and show matching items: each items=trails as=t, then list-item "{t.name}" if={includes(lower(t.name), lower(query))}; count matches with len(search(trails, 'name', query))

A to-do list:
${indent(DATA_EXAMPLES.todo)}

A cart whose total follows the quantities:
${indent(DATA_EXAMPLES.cart)}

Orders, each with its own list of lines:
${indent(DATA_EXAMPLES.orders)}`;
}

export function languageGuide(registry: Registry, opts: GuideOptions = {}): string {
  const comps = registry.all();
  const has = (type: string) => registry.has(type);
  const examples = opts.examples ?? true;
  const sections: string[] = [];

  sections.push(`You write user interfaces in Loom, a line-based UI language. Output only Loom: no prose, no explanations and no code fences.`);

  sections.push(`FORMAT
- One element per line: type "optional text" name=value name="quoted value" name={expression}
- Indent children with 2 spaces under a container.
- Props go on their element's own line: list-item "{t.text}" if={!t.done}
- To show several lines only when something is true, put them under a line holding only if={…}:
  if={count(todos, 'done') == len(todos)}
    text "All done!" tone=good
- Declare state first, at the top, unindented: state count=0 done=false name="Ada"
- Every element and every state value fits on one line, even a long list: state trails=[{name: "Camelback", miles: 2.5}, {name: "Piestewa", miles: 2.1}]
- Lines starting with # are comments.`);

  sections.push(`EXPRESSIONS
- {…} reads state: {count}, {price*qty}, {done ? 'Yes' : 'No'}, {round(total, 2)}
- Text can mix words and expressions: "Total: \${price*qty}"
- Operators: + - * / % == != < <= > >= && || ! and a ? b : c
- Functions: ${EXPRESSION_FUNCTIONS.join(", ")}
- Words inside {…} are state names. Quote text: {done ? 'Packed' : 'To pack'}, tone={late ? 'bad' : 'good'}`);

  sections.push(`ACTIONS (on=…)
- ${ACTION_OPS.map((o) => ACTION_SYNTAX[o]).join("\n- ")}
- Run several with ; e.g. on="set:step:2;emit:next"
- Quote on= when it has spaces: on="inc:n;notify:'Saved {n}'"`);

  if (has("each")) sections.push(dataSection());

  if (opts.actions?.length) {
    sections.push(`APP ACTIONS
The app listens for these. Use them, with these names, for anything the app must do:
${appActions(opts.actions)}`);
  }

  sections.push(`EVERY ELEMENT ACCEPTS
${Object.entries(COMMON_PROPS).map(([n, d]) => propLine(n, d)).join("\n")}`);

  sections.push(`ELEMENTS AT A GLANCE
${index(comps)}`);

  sections.push(`ELEMENTS
${comps.map((c) => componentBlock(c, examples)).join("\n\n")}`);

  const rules = [
    "- Use only the elements and props above. Never invent colors, sizes or fonts; use style=, tone= and variant=. If asked for a specific color or size, use the closest role instead.",
    "- Start with a card unless the screen needs several.",
    "- Keep screens focused: one task per screen, short labels, real-looking values.",
  ];
  if (has("screen")) rules.push("- For several screens, write the starting screen first: it shows as soon as it arrives.");
  if (has("image")) rules.push(imageRules(opts.imageHosts ?? []));
  sections.push(`RULES\n${rules.join("\n")}`);

  if (opts.notes?.trim()) sections.push(`ABOUT THIS APP\n${opts.notes.trim()}`);

  // Kept last: tests and tools read everything after "EXAMPLE\n" as a spec.
  sections.push(`EXAMPLE
state guests=2 nights=3
card
  text "Cabin booking" style=title
  text "\${guests*nights*45} for {nights} nights" tone=muted
  row
    stat label="Guests" value={guests}
    stat label="Nights" value={nights}
  row
    button "Fewer nights" variant=secondary on=dec:nights
    button "More nights" variant=secondary on=inc:nights
  button "Book" on=emit:book
`);

  return sections.join("\n\n");
}
