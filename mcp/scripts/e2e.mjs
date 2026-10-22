// End-to-end check of the built view in a real browser, inside a sandboxed
// iframe driven by the MCP Apps host bridge, the way Claude or ChatGPT run it:
// handshake, streamed tool input, the final spec, theme changes, resizing, and
// an emit: action arriving back as a message.
//
//   npm run build && npm run test:e2e        screenshots go to e2e-output/
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "@playwright/test";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../e2e-output/");
mkdirSync(out, { recursive: true });

const uiHtml = readFileSync(here("../dist/ui.html"), "utf8");
if (/\b(src|href)=["']https?:/i.test(uiHtml)) throw new Error("ui.html loads something from another origin");

await build({
  logLevel: "warn",
  configFile: false,
  build: {
    outDir: out + "host",
    emptyOutDir: true,
    lib: { entry: here("../test/host/host.ts"), name: "TestHost", formats: ["iife"], fileName: () => "host.js" },
  },
});
const hostJs = readFileSync(out + "host/host.js", "utf8");

const SPEC = `state hikers=3 days=2
state gear=[{id: 1, item: "Tent", kg: 2.4}, {id: 2, item: "Stove", kg: 0.6}, {id: 3, item: "Water filter", kg: 0.3}]
derive water={hikers * days * 3}
card
  text "Weekend hike planner" style=title
  text "Numbers update as you change the trip." tone=muted
  row
    stepper "Hikers" bind=hikers min=1 max=12
    stepper "Days" bind=days min=1 max=7
  grid min=140 gap=10
    stat label="Water to carry" value="{water} L" tone=accent
    stat label="Gear items" value={len(gear)}
  chart "Gear weight (kg)" kind=bar items=gear x=item y=kg
  button "Plan this trip" on=emit:plan_trip:{hikers}
`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.setContent(`<!doctype html><body style="margin:20px;font-family:sans-serif;background:#fff"><script>${hostJs}</script></body>`);
  await page.evaluate((html) => window.TestHost.mount(html, "light"), uiHtml);
  await page.evaluate(() => window.host.ready);
  check(true, "the view completed the MCP Apps handshake");

  // Stream the tool input a few lines at a time, the way a client forwards a model's tool call.
  const lines = SPEC.split("\n");
  for (let n = 1; n <= lines.length; n++) {
    const partial = lines.slice(0, n).join("\n") + (n < lines.length ? "\n" : "");
    await page.evaluate((spec) => window.host.bridge.sendToolInputPartial({ arguments: { spec } }), partial);
    await page.waitForTimeout(40);
    if (n === 8) await page.screenshot({ path: out + "1-streaming.png" });
  }
  await page.evaluate((spec) => window.host.bridge.sendToolInput({ arguments: { spec } }), SPEC);
  await page.evaluate(() => window.host.bridge.sendToolResult({ content: [{ type: "text", text: "The interface is showing in the conversation, with no problems." }] }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + "2-final-light.png" });

  const sizes = await page.evaluate(() => window.host.sizes);
  check(sizes.length > 0 && Math.max(...sizes) > 300, `the view reported its height to the host (${Math.max(0, ...sizes)}px)`);

  const frame = page.frames().find((f) => f !== page.mainFrame());
  const painted = await frame.evaluate(() => {
    const c = document.querySelector("canvas");
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) ink++;
    return { w: c.width, h: c.height, ink };
  });
  check(painted.h > 300 && painted.ink > 50, `the engine painted the canvas (${painted.w}×${painted.h}, ${painted.ink} sampled pixels)`);

  // Press the emit button with the keyboard: focus the canvas, Tab through the controls, Enter.
  await frame.locator("canvas").focus();
  let sent = [];
  for (let i = 0; i < 12 && !sent.length; i++) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    sent = await page.evaluate(() => window.host.messages.filter((m) => m.includes("plan_trip")));
  }
  check(sent.length === 1, "pressing the emit: button sent one message to the conversation");
  check(/I pressed "plan_trip" with the value \d+/.test(sent[0] ?? ""), "the message names the action and its value");
  check(/"hikers":\d+/.test(sent[0] ?? "") && /"gear":\[/.test(sent[0] ?? ""), "the message carries the interface's state");
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "3-after-emit.png" });

  await page.evaluate(() => { document.body.style.background = "#1f1f1e"; window.host.bridge.setHostContext({ theme: "dark" }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + "4-dark.png" });
  check(await frame.evaluate(() => document.documentElement.dataset.theme === "dark"), "the view follows the host's dark theme");

  check(errors.length === 0, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
  writeFileSync(out + "messages.json", JSON.stringify(await page.evaluate(() => window.host.messages), null, 2));
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed. Screenshots in ${out}`);
