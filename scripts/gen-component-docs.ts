/**
 * Regenerates the component reference in README.md from the component
 * definitions, between the COMPONENTS:START and COMPONENTS:END markers.
 *
 *   npm run docs:components           write README.md
 *   npm run docs:components -- --check  fail if README.md is out of date (for CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import type { ComponentDef } from "../src/component";

const README = resolve(__dirname, "../README.md");
const START = "<!-- COMPONENTS:START (generated from src/components) -->";
const END = "<!-- COMPONENTS:END -->";

const esc = (s: string) => s.replace(/\|/g, "\\|");

function section(c: ComponentDef): string {
  let out = `### \`${c.type}\`\n\n${c.description}\n\n`;
  const rows: string[] = [];
  if (c.text) rows.push(`| \`"text"\` | text${c.text.required ? ", required" : ""} | ${esc(c.text.description)} |`);
  for (const [name, d] of Object.entries(c.props)) {
    const type = d.type === "enum" && d.values ? d.values.map((v) => `\`${v}\``).join(" / ") : d.type;
    rows.push(`| \`${name}\` | ${type}${d.required ? ", required" : ""} | ${esc(d.description)} |`);
  }
  if (rows.length) out += `| Prop | Type | Description |\n|---|---|---|\n${rows.join("\n")}\n\n`;
  if (c.children) out += `Children: ${c.children === "any" ? "any elements" : c.children.map((x) => `\`${x}\``).join(", ")}.\n\n`;
  if (c.parents) out += `Only inside: ${c.parents.map((x) => `\`${x}\``).join(", ")}.\n\n`;
  if (c.example) out += "```\n" + c.example + "\n```\n\n";
  return out;
}

const generated = [...coreComponents, ...mapComponents].map(section).join("").trim();
const readme = readFileSync(README, "utf8");
const a = readme.indexOf(START), b = readme.indexOf(END);
if (a < 0 || b < 0) throw new Error("README.md is missing the COMPONENTS markers");
const next = readme.slice(0, a + START.length) + "\n" + generated + "\n" + readme.slice(b);

if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md component reference is out of date. Run: npm run docs:components");
    process.exit(1);
  }
  console.log("README.md component reference is up to date.");
} else {
  writeFileSync(README, next);
  console.log(`Wrote ${coreComponents.length + mapComponents.length} components to README.md`);
}
