/**
 * The playground's "Ask a model" box. Requests go to /api/model, which the dev
 * server passes through to LOOM_MODEL_URL (LM Studio by default), so the
 * browser needs no CORS from the model server and never sees an API key.
 */
import type { Loom } from "../src";
import { generateSpec, ModelError, nextRefineContext, type GenerateResult, type Phase, type RefineContext } from "../src/model";
import type { GuideOptions } from "../src/prompt";

declare const __LOOM_MODEL__: string;
declare const __LOOM_MODEL_URL__: string;
declare const __LOOM_USER_SUFFIX__: string;

export interface AskDeps {
  loom: Loom;
  guide: GuideOptions;
  /** Stop a sample that's still streaming. */
  stopSample(): void;
  /** Show the model's text in the editor as it arrives (replace when reset). */
  setEditor(text: string, opts?: { append?: boolean; readOnly?: boolean }): void;
  setPrompt(text: string): void;
  setStatus(live: boolean, text: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const PROXY = "/api/model";
const modelUrl = typeof __LOOM_MODEL_URL__ === "string" ? __LOOM_MODEL_URL__ : "";
const defaultModel = typeof __LOOM_MODEL__ === "string" ? __LOOM_MODEL__ : "";
const userSuffix = typeof __LOOM_USER_SUFFIX__ === "string" ? __LOOM_USER_SUFFIX__ : "";

const secs = (ms?: number) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function setupAsk(d: AskDeps): void {
  const form = $<HTMLFormElement>("askForm");
  const input = $<HTMLInputElement>("askInput");
  const select = $<HTMLSelectElement>("askModel");
  const refine = $<HTMLInputElement>("askRefine");
  const go = $<HTMLButtonElement>("askGo");
  const stop = $<HTMLButtonElement>("askStop");
  const status = $("askStatus");

  let controller: AbortController | null = null;
  /**
   * What a refinement sends: the first request, the changes asked for since,
   * and the current screen. Earlier screens and failed tries aren't kept, so
   * a refinement costs about the same however many came before.
   */
  let context: RefineContext | null = null;

  const say = (html: string, kind: "" | "live" | "error" = "") => {
    status.innerHTML = html;
    status.className = "ask-status" + (kind ? " " + kind : "");
  };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const where = `<code>${esc(modelUrl || "LOOM_MODEL_URL")}</code>`;

  // ---------------------------------------------------------------- models

  async function loadModels(): Promise<void> {
    try {
      const res = await fetch(`${PROXY}/models`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = (json.data ?? []).map((m) => m.id).filter((id) => !/embed/i.test(id));
      select.innerHTML = "";
      for (const id of ids) select.add(new Option(id, id));
      if (defaultModel && !ids.includes(defaultModel)) select.add(new Option(defaultModel, defaultModel), 0);
      select.value = defaultModel || ids[0] || "";
      if (!select.value) {
        say(`The model server at ${where} lists no models. Load one in LM Studio, then reload this page.`, "error");
        return;
      }
      say(`Connected to ${where}. Describe a screen and press Ask.`);
    } catch {
      if (defaultModel) {
        select.innerHTML = "";
        select.add(new Option(defaultModel, defaultModel));
      }
      say(
        `No model server answered at ${where}. In LM Studio, open the Developer tab and start the server, or set <code>LOOM_MODEL_URL</code> in <code>.env.local</code> and restart <code>npm run dev</code>. This box only works with <code>npm run dev</code>.`,
        "error",
      );
    }
  }

  // ---------------------------------------------------------------- asking

  const phaseText: Record<Phase, string> = {
    waiting: "Waiting for the model…",
    thinking: "The model is thinking before it writes…",
    writing: "Writing the screen…",
    repairing: "Fixing problems Loom found…",
    done: "Done",
  };

  function summary(r: GenerateResult): string {
    const parts = [`Done in ${secs(r.timings.totalMs)}`, `first line after ${secs(r.timings.firstLineMs)}`];
    // Reported numbers only; a server that doesn't report them leaves them out.
    if (r.usage.promptTokens !== undefined) parts.push(`${r.usage.promptTokens} input tokens`);
    else parts.push(`about ${r.first.estimatedInputTokens + (r.repair?.estimatedInputTokens ?? 0)} input tokens (estimated)`);
    if (r.usage.completionTokens !== undefined) parts.push(`${r.usage.completionTokens} output tokens`);
    if (r.first.thinkingChars) parts.push(`thought for about ${Math.round(r.first.thinkingChars / 4)} tokens first`);
    const firstProblems = r.first.diagnostics.length;
    if (!firstProblems) parts.push("valid on the first try");
    else if (r.repair && r.diagnostics.length < firstProblems) {
      parts.push(r.diagnostics.length ? `fixed ${firstProblems - r.diagnostics.length} of ${plural(firstProblems, "problem")}` : `fixed ${plural(firstProblems, "problem")} on the second try`);
    } else parts.push(`${plural(firstProblems, "problem")} left; see Problems below`);
    return parts.join(" · ");
  }

  async function ask(request: string): Promise<void> {
    const model = select.value;
    if (!request.trim() || !model) return;
    controller?.abort();
    controller = new AbortController();
    d.stopSample();
    d.setPrompt(request);

    // Refining sends the editor's current text, which the user may have edited.
    const refining = refine.checked && context ? { ...context, spec: d.loom.spec } : undefined;

    const startScreen = () => {
      d.loom.beginStream({ keepState: !!refining });
      d.setEditor("", { readOnly: true });
    };
    startScreen();
    go.disabled = true;
    stop.hidden = false;
    d.setStatus(true, "Model");
    say(phaseText.waiting, "live");
    let repairing = false;

    try {
      const r = await generateSpec({
        config: { url: PROXY, model },
        registry: d.loom.registry,
        guide: d.guide,
        request,
        refine: refining,
        userSuffix,
        signal: controller.signal,
        onText: (t) => { d.loom.push(t); d.setEditor(t, { append: true, readOnly: true }); },
        onReset: () => startScreen(),
        onPhase: (p) => {
          if (p === "done") return;
          if (p === "repairing") repairing = true;
          // During the fix, keep saying so while the model waits, thinks and writes again.
          say(repairing && p !== "repairing" ? `${phaseText.repairing} ${phaseText[p].toLowerCase()}` : phaseText[p], "live");
        },
      });
      context = refining ? nextRefineContext(refining, request, r.spec) : r.spec.trim() ? { task: request, spec: r.spec } : null;
      d.loom.endStream();
      d.setEditor(r.spec, { readOnly: false });
      // The final spec may be the first attempt if the repair came out worse.
      if (d.loom.spec !== r.spec) d.loom.setSpec(r.spec);
      say(esc(summary(r)));
      refine.disabled = !context;
    } catch (e) {
      d.loom.endStream();
      d.setEditor(d.loom.spec, { readOnly: false });
      if (controller.signal.aborted) say("Stopped.");
      else if (e instanceof ModelError) say(esc(e.message), "error");
      else say(esc(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`), "error");
    } finally {
      go.disabled = false;
      stop.hidden = true;
      d.setStatus(false, "Done. Edit freely");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void ask(input.value);
  });
  stop.addEventListener("click", () => controller?.abort());
  refine.disabled = true;
  void loadModels();
}
