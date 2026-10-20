/**
 * Generates the language guide a model needs to write Loom specs, straight
 * from the component registry. Because it's generated, the model's view of
 * the language can never drift from what the engine actually supports.
 */
import { ACTION_OPS } from "./actions";
import { COMMON_PROPS, type ComponentDef, type PropDef } from "./component";
import { EXPRESSION_FUNCTIONS } from "./expr";
import type { Registry } from "./registry";

function propLine(name: string, d: PropDef): string {
  const type = d.type === "enum" && d.values ? d.values.join("|") : d.type;
  const req = d.required ? ", required" : "";
  return `    ${name}=<${type}${req}>  ${d.description}`;
}

function componentBlock(c: ComponentDef): string {
  const head = c.text ? `${c.type} "<text>"` : c.type;
  const lines = [`  ${head}  — ${c.description}`];
  if (c.text) lines.push(`    "<text>"${c.text.required ? " (required)" : ""}  ${c.text.description}`);
  for (const [n, d] of Object.entries(c.props)) lines.push(propLine(n, d));
  if (c.children) lines.push(`    children: ${c.children === "any" ? "any elements" : c.children.join(", ")}`);
  if (c.parents) lines.push(`    only inside: ${c.parents.join(", ")}`);
  return lines.join("\n");
}

export function languageGuide(registry: Registry): string {
  const comps = registry.all();
  return `You write user interfaces in Loom, a line-based UI language. Output only Loom, no prose and no code fences.

FORMAT
- One element per line: type "optional text" name=value name="quoted value" name={expression}
- Indent children with 2 spaces under a container.
- Declare state first, at the top, unindented: state count=0 done=false name="Ada"
- Lines starting with # are comments.

EXPRESSIONS
- {…} reads state: {count}, {price*qty}, {done ? "Yes" : "No"}, {round(total, 2)}
- Text can mix words and expressions: "Total: \${price*qty}"
- Operators: + - * / % == != < <= > >= && || ! and a ? b : c
- Functions: ${EXPRESSION_FUNCTIONS.join(", ")}

ACTIONS (on=…)
- ${ACTION_OPS.map((o) => ({ inc: "inc:key[:by]", dec: "dec:key[:by] (never below 0)", toggle: "toggle:key", set: "set:key:value or set:key:{expr}", emit: "emit:name[:value] tells the app what the user chose" }[o])).join("\n- ")}
- Run several with ; e.g. on="set:step:2;emit:next"

EVERY ELEMENT ACCEPTS
${Object.entries(COMMON_PROPS).map(([n, d]) => propLine(n, d)).join("\n")}

ELEMENTS
${comps.map(componentBlock).join("\n\n")}

RULES
- Use only the elements and props above. Never invent colors, sizes or fonts; use style=, tone= and variant=.
- Start with a card unless the screen needs several.
- Keep screens focused: one task per screen, short labels, real values.

EXAMPLE
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
`;
}
