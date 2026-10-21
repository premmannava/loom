/**
 * Scaffolds a component:
 *
 *   npm run new:component -- badge
 *   npm run new:component -- badge --category feedback
 *
 * Creates src/components/<name>.ts and test/components/<name>.test.ts, and
 * registers the component in src/components/index.ts. From then on the
 * contract tests run on it, and they fail until every TODO is filled in, so
 * `npm test` doubles as the checklist. Then follow "How to add a component"
 * in CLAUDE.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { CATEGORIES, type Category } from "../src/component";

const root = resolve(__dirname, "..");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const catIndex = args.indexOf("--category");
const category = (catIndex >= 0 ? args[catIndex + 1] : "content") as Category;

if (!name) fail("Give the component a name: npm run new:component -- badge");
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) fail(`"${name}" isn't a valid component name. Use lowercase letters, digits and dashes, like "list-item".`);
if (!CATEGORIES.includes(category)) fail(`Category should be one of ${CATEGORIES.join(", ")}; got "${category}".`);
if (coreComponents.some((c) => c.type === name) || name === "map" || name === "pin") fail(`A component called "${name}" already exists.`);

const ident = name.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const file = resolve(root, `src/components/${name}.ts`);
const testFile = resolve(root, `test/components/${name}.test.ts`);
for (const f of [file, testFile]) if (existsSync(f)) fail(`${f} already exists.`);

const component = `import type { ComponentDef } from "../component";

export const ${ident}: ComponentDef = {
  type: "${name}",
  category: "${category}",
  // One or two plain sentences on when a model should use this.
  description: "TODO: say what ${name} is for.",
  // Remove if the component takes no quoted text.
  text: { description: "TODO: what the quoted text is.", required: true },
  props: {
    // Every prop needs a type, a description and a default (or required: true).
    // Colors, fonts and sizes are never props: offer roles like tone= instead.
  },
  example: \`TODO\`,
  layout(box, ctx) {
    // Set box.h. Measure text with ctx.measure; read sizes from ctx.theme.
    box.h = ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    g.font = ctx.font(400, theme.text.body);
    g.fillStyle = theme.colors.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(p.text(), box.x, box.y + box.h / 2, box.w);
    // Interactive components: ctx.addHit(box), and define press() if pressing
    // does more than run the on= prop.
  },
};
`;

const test = `import { describe, expect, it } from "vitest";
import { render } from "../../src/testing";

// The contract tests (test/contract.test.ts) already check the definition,
// layout bounds at three widths, theme-only colors and keyboard reach.
// Test what's specific to ${name} here.

describe("${name}", () => {
  it("renders its example without diagnostics", () => {
    const ui = render(\`TODO\\n\`);
    expect(ui.diagnostics).toEqual([]);
  });

  it.todo("warns about bad prop values but keeps the element");
  it.todo("lays out at narrow and wide widths");
  it.todo("updates state when pressed (if interactive)");
});
`;

mkdirSync(resolve(root, "test/components"), { recursive: true });
writeFileSync(file, component);
writeFileSync(testFile, test);

const indexPath = resolve(root, "src/components/index.ts");
let index = readFileSync(indexPath, "utf8");
const exportsRe = /export \{([^}]*)\};/;
const listRe = /(export const coreComponents: ComponentDef\[\] = \[)([^\]]*)\];/;
if (!exportsRe.test(index) || !listRe.test(index)) fail("Couldn't find the exports and coreComponents list in src/components/index.ts; register the component by hand.");
const lastImport = index.lastIndexOf("\nimport ");
const lineEnd = index.indexOf("\n", lastImport + 1);
index = index.slice(0, lineEnd + 1) + `import { ${ident} } from "./${name}";\n` + index.slice(lineEnd + 1);
// Append to both lists, whether they're written on one line or several.
const append = (names: string) => (names.includes("\n") ? `${names.replace(/,?\s*$/, "")},\n  ${ident},\n` : ` ${names.trim().replace(/,$/, "")}, ${ident} `);
index = index.replace(exportsRe, (_m, names: string) => `export {${append(names)}};`);
index = index.replace(listRe, (_m, head: string, names: string) => `${head}${append(names).replace(/^ | $/g, "")}];`);
writeFileSync(indexPath, index);

console.log(`Created src/components/${name}.ts and test/components/${name}.test.ts, and registered "${name}".

Next:
  1. Fill in every TODO. \`npm test\` fails until you do: the contract tests list what's missing.
  2. Implement layout and paint with theme tokens only (CLAUDE.md, "How to add a component").
  3. Write the tests in test/components/${name}.test.ts.
  4. Run npm run docs:components, then add visual baselines (npm run test:visual:docker).`);
