import { Loom, coreComponents, languageGuide, type Diagnostic, type LoomNode } from "../src";
import { mapComponents } from "../src/components/map";
import { samples } from "./samples";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ta = $<HTMLTextAreaElement>("spec");
const gutter = $("gutter");
const canvas = $<HTMLCanvasElement>("cv");

const loom = new Loom(canvas, { components: [...coreComponents, ...mapComponents] }).expose("loom");
$("guide").textContent = languageGuide(loom.registry);

let current = "map";
let streamId = 0;
let selectedLine = 0;
let diagnostics: Diagnostic[] = [];

// ------------------------------------------------------------ samples + streaming

const nav = $("samples");
for (const [key, s] of Object.entries(samples)) {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = s.label;
  b.dataset.key = key;
  b.addEventListener("click", () => stream(key));
  nav.appendChild(b);
}
$("stream").addEventListener("click", () => stream(current));

function setStatus(live: boolean, text: string) {
  $("status").classList.toggle("live", live);
  $("statusText").textContent = text;
}

/** Simulates a model streaming tokens. A real model would call loom.push() the same way. */
function stream(key: string) {
  const sample = samples[key]!;
  current = key;
  const id = ++streamId;
  nav.querySelectorAll<HTMLButtonElement>(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.key === key)));
  $("promptText").textContent = sample.prompt;
  $("events").innerHTML = "";
  selectedLine = 0;
  loom.inspector.selected = null;
  loom.beginStream();
  ta.value = "";
  ta.readOnly = true;
  setStatus(true, "Streaming");
  let i = 0;
  const full = sample.spec;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tick = () => {
    if (id !== streamId) return;
    const n = reduce ? full.length : Math.min(full.length, i + 2 + Math.floor(Math.random() * 5));
    const chunk = full.slice(i, n);
    i = n;
    loom.push(chunk);
    ta.value = full.slice(0, i);
    ta.scrollTop = ta.scrollHeight;
    renderGutter();
    if (i < full.length) setTimeout(tick, 22);
    else {
      loom.endStream();
      ta.readOnly = false;
      setStatus(false, "Done. Edit freely");
    }
  };
  tick();
}

// ------------------------------------------------------------ editor

ta.addEventListener("input", () => {
  if (ta.readOnly) return;
  loom.setSpec(ta.value);
  renderGutter();
});
ta.addEventListener("scroll", () => { gutter.scrollTop = ta.scrollTop; });
const syncCursorLine = () => {
  if (ta.readOnly) return;
  const line = ta.value.slice(0, ta.selectionStart).split("\n").length;
  if (line !== selectedLine) {
    selectedLine = line;
    loom.inspector.selectLine(line);
    renderGutter();
  }
};
ta.addEventListener("click", syncCursorLine);
ta.addEventListener("keyup", syncCursorLine);
ta.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = ta.selectionStart;
    ta.setRangeText("  ", s, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input"));
  }
});

function renderGutter() {
  const count = Math.max(1, ta.value.split("\n").length);
  const byLine = new Map<number, string>();
  for (const d of diagnostics) if (byLine.get(d.line) !== "err") byLine.set(d.line, d.severity === "error" ? "err" : "warn");
  let html = "";
  for (let i = 1; i <= count; i++) {
    const cls = [byLine.get(i) ?? "", i === selectedLine ? "sel" : ""].join(" ").trim();
    html += `<div${cls ? ` class="${cls}"` : ""}>${i}</div>`;
  }
  gutter.innerHTML = html;
  gutter.scrollTop = ta.scrollTop;
}

function goToLine(line: number) {
  const lines = ta.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  ta.focus();
  ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (line - 4) * lineHeight);
  selectedLine = line;
  renderGutter();
}

// ------------------------------------------------------------ debug tools

$<HTMLInputElement>("tBoxes").addEventListener("change", (e) => loom.inspector.setBoxes((e.target as HTMLInputElement).checked));
$<HTMLInputElement>("tHits").addEventListener("change", (e) => loom.inspector.setHits((e.target as HTMLInputElement).checked));
$<HTMLInputElement>("tInspect").addEventListener("change", (e) => loom.inspector.setInspecting((e.target as HTMLInputElement).checked));

const inspectOut = $("inspect");
function showNode(node: LoomNode | null) {
  inspectOut.textContent = node ? JSON.stringify(loom.inspector.describe(node), null, 2) : "Nothing selected.";
}
loom.on("inspect", (sel) => {
  showNode(sel?.node ?? null);
  if (sel && loom.inspector.inspecting) goToLine(sel.node.line);
});

$("capture").addEventListener("click", async () => {
  const calls = await loom.inspector.captureFrame();
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.op, (counts.get(c.op) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  inspectOut.textContent =
    `One frame: ${calls.length} canvas calls\n\n` +
    top.map(([op, n]) => `${String(n).padStart(5)}  ${op}`).join("\n") +
    `\n\nFirst calls:\n` +
    calls.slice(0, 14).map((c) => `${c.op}(${c.args.map((a) => JSON.stringify(a)).join(", ")})`).join("\n") +
    `\n\nFull list: await loom.inspector.captureFrame() in the console.`;
});

// ------------------------------------------------------------ panels

loom.on("diagnostics", (d) => {
  diagnostics = d;
  $("diagCount").textContent = String(d.length);
  const list = $("diags");
  list.innerHTML = "";
  if (!d.length) { list.innerHTML = `<li class="empty">No problems.</li>`; }
  for (const item of d) {
    const li = document.createElement("li");
    li.className = item.severity;
    const b = document.createElement("button");
    b.innerHTML = `<span class="ln">L${item.line}</span><span class="msg"></span>`;
    b.querySelector(".msg")!.textContent = item.message;
    b.addEventListener("click", () => goToLine(item.line));
    li.appendChild(b);
    list.appendChild(li);
  }
  renderGutter();
});

const stateBody = $("state").querySelector("tbody")!;
let flashKey = "";
function renderState() {
  const snap = loom.state.snapshot();
  stateBody.innerHTML = "";
  for (const [k, v] of Object.entries(snap)) {
    const tr = document.createElement("tr");
    if (k === flashKey) tr.className = "flash";
    tr.innerHTML = `<td></td><td></td>`;
    tr.children[0]!.textContent = k;
    tr.children[1]!.textContent = JSON.stringify(v);
    stateBody.appendChild(tr);
  }
}
loom.on("change", ({ key }) => { flashKey = key; queueMicrotask(renderState); });
loom.on("action", ({ name, value }) => {
  const li = document.createElement("li");
  li.textContent = `emit ${name}${value === undefined ? "" : " → " + JSON.stringify(value)}`;
  $("events").prepend(li);
});

loom.on("render", (m) => {
  $("mNodes").textContent = String(m.nodes);
  $("mParse").textContent = m.parseMs.toFixed(2) + " ms";
  $("mLayout").textContent = m.layoutMs.toFixed(2) + " ms";
  $("mPaint").textContent = m.paintMs.toFixed(2) + " ms";
  $("mPix").textContent = `${m.pixelWidth} × ${m.pixelHeight}`;
  renderState();
});

const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
fontsReady.then(() => stream("map"));
