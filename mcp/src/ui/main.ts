/**
 * The view an MCP Apps client shows for show_interface: the SayShape engine
 * drawing the model's spec on a canvas, inside the client's sandboxed iframe.
 *
 * - While the model is still writing the tool call, clients that stream tool
 *   input send growing copies of the spec, and the engine draws each finished
 *   line as it arrives.
 * - When the call is complete, the full spec replaces whatever streamed.
 * - An emit: action is the only thing that leaves the interface: it becomes a
 *   message in the conversation, with the action, its value and the
 *   interface's state, so the model can answer it.
 */
import "./no-eval";
import { App, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { SayShape } from "../../../src/engine";
import { coreComponents } from "../../../src/components";
import { darkTheme, lightTheme, type Theme } from "../../../src/theme";
import type { Value } from "../../../src/types";
import { tidySpec } from "../../../src/model/clean";
import { eventMessage, nextChunk } from "./messages";
import { firstFamily, hostTheme, type ReadVar } from "./host-theme";

const FACES = ['400 15px "Instrument Sans"', '600 15px "Instrument Sans"', '700 15px "Instrument Sans"'];

const canvas = document.querySelector<HTMLCanvasElement>("#loom")!;
const app = new App({ name: "SayShape", version: "0.1.0" }, {}, { autoResize: true });

let loom: SayShape | null = null;
/** The spec text the engine has been given so far in the current stream. */
let shown = "";
/** Input that arrived before the engine was ready. */
let pending: { spec: string; final: boolean } | null = null;
/**
 * Rows from the database, by the name the spec uses (show_interface's data
 * argument). They're fetched from the server by the interface itself, so they
 * never pass through the model, and put back after anything that resets state.
 */
const hostData = new Map<string, Value>();
let pendingData: Record<string, string> | null = null;
/** Datasets still being fetched: elements that read them draw placeholders until they arrive. */
const loadingData = new Set<string>();
/** True while the spec is still streaming in, before the data argument is known. */
let awaiting = false;

/**
 * What the view shows before the first line of a spec arrives (some chat apps
 * only send the spec once it's complete): the outline of a card, shimmering.
 */
const INTRO = `card
  skeleton lines=1
  skeleton shape=block height=150
  skeleton lines=2
`;
let introShowing = false;

function syncLoading(): void {
  loom?.setLoading(loadingData);
  loom?.setAwaiting(awaiting);
}

const prefersDark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
const SENTINEL = "rgb(1, 2, 3)";

/**
 * Reads host variables as values the canvas understands. Colors and lengths
 * go through a hidden probe so the browser resolves var(), light-dark() and
 * relative units; a variable that isn't a valid color leaves the probe at the
 * sentinel, and is ignored.
 */
function domReader(dark: boolean): ReadVar {
  const root = document.documentElement;
  const wrap = document.createElement("div");
  // color-scheme only on the probe: light-dark() resolves for the host's theme, and the page
  // itself stays transparent over the chat (a page-wide scheme can make browsers paint it opaque).
  wrap.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:${SENTINEL};color-scheme:${dark ? "dark" : "light"}`;
  const probe = document.createElement("span");
  wrap.append(probe);
  document.body.append(wrap);
  return (name, kind) => {
    const raw = getComputedStyle(root).getPropertyValue(name).trim();
    if (!raw) return undefined;
    if (kind === "font") return raw;
    if (kind === "color") {
      probe.style.color = `var(${name})`;
      const c = getComputedStyle(probe).color;
      return c && c !== SENTINEL ? c : undefined;
    }
    probe.style.borderTopLeftRadius = `var(${name})`;
    return getComputedStyle(probe).borderTopLeftRadius || undefined;
  };
}

/** SayShape's light or dark theme, adjusted to the host's own colors, fonts and radii when it sends them. */
function themeFor(ctx: McpUiHostContext | undefined): Theme {
  const dark = ctx?.theme ? ctx.theme === "dark" : prefersDark();
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  const base = dark ? darkTheme : lightTheme;
  const styles = ctx?.styles;
  if (styles?.css?.fonts) applyHostFonts(styles.css.fonts);
  if (!styles?.variables) return base;
  applyHostStyleVariables(styles.variables);
  return hostTheme(base, domReader(dark));
}

/** Canvas text doesn't trigger font loading, so load the theme's faces before drawing with them. */
async function loadFaces(theme: Theme): Promise<void> {
  if (!document.fonts) return;
  const family = firstFamily(theme.font.family);
  const faces = family && family !== "Instrument Sans"
    ? [400, 600, 700].map((w) => `${w} 15px "${family}"`)
    : FACES;
  await Promise.race([
    Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => undefined),
    new Promise((done) => setTimeout(done, 1500)),
  ]);
}

async function applyTheme(ctx: McpUiHostContext | undefined): Promise<Theme> {
  const theme = themeFor(ctx);
  await loadFaces(theme);
  loom?.setTheme(theme);
  return theme;
}

function show(spec: string, final: boolean): void {
  if (!loom) { pending = { spec, final }; return; }
  if (introShowing) { introShowing = false; loom.beginStream(); shown = ""; applyHostData(); }
  const next = nextChunk(shown, spec);
  if (next.restart) { loom.beginStream(); shown = ""; applyHostData(); }
  if (next.add) { loom.push(next.add); shown += next.add; }
  if (final) {
    if (loom.isStreaming) loom.endStream();
    // The streamed text can differ from the final arguments (healed JSON); the final spec wins.
    if (loom.spec !== spec) { loom.setSpec(spec, { resetState: true }); applyHostData(); }
  }
}

function applyHostData(): void {
  if (!loom) return;
  for (const [name, rows] of hostData) {
    try { loom.state.set(name, rows); } catch { loom.notify(`Couldn't show the data for ${name}`); }
  }
}

/** Fetch each dataset's rows from the server (fetch_dataset, which only the interface may call) and show them. */
async function loadData(wanted: Record<string, string>): Promise<void> {
  if (!loom) { pendingData = wanted; return; }
  if (!app.getHostCapabilities()?.serverTools) {
    loadingData.clear();
    syncLoading();
    loom.notify("This chat app doesn't let interfaces load data");
    return;
  }
  await Promise.all(Object.entries(wanted).map(async ([name, id]) => {
    try {
      const r = await app.callServerTool({ name: "fetch_dataset", arguments: { id } });
      const rows = (r.structuredContent as { rows?: unknown } | undefined)?.rows;
      if (r.isError || !Array.isArray(rows)) throw new Error("no rows");
      hostData.set(name, rows as Value);
      try { loom?.state.set(name, rows as Value); } catch { loom?.notify(`Couldn't show the data for ${name}`); }
    } catch {
      loom?.notify(`Couldn't load the data for ${name}`);
    }
    // Each dataset draws in as soon as it's here, without waiting for the others.
    loadingData.delete(name);
    syncLoading();
  }));
  applyHostData();
}

function dataOf(args: Record<string, unknown> | undefined): Record<string, string> | null {
  const d = args?.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : null;
}

function specOf(args: Record<string, unknown> | undefined): string | null {
  const s = args?.spec;
  return typeof s === "string" ? s : null;
}

// Tidied the way the server checks it (fences, typographic quotes). While streaming,
// only complete lines are tidied and shown, so each step extends the last one.
app.ontoolinputpartial = (p) => {
  const spec = specOf(p.arguments);
  // Until the data argument arrives, a name with no value yet may be a dataset: wait for it.
  if (!awaiting) { awaiting = true; syncLoading(); }
  if (spec !== null) show(tidySpec(spec.slice(0, spec.lastIndexOf("\n") + 1)), false);
};
app.ontoolinput = (p) => {
  const spec = specOf(p.arguments);
  const data = dataOf(p.arguments);
  // The names are known now: only datasets still to fetch wait as placeholders.
  for (const name of Object.keys(data ?? {})) loadingData.add(name);
  awaiting = false;
  syncLoading();
  if (spec !== null) show(tidySpec(spec), true);
  if (data) void loadData(data);
};
// A refused call (an unknown dataset, say) never sends rows: stop waiting for them.
app.ontoolresult = (r) => {
  if (!r.isError) return;
  loadingData.clear();
  awaiting = false;
  syncLoading();
};
app.onhostcontextchanged = () => {
  // getHostContext() holds the whole context with this change merged in.
  void applyTheme(app.getHostContext());
};
app.onteardown = async () => {
  loom?.destroy();
  loom = null;
  return {};
};

/**
 * Send an event to the model: as a message when the client allows it (the
 * model answers straight away), otherwise as context for its next reply.
 */
async function deliver(text: string): Promise<void> {
  const caps = app.getHostCapabilities();
  const content = [{ type: "text" as const, text }];
  try {
    if (caps?.message) {
      const r = await app.sendMessage({ role: "user", content });
      loom?.notify(r?.isError ? "Couldn't send that to the assistant" : "Sent to the assistant");
    } else if (caps?.updateModelContext) {
      await app.updateModelContext({ content });
      loom?.notify("Saved for the assistant's next reply");
    } else {
      loom?.notify("This chat app can't receive actions from interfaces");
    }
  } catch {
    loom?.notify("Couldn't send that to the assistant");
  }
}

async function start(): Promise<void> {
  await app.connect();
  const theme = await applyTheme(app.getHostContext());
  loom = new SayShape(canvas, {
    components: coreComponents,
    theme,
    // The view has no network access of its own; the client's sandbox blocks it too.
    imageHosts: [],
    onWarning: () => {},
  });
  loom.on("action", ({ name, value }: { name: string; value: Value | undefined }) => {
    if (!loom) return;
    void deliver(eventMessage(name, value, loom.state.snapshot()));
  });
  syncLoading();
  if (pending) { const p = pending; pending = null; show(p.spec, p.final); }
  else { loom.setSpec(INTRO); introShowing = true; }
  if (pendingData) { const d = pendingData; pendingData = null; void loadData(d); }
}

void start();
