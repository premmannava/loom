/**
 * Runs the evaluation set against a model and scores the results. The CLI is
 * scripts/eval.ts; this file has no Node-only code, so it's tested directly.
 */
import { generateSpec, type GenerateResult, type ModelConfig } from "../src/model";
import type { GuideOptions } from "../src/prompt";
import { parse } from "../src/parser";
import type { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { LoomNode } from "../src/types";
import type { EvalCase } from "./cases";

/** Props a model invents when it tries to style things itself. */
const DESIGN_PROPS = ["color", "colour", "background", "bg", "font", "fontSize", "font-size", "size", "width", "height", "margin", "padding", "border", "radius", "fontWeight", "textColor"];

export interface CaseResult {
  id: string;
  category: string;
  request: string;
  note?: string;
  ok: boolean;
  error?: string;
  validFirst: boolean;
  validFinal: boolean;
  problemsFirst: number;
  problemsFinal: number;
  repaired: boolean;
  /** Expected elements the final spec didn't use. */
  missing: string[];
  /** How many behavior checks the request has, and the ones the final spec failed (see eval/checks.ts). */
  checks: number;
  failedChecks: string[];
  /** Design props the model tried to set in its first answer (color=, font=…). */
  inventedDesign: string[];
  /** Element types the model made up, from the first answer. */
  inventedElements: string[];
  empty: boolean;
  /** The first answer was empty and its spec was found inside the model's thinking. */
  recovered: boolean;
  /** What the model sent for the first answer: thinking (if the server sent it apart), then the text. */
  firstRaw: string;
  outputTokens: number;
  tokensEstimated: boolean;
  thinkingTokens: number;
  firstLineMs?: number;
  totalMs: number;
  elements: number;
  firstSpec: string;
  finalSpec: string;
  firstProblems: string[];
  finalProblems: string[];
}

export interface EvalOptions {
  config: ModelConfig;
  registry: Registry;
  guide?: GuideOptions;
  userSuffix?: string;
  repair?: boolean;
  fetch?: typeof fetch;
  /** Called as each case finishes, for progress output. */
  onCase?: (r: CaseResult, index: number, total: number) => void;
}

function types(root: LoomNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: LoomNode) => { if (n.id !== "root") out.add(n.type); n.children.forEach(walk); };
  walk(root);
  return out;
}

const tokensOf = (r: GenerateResult): { tokens: number; estimated: boolean } => {
  const reported = (r.first.usage.completionTokens ?? 0) + (r.repair?.usage.completionTokens ?? 0);
  if (reported) return { tokens: reported, estimated: false };
  // About four characters per token, when the server doesn't report usage.
  const chars = r.first.raw.length + (r.repair?.raw.length ?? 0);
  return { tokens: Math.round(chars / 4), estimated: true };
};

export function scoreCase(c: EvalCase, r: GenerateResult, registry: Registry): CaseResult {
  const final = parse(r.spec, registry);
  const used = types(final.root);
  const missing = (c.expect ?? [])
    .filter((e) => (Array.isArray(e) ? !e.some((t) => used.has(t)) : !used.has(e)))
    .map((e) => (Array.isArray(e) ? e.join(" or ") : e));
  const firstMsgs = r.first.diagnostics.map((d) => d.message);
  const inventedDesign = [...new Set(firstMsgs.flatMap((m) => {
    const p = /has no prop "([^"]+)"/.exec(m)?.[1];
    return p && DESIGN_PROPS.includes(p) ? [p] : [];
  }))];
  const inventedElements = [...new Set(firstMsgs.flatMap((m) => /Unknown element "([^"]+)"/.exec(m)?.[1] ?? []))];
  const { tokens, estimated } = tokensOf(r);
  const empty = !r.spec.trim();
  const failedChecks = (c.checks ?? []).filter((check) => {
    if (empty) return true;
    // Each check gets a fresh screen, since checks press things.
    const ui = render(r.spec, { components: registry.all() });
    try { return !check.test(r.spec, ui); } catch { return true; } finally { ui.destroy(); }
  }).map((check) => check.label);
  return {
    id: c.id,
    category: c.category,
    request: c.request,
    note: c.note,
    ok: true,
    validFirst: !empty && r.first.diagnostics.length === 0,
    validFinal: !empty && r.diagnostics.length === 0,
    problemsFirst: r.first.diagnostics.length,
    problemsFinal: r.diagnostics.length,
    repaired: !!r.repair,
    missing,
    checks: c.checks?.length ?? 0,
    failedChecks,
    inventedDesign,
    inventedElements,
    empty,
    recovered: r.first.recovered,
    firstRaw: [r.first.thinking && `--- thinking\n${r.first.thinking}`, `--- answer\n${r.first.raw}`].filter(Boolean).join("\n"),
    outputTokens: tokens,
    tokensEstimated: estimated,
    thinkingTokens: Math.round((r.first.thinkingChars + (r.repair?.thinkingChars ?? 0)) / 4),
    firstLineMs: r.timings.firstLineMs,
    totalMs: r.timings.totalMs,
    elements: final.nodeCount,
    firstSpec: r.first.spec,
    finalSpec: r.spec,
    firstProblems: r.first.diagnostics.map((d) => `L${d.line} ${d.severity}: ${d.message}`),
    finalProblems: r.diagnostics.map((d) => `L${d.line} ${d.severity}: ${d.message}`),
  };
}

export async function runEval(list: EvalCase[], o: EvalOptions): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const [i, c] of list.entries()) {
    let result: CaseResult;
    try {
      const r = await generateSpec({
        config: o.config,
        registry: o.registry,
        guide: o.guide,
        request: c.request,
        userSuffix: o.userSuffix,
        repairOn: o.repair === false ? "never" : "any",
        fetch: o.fetch,
      });
      result = scoreCase(c, r, o.registry);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result = {
        id: c.id, category: c.category, request: c.request, note: c.note, ok: false, error,
        validFirst: false, validFinal: false, problemsFirst: 0, problemsFinal: 0, repaired: false,
        missing: [], checks: c.checks?.length ?? 0, failedChecks: [], inventedDesign: [], inventedElements: [], empty: true, recovered: false, firstRaw: "", outputTokens: 0, tokensEstimated: true,
        thinkingTokens: 0, totalMs: 0, elements: 0, firstSpec: "", finalSpec: "", firstProblems: [], finalProblems: [],
      };
    }
    results.push(result);
    o.onCase?.(result, i, list.length);
  }
  return results;
}

// ---------------------------------------------------------------- report

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const secs = (ms?: number) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);

export interface Summary {
  cases: number;
  failed: number;
  validFirst: number;
  validFinal: number;
  expectedMet: number;
  /** Requests that have behavior checks, and how many passed all of theirs. */
  checked: number;
  checksMet: number;
  inventedDesign: number;
  inventedElements: number;
  empty: number;
  recovered: number;
  medianTokens?: number;
  medianFirstLineMs?: number;
  medianTotalMs?: number;
  medianThinkingTokens?: number;
  tokensEstimated: boolean;
}

export function summarize(results: CaseResult[]): Summary {
  const ran = results.filter((r) => r.ok);
  const checkedIds = new Set(results.filter((r) => r.checks > 0).map((r) => r.id));
  return {
    cases: results.length,
    failed: results.length - ran.length,
    validFirst: ran.filter((r) => r.validFirst).length,
    validFinal: ran.filter((r) => r.validFinal).length,
    expectedMet: ran.filter((r) => !r.missing.length).length,
    checked: ran.filter((r) => checkedIds.has(r.id)).length,
    checksMet: ran.filter((r) => checkedIds.has(r.id) && !r.failedChecks.length).length,
    inventedDesign: ran.filter((r) => r.inventedDesign.length).length,
    inventedElements: ran.filter((r) => r.inventedElements.length).length,
    empty: ran.filter((r) => r.empty).length,
    recovered: ran.filter((r) => r.recovered).length,
    medianTokens: median(ran.map((r) => r.outputTokens)),
    medianFirstLineMs: median(ran.flatMap((r) => (r.firstLineMs === undefined ? [] : [r.firstLineMs]))),
    medianTotalMs: median(ran.map((r) => r.totalMs)),
    medianThinkingTokens: median(ran.map((r) => r.thinkingTokens)),
    tokensEstimated: ran.some((r) => r.tokensEstimated),
  };
}

/** A Markdown report: the headline numbers, then one row per request. */
export function report(results: CaseResult[], meta: { model: string; url: string; date: string; guideTokens: number; repair: boolean }): string {
  const s = summarize(results);
  const ran = s.cases - s.failed;
  const lines = [
    `# Loom evaluation: ${meta.model}`,
    "",
    `${meta.date} · ${meta.url} · guide about ${meta.guideTokens} tokens · repair ${meta.repair ? "on" : "off"}`,
    "",
    "| | |",
    "|---|---|",
    `| Valid on the first try | ${s.validFirst}/${ran} (${pct(s.validFirst, ran)}) |`,
    `| Valid after one repair | ${s.validFinal}/${ran} (${pct(s.validFinal, ran)}) |`,
    `| Used the expected elements | ${s.expectedMet}/${ran} (${pct(s.expectedMet, ran)}) |`,
    ...(s.checked ? [`| Worked when used (behavior checks) | ${s.checksMet}/${s.checked} (${pct(s.checksMet, s.checked)}) |`] : []),
    `| Invented design props (color=, font=…) | ${s.inventedDesign} |`,
    `| Invented elements | ${s.inventedElements} |`,
    `| Empty answers | ${s.empty} |`,
    ...(s.recovered ? [`| Specs found inside unclosed thinking | ${s.recovered} |`] : []),
    `| Output tokens per screen (median) | ${s.medianTokens ?? "—"}${s.tokensEstimated ? " (estimated from length)" : ""} |`,
    `| Thinking tokens before writing (median) | ${s.medianThinkingTokens ?? "—"} |`,
    `| Time to first line (median) | ${secs(s.medianFirstLineMs)} |`,
    `| Total time per screen (median) | ${secs(s.medianTotalMs)} |`,
    ...(s.failed ? [`| Requests that failed | ${s.failed} |`] : []),
    "",
    "| Request | First try | Final | Missing | Checks | Invented | Tokens | First line | Total |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) =>
      r.ok
        ? `| ${r.id} | ${r.validFirst ? "valid" : `${r.problemsFirst} problems`} | ${r.validFinal ? "valid" : r.empty ? "empty" : `${r.problemsFinal} problems`} | ${r.missing.join(", ") || "—"} | ${!r.checks ? "—" : r.failedChecks.length ? `failed: ${r.failedChecks.join("; ")}` : "pass"} | ${[...r.inventedDesign.map((p) => p + "="), ...r.inventedElements].join(", ") || "—"} | ${r.outputTokens} | ${secs(r.firstLineMs)} | ${secs(r.totalMs)} |`
        : `| ${r.id} | failed: ${r.error?.slice(0, 80)} | | | | | | | |`,
    ),
    "",
    "Each request's first and final spec are saved next to this report; paste one into the playground to see it.",
  ];
  return lines.join("\n") + "\n";
}
