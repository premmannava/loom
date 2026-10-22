/// <reference types="vite/client" />
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import { coreComponents, SayShape } from "../../src/index";
import { mapComponents } from "../../src/components/map";
import { generateSpec } from "../../src/model";
import { playgroundGuide } from "../model-guide";
import { resultTimings, timingLines, type RunTiming } from "./timings";
import monthlyBudgetSpec from "./monthly-budget.loom?raw";

declare const __LOOM_MODEL__: string;
const configuredModel = typeof __LOOM_MODEL__ === "string" ? __LOOM_MODEL__.trim() : "";

const loom = new SayShape(document.querySelector<HTMLCanvasElement>("#app")!, {
  components: [...coreComponents, ...mapComponents], theme: "auto",
});
loom.setSpec('text "Your generated interface will appear here." tone=muted');
const controls = new SayShape(document.querySelector<HTMLCanvasElement>("#generator")!, { components: coreComponents, theme: "auto" });
controls.setSpec(`state request="" generating=false status="" elapsed=""
column
  text "What would you like to build?" style=title
  input bind=request placeholder="A trip planner, a budget calculator, a habit tracker…" on=emit:generate
  button "Generate" on=emit:generate disabled={generating || trim(request) == ''}
  button "Load monthly budget example" variant=secondary on=emit:budget disabled={generating}
  button "Cancel" variant=secondary on=emit:cancel if={generating}
  text "{status}" if={status != ''}
  text "{elapsed}" if={generating}
`);
const timings = new SayShape(document.querySelector<HTMLCanvasElement>("#timings")!, { components: coreComponents, theme: "auto" });
timings.setSpec(`state open=true lines=[] history=[]
accordion "Generation diagnostics" bind=open
  text "Times are measured in your browser. First token includes queueing, prompt processing and transport; it cannot separate them. Output speed includes reasoning when reported and is approximate, not GPU decode speed."
  each items=lines as=line
    text "{line}"
  table "Recent runs (this page session)" items=history
    table-column "Run" field=id format=number
    table-column "Result" field=outcome
    table-column "Seconds" field=seconds format=number
    table-column "Repair" field=repair
  button "Download timing log" on=emit:download disabled={len(history) == 0}
`);
const runs: RunTiming[] = [];
let nextRun = 1;
let controller: AbortController | undefined;
let disposed = false;

async function generate() {
  if (controller) return;
  const request = String(controls.state.get("request") ?? "").trim();
  if (!request) return;
  controller = new AbortController();
  const current = controller;
  const started = performance.now();
  const run: RunTiming = { id: nextRun++, at: new Date().toISOString(), request, outcome: "failed", elapsedMs: 0, attempts: [] };
  const ticker = window.setInterval(() => { if (!disposed) controls.state.set("elapsed", `${((performance.now() - started) / 1000).toFixed(1)}s elapsed`); }, 250);
  controls.state.set("generating", true);
  controls.state.set("status", "Connecting to the model…");
  try {
    const response = await fetch("/api/model/models", { signal: current.signal });
    if (!response.ok) throw new Error(`Model server returned ${response.status}. Check that it is running.`);
    const json: unknown = await response.json();
    const data = (json as { data?: Array<{ id?: unknown }> })?.data;
    run.discoveryMs = performance.now() - started;
    const models = Array.isArray(data) ? data.flatMap((m) => m && typeof m.id === "string" ? [m.id] : []) : [];
    const model = configuredModel || (models.find((m) => m === "qwen3-14b-uncensored") ?? models.find((m) => /qwen/i.test(m) && !/embedding/i.test(m)));
    if (!model) throw new Error("Configure LOOM_MODEL or load a Qwen chat model in the local server, then try again.");
    run.model = model;
    const guide = playgroundGuide([]);
    guide.notes += "\nThis is a general UI sandbox. Follow the user's requested domain; do not add equipment or ordering unless requested. Generate the complete spec, including state and derived values. Use working local interactions. No backend services are connected; do not claim to send, save remotely or purchase anything.";
    const result = await generateSpec({
      config: { url: "/api/model", model, maxTokens: 3000, streamUsage: true },
      registry: loom.registry, guide, request, signal: current.signal,
      onPhase: (phase) => { if (!disposed) controls.state.set("status", phase === "repairing" ? "The model is correcting the interface…" : "The model is building your interface…"); },
    });
    Object.assign(run, resultTimings(result));
    if (disposed || current.signal.aborted) return;
    if (!result.spec.trim()) throw new Error("The model returned an empty interface. Try a simpler request.");
    if (result.diagnostics.length) throw new Error(`The model could not finish a valid interface: ${result.diagnostics.slice(0, 2).map((d) => d.message).join(" ")}`);
    const renderStarted = performance.now();
    loom.setSpec(result.spec, { resetState: true });
    loom.renderNow();
    run.renderMs = performance.now() - renderStarted;
    run.outcome = "success";
    controls.state.set("status", "Ready. Try your interface below, or describe something new.");
  } catch (error) {
    run.outcome = current.signal.aborted ? "canceled" : "failed";
    run.error = error instanceof Error ? error.message : "Generation failed.";
    if (!disposed) controls.state.set("status", current.signal.aborted ? "Canceled." : `${error instanceof Error ? error.message : "Generation failed."} Your previous interface is still available.`);
  } finally {
    window.clearInterval(ticker);
    run.elapsedMs = performance.now() - started;
    if (current.signal.aborted) run.outcome = "canceled";
    if (!disposed) {
      runs.unshift(run);
      if (runs.length > 20) runs.pop();
      timings.state.set("lines", timingLines(run));
      timings.state.set("history", runs.map((r) => ({ id: r.id, outcome: r.outcome, seconds: Math.round(r.elapsedMs / 10) / 100, repair: r.attempts.length ? (r.attempts.length > 1 ? "Yes" : "No") : "Unknown" })));
      console.info("SayShape generation timing", run);
    }
    controller = undefined;
    if (!disposed) controls.state.set("generating", false);
  }
}
const stopControls = controls.on("action", ({ name }) => {
  if (name === "generate") void generate();
  if (name === "cancel") controller?.abort();
  if (name === "budget" && !controller) {
    loom.setSpec(monthlyBudgetSpec, { resetState: true });
    loom.renderNow();
    controls.state.set("status", "Monthly budget example loaded. Change the filters, select rows and adjust the budget.");
  }
});
const stopActions = loom.on("action", ({ name }) => {
  controls.state.set("status", `The interface requested “${name}”. This sandbox has no backend connected for that action.`);
});
const stopTimings = timings.on("action", ({ name }) => {
  if (name !== "download") return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(runs, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "loom-generation-timings.json"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void document.fonts.ready.then(() => { if (!disposed) { loom.invalidate("layout"); controls.invalidate("layout"); timings.invalidate("layout"); } });
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; controller?.abort(); stopControls(); stopActions(); stopTimings(); timings.destroy(); controls.destroy(); loom.destroy(); });
