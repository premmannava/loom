/**
 * Checks the built website (site/.vitepress/dist) the way GitHub Pages will
 * serve it, under /loom/.
 *
 *   npm run site:check              static checks
 *   npm run site:check -- --browser also open every page in Chromium (needs `npx playwright install chromium`)
 *
 * Static checks:
 * - every internal link, script, stylesheet, image and icon resolves to a built
 *   file, and every #fragment on an internal page link exists on that page;
 * - nothing points at the server root instead of /loom/;
 * - no secrets: values from .env.local (if present) and key-shaped strings;
 * - the playground and theme code (not documentation text) never reference a
 *   local model server or the development proxy.
 *
 * Browser checks: every page loads without console errors, makes no request
 * outside the site (in particular none to localhost), and its SayShape canvases draw.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const DIST = join(ROOT, "site/.vitepress/dist");
const BASE = process.env.SITE_BASE ?? "/loom/";
const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No build found. Run: npm run site:build");
  process.exit(1);
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const all = files(DIST);
const html = all.filter((f) => f.endsWith(".html"));

/** The built file a site path refers to, or null. */
function fileFor(path) {
  if (!path.startsWith(BASE)) return null;
  let rel = decodeURIComponent(path.slice(BASE.length));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const p = join(DIST, rel);
  if (existsSync(p) && statSync(p).isFile()) return p;
  if (!extname(rel) && existsSync(p + ".html")) return p + ".html";
  return null;
}

const idsCache = new Map();
function idsOf(file) {
  if (!idsCache.has(file)) {
    const text = readFileSync(file, "utf8");
    idsCache.set(file, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
}

// ---------------------------------------------------------------- links and assets
let checked = 0;
for (const page of html) {
  const text = readFileSync(page, "utf8");
  const pagePath = BASE + relative(DIST, page).replace(/\\/g, "/");
  for (const m of text.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = m[1].replace(/&amp;/g, "&");
    if (/^(https?:|mailto:|data:|javascript:|#$)/.test(raw)) continue;
    checked++;
    const url = new URL(raw, "http://site" + pagePath);
    if (!url.pathname.startsWith(BASE)) { fail(`${pagePath}: "${raw}" points outside ${BASE}`); continue; }
    const target = fileFor(url.pathname);
    if (!target) { fail(`${pagePath}: "${raw}" doesn't resolve to a built file`); continue; }
    const frag = decodeURIComponent(url.hash.slice(1));
    // Fragments the playground reads itself (#spec=…) aren't element ids.
    if (frag && target.endsWith(".html") && !frag.startsWith("spec=") && !idsOf(target).has(frag)) {
      fail(`${pagePath}: "${raw}" links to #${frag}, which isn't on that page`);
    }
  }
}

// ---------------------------------------------------------------- secrets and local servers
const textFiles = all.filter((f) => /\.(html|js|css|json|xml|txt|svg)$/.test(f));
const secrets = [];
const envLocal = join(ROOT, ".env.local");
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line);
    // Short or URL-only values (a model name, http://localhost:1234/v1) aren't secret, but the key is.
    if (m && m[2] && (m[1].includes("KEY") || m[1].includes("TOKEN") || m[1].includes("SECRET"))) secrets.push(m[2]);
  }
}
const KEY_SHAPES = [/\bsk-[A-Za-z0-9_-]{20,}/, /\bBearer\s+[A-Za-z0-9._-]{20,}/, /\bghp_[A-Za-z0-9]{30,}/, /\bAKIA[0-9A-Z]{16}\b/];
for (const f of textFiles) {
  const text = readFileSync(f, "utf8");
  const rel = relative(DIST, f);
  for (const s of secrets) if (text.includes(s)) fail(`${rel} contains a value from .env.local`);
  for (const re of KEY_SHAPES) if (re.test(text)) fail(`${rel} contains something shaped like a credential (${re})`);
  // Page chunks (*.md.*.js) and HTML hold documentation, which mentions local servers on purpose.
  // So does the search index. (The engine itself mentions "http://localhost" only as an image-policy fallback for non-web pages.)
  const isCode = f.endsWith(".js") && !/\.md\.[\w-]+(\.lean)?\.js$/.test(f) && !f.includes("@localSearchIndex");
  if (isCode && /localhost:\d|127\.0\.0\.1|\/api\/model/.test(text)) fail(`${rel} references a local server or the development model proxy`);
}

console.log(`Checked ${html.length} pages, ${checked} internal references and ${textFiles.length} files.`);

// ---------------------------------------------------------------- browser
if (process.argv.includes("--browser")) await browserCheck();

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n` + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log("No problems found.");

async function browserCheck() {
  const { chromium } = await import("playwright");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".xml": "application/xml" };
  // A static server like GitHub Pages: files under /loom/, index.html for folders, 404.html otherwise.
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const file = fileFor(path);
    if (!file) { res.writeHead(404, { "content-type": "text/html" }); res.end(readFileSync(join(DIST, "404.html"))); return; }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const pages = html.filter((f) => !f.endsWith("404.html")).map((f) => BASE + relative(DIST, f).replace(/\\/g, "/"));
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    for (const path of pages) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const u = r.url();
        if (!u.startsWith(origin + BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) errors.push(`request outside the site: ${u}`);
      });
      const res = await page.goto(origin + path, { waitUntil: "networkidle" });
      if (!res || res.status() !== 200) errors.push(`status ${res?.status()}`);
      // Bring lazily created demos into view so each one starts.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
      });
      await page.waitForTimeout(400);
      const blank = await page.evaluate(() =>
        [...document.querySelectorAll(".loom-canvas-wrap canvas")].filter((c) => {
          if (c.offsetParent === null) return false; // hidden on purpose (a closed tab)
          return c.width === 0 || c.height === 0;
        }).length,
      );
      if (blank) errors.push(`${blank} visible SayShape canvas(es) never drew`);
      for (const e of errors) fail(`${path} (${scheme}): ${e}`);
      await page.close();
    }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(`Opened ${pages.length} pages in Chromium, light and dark.`);
}
