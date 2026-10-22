// Writes dist/ui.html: the view's HTML with its script and fonts inlined.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const html = readFileSync(here("../src/ui/index.html"), "utf8");
const script = readFileSync(here("../dist/ui-build/view.js"), "utf8");

const face = (weight) => {
  const file = here(`../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-${weight}-normal.woff2`);
  const data = readFileSync(file).toString("base64");
  return `@font-face{font-family:"Instrument Sans";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
};

// "</script" can't appear inside an inline script; escape it the standard way.
const safe = script.replace(/<\/script/gi, "<\\/script");
const out = html
  .replace("/*FONTS*/", [400, 600, 700].map(face).join("\n"))
  .replace(/<script type="module" src="\.\/main\.ts"><\/script>/, () => `<script>${safe}</script>`);
if (out.includes("main.ts")) throw new Error("inline-ui: the script tag wasn't replaced");
writeFileSync(here("../dist/ui.html"), out);
rmSync(here("../dist/ui-build"), { recursive: true, force: true });
console.log(`dist/ui.html: ${(out.length / 1024).toFixed(0)} KB`);
