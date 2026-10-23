// End-to-end check of the data tools: the built server with --data, a script
// playing the model (describe_data → query_data → show_interface), and the
// built view in Chromium fetching the dataset's rows through the MCP Apps
// host bridge, the way a chat app runs it. Then it presses an emit: button and
// checks the rows in the interface match the database exactly.
//
//   npm run build && node scripts/e2e-data.mjs [database.db]
// With no database it makes a small one. Screenshots go to e2e-output/.
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../e2e-output/");
mkdirSync(out, { recursive: true });
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// The database: the one given, or a small music store.
let dbPath = process.argv[2];
let SQL = "SELECT BillingCountry AS country, ROUND(SUM(Total), 2) AS revenue, COUNT(*) AS invoices FROM Invoice GROUP BY BillingCountry ORDER BY revenue DESC LIMIT 8";
if (!dbPath) {
  dbPath = out + "store.db";
  rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE Invoice (InvoiceId INTEGER PRIMARY KEY, BillingCountry TEXT, Total REAL)");
  const ins = db.prepare("INSERT INTO Invoice (BillingCountry, Total) VALUES (?, ?)");
  const countries = ["USA", "Canada", "France", "Brazil", "Germany", "United Kingdom", "Portugal", "India", "Chile", "Ireland"];
  for (let i = 0; i < 400; i++) ins.run(countries[i % countries.length], Math.round((0.99 + (i % 13) * 1.37) * 100) / 100);
  db.close();
}
if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
const truth = new DatabaseSync(dbPath, { readOnly: true }).prepare(SQL).all().map((r) => ({ ...r }));

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };
const textOf = (r) => r.content?.[0]?.text ?? "";

// The "model": an MCP client talking to the built server over stdio.
const client = new Client({ name: "e2e-model", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [here("../dist/server.js"), "--data", dbPath], stderr: "ignore" }));
const described = textOf(await client.callTool({ name: "describe_data", arguments: {} }));
check(/Invoice/.test(described), "describe_data lists the tables");
const queried = textOf(await client.callTool({ name: "query_data", arguments: { sql: SQL } }));
const id = /Dataset (d\d+)/.exec(queried)?.[1];
check(!!id && !queried.includes(JSON.stringify(truth[truth.length - 1])), `query_data returns a dataset (${id}) with a sample, not every row`);
const SPEC = `card
  text "Revenue by country" style=title
  text "Top 8 countries by invoice total" tone=muted
  chart "Revenue" kind=bar items=sales x=country y=revenue format=money
  table "Countries" items=sales key=country
    table-column "Country" field=country
    table-column "Invoices" field=invoices align=right
    table-column "Revenue" field=revenue format=money align=right
  button "Send these numbers back" on=emit:check
`;
const args = { spec: SPEC, data: { sales: id } };
const shown = await client.callTool({ name: "show_interface", arguments: args });
check(!shown.isError && /no problems/.test(textOf(shown)), `show_interface accepts the spec and dataset: ${textOf(shown).split("\n")[0]}`);

// The chat app: the built view in a sandboxed iframe, with fetch_dataset forwarded to the real server.
await build({
  logLevel: "warn",
  configFile: false,
  build: { outDir: out + "host", emptyOutDir: true, lib: { entry: here("../test/host/host.ts"), name: "TestHost", formats: ["iife"], fileName: () => "host.js" } },
});
const hostJs = readFileSync(out + "host/host.js", "utf8");
const uiHtml = readFileSync(here("../dist/ui.html"), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 1100 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Rows are held back until released, to look at the interface while they load.
  let release;
  const held = new Promise((r) => { release = r; });
  await page.exposeFunction("callServer", async (name, a) => { await held; return client.callTool({ name, arguments: a }); });
  await page.setContent(`<!doctype html><body style="margin:20px;background:#fff"><script>${hostJs}</script></body>`);
  await page.evaluate((html) => window.TestHost.mount(html, "light", undefined, true), uiHtml);
  await page.evaluate(() => window.host.ready);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const ink = () => frame.evaluate(() => {
    const c = document.querySelector("canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
    return { h: c.height, n };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "6a-before-input.png" });
  const intro = await ink();
  check(intro.h > 100 && intro.n > 20, `before any input, the view shows a placeholder card (${intro.n} sampled pixels)`);
  await page.evaluate((a) => window.host.bridge.sendToolInput({ arguments: a }), args);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + "6b-loading.png" });
  const loading = await ink();
  check(loading.h > intro.h, `while the rows load, the interface is laid out at full size with placeholders (${loading.h}px tall)`);
  release();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + "6-data.png" });
  const calls = await page.evaluate(() => window.host.calls);
  check(calls.some((c) => c.name === "fetch_dataset" && c.arguments.id === id), "the interface fetched the dataset itself");

  await frame.locator("canvas").focus();
  let sent = [];
  for (let i = 0; i < 30 && !sent.length; i++) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
    sent = await page.evaluate(() => window.host.messages.filter((m) => m.includes('"check"')));
  }
  const state = sent[0] ? JSON.parse(sent[0].split("Current values in the interface: ")[1]) : {};
  check(JSON.stringify(state.sales) === JSON.stringify(truth), `the rows in the interface match the database exactly (${truth.length} rows)`);
  check(errors.length === 0, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
  await client.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll data checks passed. Screenshot: ${out}6-data.png`);
