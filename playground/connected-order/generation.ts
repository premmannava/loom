import { parse, parseActions, type GuideOptions, type SayShapeNode, type Registry } from "../../src/index";
import { orderBody, orderPrelude } from "./spec";

export const hostNames = ["equipment", "orders", "events", "department", "departments", "selected", "quantity", "delivery", "earliest", "latest", "sortField", "sortDirection", "activityOpen", "loading", "submitting", "simulateFailure", "message", "visible", "item", "subtotal", "total"];
const writable = new Set(["department", "selected", "quantity", "delivery", "sortField", "sortDirection", "activityOpen", "simulateFailure"]);
const events = new Set(["submit_order", "refresh_catalog", "playground"]);

export const connectedGuide: GuideOptions = {
  mode: "compact",
  profile: ["column", "row", "card", "text", "stat", "table", "select", "stepper", "date-picker", "button", "check", "divider"],
  workedExamples: false,
  actions: [
    { name: "submit_order", description: "Submit the selected equipment, quantity and delivery date. The host validates and updates message, orders and stock." },
    { name: "refresh_catalog", description: "Reload catalog from the host service." },
  ],
  notes: `This app already provides ALL state and derived values. Output only UI element lines, NO state or derive declarations. Do not invent products, prices, totals, dates, events, or names.
Read-only equipment is a list of {id,name,team,price,stock}. departments is [All,Engineering,Design,Sales]. visible is the department-filtered equipment. orders contains {id,name,quantity,deliveryDate,total}.
Writable bindings: department (filter), selected (equipment id), quantity (integer 1..10), delivery (YYYY-MM-DD), sortField (field name), sortDirection (asc/desc), simulateFailure (boolean).
Read-only item is the selected record or null. subtotal and total are computed by the host prelude; total includes 8% tax. earliest/latest are allowed delivery dates. loading/submitting are booleans; message is the real service response.
Required: select items=departments bind=department; table items=visible key=id bind=selected sort=sortField direction=sortDirection with name, price, stock columns; stepper bind=quantity min=1 max=10; date-picker bind=delivery min={earliest} max={latest}; stat value={money(total)}; text "{message}"; button on=emit:submit_order disabled={loading || submitting || !item || delivery == ''}.
Include a check bound to simulateFailure and an orders table if space permits. Props typed path use bare names, not braces or quoted values. Do not use actions to fake service results. Only emit events; the host does the work.
Adapt the layout and labels to the request while preserving these bindings. Here is a valid UI body (the host supplies its state):
${orderBody.replace(/  accordion[\s\S]*$/, "").replace('  link "Back to the playground" on=emit:playground\n', "")}`,
};

/** Reject disconnected output before it replaces the last usable interface. */
export function validateConnectedBody(body: string, registry: Registry): string[] {
  const parsed = parse(body, registry, { knownNames: hostNames });
  const problems = parsed.diagnostics.map((d) => `Line ${d.line}: ${d.message}`);
  if (parsed.state.length || parsed.derived.length) problems.push("Output UI only. The host owns all state and derived declarations.");
  const nodes: SayShapeNode[] = [];
  const visit = (node: SayShapeNode) => { nodes.push(node); node.children.forEach(visit); };
  visit(parsed.root);
  for (const node of nodes) {
    const def = registry.get(node.type);
    for (const [prop, value] of Object.entries(node.props)) {
      if (def?.props[prop]?.type === "state" && !writable.has(value)) problems.push(`Line ${node.line}: ${prop} must bind to an allowed host field.`);
    }
    if (node.props.on) {
      const result = parseActions(node.props.on);
      if ("actions" in result && result.actions.some((a) => a.op !== "emit" || !events.has(a.name))) problems.push(`Line ${node.line}: use only the host's emit events.`);
    }
    if (node.type === "table" && !["visible", "equipment", "orders"].includes(node.props.items ?? "")) problems.push("Tables must use visible, equipment or orders from the host.");
    if (node.type === "select" && (node.props.items !== "departments" || node.props.bind !== "department")) problems.push("The department select must use items=departments bind=department.");
  }
  for (const [type, bind] of [["table", "selected"], ["select", "department"], ["stepper", "quantity"], ["date-picker", "delivery"]]) {
    if (!nodes.some((n) => n.type === type && n.props.bind === bind)) problems.push(`Include ${type} with bind=${bind}.`);
  }
  if (!nodes.some((n) => n.type === "button" && n.props.on === "emit:submit_order" && n.props.disabled?.includes("submitting"))) problems.push("Include a submit button on=emit:submit_order disabled while submitting.");
  if (!nodes.some((n) => n.type === "text" && n.text?.includes("{message}"))) problems.push('Show the host response with text "{message}".');
  return [...new Set(problems)];
}

export const connectedSpec = (body: string) => `${orderPrelude}\n${body}\n`;
