/**
 * Renders a component's reference section from its ComponentDef. Shared by
 * the README generator (gen-component-docs.ts) and the website generator
 * (gen-site-docs.ts), so both are written from the same definitions.
 */
import type { ComponentDef } from "../src/component";

const esc = (s: string) => s.replace(/\|/g, "\\|");

export interface SectionOptions {
  /** The info string for the example's code fence: "" in the README, "loom live" on the website. */
  fence?: string;
  /** Turns a component name into a link, or leaves it as code. */
  link?: (type: string) => string;
  /** The example as shown; defaults to the definition's own (the website wraps child-only ones in their parent). */
  example?: (c: ComponentDef) => string | undefined;
}

export function componentSection(c: ComponentDef, opts: SectionOptions = {}): string {
  const fence = opts.fence ?? "";
  const ref = opts.link ?? ((x: string) => `\`${x}\``);
  let out = `### \`${c.type}\`\n\n${c.description}\n\n`;
  const rows: string[] = [];
  if (c.text) rows.push(`| \`"text"\` | text${c.text.required ? ", required" : ""} | ${esc(c.text.description)} |`);
  for (const [name, d] of Object.entries(c.props)) {
    const type = d.type === "enum" && d.values ? d.values.map((v) => `\`${v}\``).join(" / ") : d.type;
    rows.push(`| \`${name}\` | ${type}${d.required ? ", required" : ""} | ${esc(d.description)} |`);
  }
  if (rows.length) out += `| Prop | Type | Description |\n|---|---|---|\n${rows.join("\n")}\n\n`;
  if (c.children) out += `Children: ${c.children === "any" ? "any elements" : c.children.map(ref).join(", ")}.\n\n`;
  if (c.parents) out += `Only inside: ${c.parents.map(ref).join(", ")}.\n\n`;
  const example = opts.example ? opts.example(c) : c.example;
  if (example) out += "```" + fence + "\n" + example + "\n```\n\n";
  return out;
}
