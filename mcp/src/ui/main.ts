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
import { App } from "@modelcontextprotocol/ext-apps";
import { SayShape } from "../../../src/engine";
import { coreComponents } from "../../../src/components";
import { darkTheme, lightTheme } from "../../../src/theme";
import type { Value } from "../../../src/types";
import { eventMessage, nextChunk } from "./messages";

const FACES = ['400 15px "Instrument Sans"', '600 15px "Instrument Sans"', '700 15px "Instrument Sans"'];

const canvas = document.querySelector<HTMLCanvasElement>("#loom")!;
const app = new App({ name: "SayShape", version: "0.1.0" }, {}, { autoResize: true });

let loom: SayShape | null = null;
/** The spec text the engine has been given so far in the current stream. */
let shown = "";
/** Input that arrived before the engine was ready. */
let pending: { spec: string; final: boolean } | null = null;

const prefersDark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
function applyTheme(theme: string | undefined): void {
  const dark = theme ? theme === "dark" : prefersDark();
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  loom?.setTheme(dark ? darkTheme : lightTheme);
}

function show(spec: string, final: boolean): void {
  if (!loom) { pending = { spec, final }; return; }
  const next = nextChunk(shown, spec);
  if (next.restart) { loom.beginStream(); shown = ""; }
  if (next.add) { loom.push(next.add); shown += next.add; }
  if (final) {
    if (loom.isStreaming) loom.endStream();
    // The streamed text can differ from the final arguments (healed JSON); the final spec wins.
    if (loom.spec !== spec) loom.setSpec(spec, { resetState: true });
  }
}

function specOf(args: Record<string, unknown> | undefined): string | null {
  const s = args?.spec;
  return typeof s === "string" ? s : null;
}

app.ontoolinputpartial = (p) => {
  const spec = specOf(p.arguments);
  if (spec !== null) show(spec, false);
};
app.ontoolinput = (p) => {
  const spec = specOf(p.arguments);
  if (spec !== null) show(spec, true);
};
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyTheme(ctx.theme);
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
  applyTheme(app.getHostContext()?.theme);
  if (document.fonts) await Promise.all(FACES.map((f) => document.fonts.load(f))).catch(() => undefined);
  loom = new SayShape(canvas, {
    components: coreComponents,
    theme: document.documentElement.dataset.theme === "dark" ? darkTheme : lightTheme,
    // The view has no network access of its own; the client's sandbox blocks it too.
    imageHosts: [],
    onWarning: () => {},
  });
  loom.on("action", ({ name, value }: { name: string; value: Value | undefined }) => {
    if (!loom) return;
    void deliver(eventMessage(name, value, loom.state.snapshot()));
  });
  if (pending) { const p = pending; pending = null; show(p.spec, p.final); }
}

void start();
