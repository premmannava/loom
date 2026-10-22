/**
 * Runs the evaluation set against a model and scores the results. The CLI is
 * scripts/eval.ts; this file has no Node-only code, so it's tested directly.
 */
import { generateSpec, type GenerateResult, type ModelConfig } from "../src/model";
import { describeGuide, type GuideOptions } from "../src/prompt";
import { resolveProfile } from "../src/profiles";
import { parse } from "../src/parser";
import type { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { SayShapeNode } from "../src/types";
import type { EvalCase } from "./cases";

/** Props a model invents when it tries to style things itself. */
const DESIGN_PROPS = ["color", "colour", "background", "bg", "font", "fontSize", "font-size", "size", "width", "height", "margin", "padding", "border", "radius", "fontWeight", "textColor"];

/**
 * One way of prompting, so the same requests can be compared: the guide's
 * mode and profile, and what the repair uses. Every variant uses the same
 * model and generation settings.
 */
export interface Variant {
  /** A short label for reports, e.g. "full" or "compact+full-repair". */
  name: string;
  guide?: GuideOptions;
  repairGuide?: "same" | "full";
  enforceProfile?: boolean;
}

export interface CaseResult {
  id: string;
  /** Which variant produced this result ("default" when there's only one). */
  variant: string;
  guideMode: string;
  profile: string;
  /** The guide used by the repair, when one ran. */
  repairGuideMode?: string;
  /** Always "none": each request is generated fresh. Recorded so results say so. */
  contextPolicy: string;
  /** False when the profile lacks an element the request needs; such requests aren't sent. */
  supported: boolean;
  /** The expected elements outside the profile, for unsupported requests. */
  unsupportedBy: string[];
  /** Characters in the guide, and every character sent over all attempts / 4 (an estimate). */
  guideChars: number;
  inputTokensEstimated: number;
  /** Input and output tokens over all attempts as the server reported them; undefined when any attempt didn't. */
  inputTokens?: number;
  outputTokensReported?: number;
  /** Reasoning tokens the server reported (part of output tokens, not added to them). */
  reasoningTokens?: number;
  /** A repair ran and turned an invalid first spec into a valid final one. */
  repairFixed: boolean;
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
  /**
   * Prompting variants to compare. Each request runs once per variant, one
   * after another (interleaved), so a server slowing down affects all alike.
   * Left out: one variant from guide.
   */
  variants?: Variant[];
  fetch?: typeof fetch;
  /** Called as each case finishes, for progress output. */
  onCase?: (r: CaseResult, index: number, total: number) => void;
}

function types(root: SayShapeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: SayShapeNode) => { if (n.id !== "root") out.add(n.type); n.children.forEach(walk); };
  walk(root);
  return out;
}

const tokensOf = (r: GenerateResult): { tokens: number; estimated: boolean } => {
  // Reported only when every attempt reported it; a missing count isn't zero.
  const reported = r.usage.completionTokens;
  if (reported !== undefined) return { tokens: reported, estimated: false };
  // About four characters per token, when the server doesn't report usage.
  const chars = r.first.raw.length + (r.repair?.raw.length ?? 0);
  return { tokens: Math.round(chars / 4), estimated: true };
};

/** The expected elements a profile can't build: an entry fails when none of its choices are exposed. */
export function unsupportedBy(c: EvalCase, exposed: readonly string[]): string[] {
  return (c.expect ?? [])
    .filter((e) => (Array.isArray(e) ? !e.some((t) => exposed.includes(t)) : !exposed.includes(e)))
    .map((e) => (Array.isArray(e) ? e.join(" or ") : e));
}

const DEFAULT_VARIANT = "default";

function variantFields(r: GenerateResult, guideChars: number, variant: string): Pick<CaseResult, "variant" | "guideMode" | "profile" | "repairGuideMode" | "contextPolicy" | "supported" | "unsupportedBy" | "guideChars" | "inputTokensEstimated" | "inputTokens" | "outputTokensReported" | "reasoningTokens" | "repairFixed"> {
  return {
    variant,
    guideMode: r.first.guide.mode,
    profile: r.first.guide.profile,
    repairGuideMode: r.repair?.guide.mode,
    contextPolicy: r.context.policy,
    supported: true,
    unsupportedBy: [],
    guideChars,
    inputTokensEstimated: Math.round((r.first.inputChars + (r.repair?.inputChars ?? 0)) / 4),
    inputTokens: r.usage.promptTokens,
    outputTokensReported: r.usage.completionTokens,
    reasoningTokens: r.usage.reasoningTokens,
    repairFixed: !!r.repair && r.first.diagnostics.length > 0 && r.diagnostics.length === 0 && !!r.spec.trim(),
  };
}

export function scoreCase(c: EvalCase, r: GenerateResult, registry: Registry, variant = DEFAULT_VARIANT, guideChars = 0): CaseResult {
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
    ...variantFields(r, guideChars, variant),
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

function emptyResult(c: EvalCase, v: Variant, profile: string, guideChars: number, extra: Partial<CaseResult>): CaseResult {
  return {
    id: c.id, variant: v.name, guideMode: v.guide?.mode ?? "full", profile, contextPolicy: "none", supported: true, unsupportedBy: [],
    guideChars, inputTokensEstimated: 0, repairFixed: false,
    category: c.category, request: c.request, note: c.note, ok: false,
    validFirst: false, validFinal: false, problemsFirst: 0, problemsFinal: 0, repaired: false,
    missing: [], checks: c.checks?.length ?? 0, failedChecks: [], inventedDesign: [], inventedElements: [], empty: true, recovered: false, firstRaw: "", outputTokens: 0, tokensEstimated: true,
    thinkingTokens: 0, totalMs: 0, elements: 0, firstSpec: "", finalSpec: "", firstProblems: [], finalProblems: [],
    ...extra,
  };
}

export async function runEval(list: EvalCase[], o: EvalOptions): Promise<CaseResult[]> {
  const variants: Variant[] = o.variants?.length ? o.variants : [{ name: DEFAULT_VARIANT, guide: o.guide }];
  const prepared = variants.map((v) => {
    const info = describeGuide(o.registry, v.guide);
    return { v, info, exposed: resolveProfile(o.registry, v.guide?.profile).types };
  });
  const total = list.length * variants.length;
  const results: CaseResult[] = [];
  for (const c of list) {
    for (const { v, info, exposed } of prepared) {
      let result: CaseResult;
      const unsupported = unsupportedBy(c, exposed);
      if (unsupported.length) {
        // Not sent: the profile can't build what the request needs, so it would only measure the profile's gaps.
        result = emptyResult(c, v, info.profile, info.chars, { supported: false, unsupportedBy: unsupported, ok: true, empty: false });
      } else {
        try {
          const r = await generateSpec({
            config: o.config,
            registry: o.registry,
            guide: v.guide,
            request: c.request,
            userSuffix: o.userSuffix,
            repairOn: o.repair === false ? "never" : "any",
            repairGuide: v.repairGuide,
            enforceProfile: v.enforceProfile,
            fetch: o.fetch,
          });
          result = scoreCase(c, r, o.registry, v.name, info.chars);
        } catch (e) {
          result = emptyResult(c, v, info.profile, info.chars, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      results.push(result);
      o.onCase?.(result, results.length - 1, total);
    }
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
  /** Requests the profile couldn't build, so they weren't sent. Not counted in the rest. */
  unsupported: number;
  repairs: number;
  repairsFixed: number;
  /** Median reported input tokens over all attempts; undefined unless every request reported them. */
  medianInputTokens?: number;
  medianInputTokensEstimated?: number;
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

export function summarize(all: CaseResult[]): Summary {
  const results = all.filter((r) => r.supported !== false);
  const ran = results.filter((r) => r.ok);
  const checkedIds = new Set(results.filter((r) => r.checks > 0).map((r) => r.id));
  const inputs = ran.map((r) => r.inputTokens);
  return {
    cases: results.length,
    unsupported: all.length - results.length,
    repairs: ran.filter((r) => r.repaired).length,
    repairsFixed: ran.filter((r) => r.repairFixed).length,
    medianInputTokens: inputs.length && inputs.every((n) => n !== undefined) ? median(inputs as number[]) : undefined,
    medianInputTokensEstimated: median(ran.map((r) => r.inputTokensEstimated ?? 0)),
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
/** The headline rows for one set of results. */
function summaryRows(s: Summary): Array<[string, string]> {
  const ran = s.cases - s.failed;
  return [
    ["Valid on the first try", `${s.validFirst}/${ran} (${pct(s.validFirst, ran)})`],
    ["Valid after one repair", `${s.validFinal}/${ran} (${pct(s.validFinal, ran)})`],
    ["Repairs run / turned valid", `${s.repairs} / ${s.repairsFixed}`],
    ["Used the expected elements", `${s.expectedMet}/${ran} (${pct(s.expectedMet, ran)})`],
    ["Worked when used (behavior checks)", s.checked ? `${s.checksMet}/${s.checked} (${pct(s.checksMet, s.checked)})` : "—"],
    ["Invented design props / elements", `${s.inventedDesign} / ${s.inventedElements}`],
    ["Empty answers", `${s.empty}`],
    ["Input tokens per screen, reported (median)", s.medianInputTokens === undefined ? "unknown" : `${s.medianInputTokens}`],
    ["Input tokens per screen, estimated chars/4 (median)", `${s.medianInputTokensEstimated ?? "—"}`],
    ["Output tokens per screen (median)", `${s.medianTokens ?? "—"}${s.tokensEstimated ? " (estimated from length)" : ""}`],
    ["Time to first SayShape line (median)", secs(s.medianFirstLineMs)],
    ["Total time per screen (median)", secs(s.medianTotalMs)],
    ["Requests not supported by the profile (not sent)", `${s.unsupported}`],
  ];
}

/** Compare variants side by side on the requests every one of them supports. */
export function compareVariants(results: CaseResult[]): string {
  const names = [...new Set(results.map((r) => r.variant))];
  if (names.length < 2) return "";
  const supportedByAll = new Set(
    [...new Set(results.map((r) => r.id))].filter((id) => names.every((n) => results.some((r) => r.id === id && r.variant === n && r.supported !== false))),
  );
  const sums = names.map((n) => summarize(results.filter((r) => r.variant === n && supportedByAll.has(r.id))));
  const rows = summaryRows(sums[0]!).map(([label], i) => `| ${label} | ${sums.map((s) => summaryRows(s)[i]![1]).join(" | ")} |`);
  const guides = names.map((n) => {
    const r = results.find((x) => x.variant === n)!;
    return `| ${n} | ${r.guideMode} | ${r.profile} | ${r.guideChars.toLocaleString("en-US")} (~${Math.round(r.guideChars / 4).toLocaleString("en-US")} est.) |`;
  });
  return [
    `## Comparison on the ${supportedByAll.size} requests every variant supports`,
    "",
    "| Variant | Guide | Profile | Guide characters (tokens est.) |",
    "|---|---|---|---|",
    ...guides,
    "",
    `| | ${names.join(" | ")} |`,
    `|---|${names.map(() => "---").join("|")}|`,
    ...rows,
    "",
    "The time to the first SayShape line is when the first line could be shown, not when the screen is usable.",
    "",
  ].join("\n");
}

export function report(results: CaseResult[], meta: { model: string; url: string; date: string; guideTokens: number; repair: boolean }): string {
  const variants = [...new Set(results.map((r) => r.variant))];
  if (variants.length > 1) {
    const parts = variants.map((v) => report(results.filter((r) => r.variant === v), meta).replace(/^# SayShape evaluation: .*\n/, `## Variant: ${v}\n`));
    return [`# SayShape evaluation: ${meta.model}`, "", `${meta.date} · ${meta.url} · repair ${meta.repair ? "on" : "off"} · same model and settings for every variant`, "", compareVariants(results), ...parts].join("\n");
  }
  const s = summarize(results);
  const ran = s.cases - s.failed;
  const first = results[0];
  // Only named when it isn't the default, so existing reports read as before.
  const guideNote = first && (first.guideMode !== "full" || first.profile !== "all") ? ` · ${first.guideMode} guide, profile ${first.profile}` : "";
  const lines = [
    `# SayShape evaluation: ${meta.model}`,
    "",
    `${meta.date} · ${meta.url} · guide about ${meta.guideTokens} tokens${guideNote} · repair ${meta.repair ? "on" : "off"}`,
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
    `| Repairs run / turned valid | ${s.repairs} / ${s.repairsFixed} |`,
    `| Input tokens per screen, reported (median) | ${s.medianInputTokens ?? "unknown"} |`,
    `| Input tokens per screen, estimated chars/4 (median) | ${s.medianInputTokensEstimated ?? "—"} |`,
    `| Output tokens per screen (median) | ${s.medianTokens ?? "—"}${s.tokensEstimated ? " (estimated from length)" : ""} |`,
    `| Thinking tokens before writing (median) | ${s.medianThinkingTokens ?? "—"} |`,
    `| Time to first line (median) | ${secs(s.medianFirstLineMs)} |`,
    `| Total time per screen (median) | ${secs(s.medianTotalMs)} |`,
    ...(s.failed ? [`| Requests that failed | ${s.failed} |`] : []),
    ...(s.unsupported ? [`| Requests the profile can't build (not sent) | ${s.unsupported} |`] : []),
    "",
    "| Request | First try | Final | Missing | Checks | Invented | Tokens | First line | Total |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) =>
      r.supported === false
        ? `| ${r.id} | not supported by the profile: needs ${r.unsupportedBy.join(", ")} | | | | | | | |`
        : r.ok
        ? `| ${r.id} | ${r.validFirst ? "valid" : `${r.problemsFirst} problems`} | ${r.validFinal ? "valid" : r.empty ? "empty" : `${r.problemsFinal} problems`} | ${r.missing.join(", ") || "—"} | ${!r.checks ? "—" : r.failedChecks.length ? `failed: ${r.failedChecks.join("; ")}` : "pass"} | ${[...r.inventedDesign.map((p) => p + "="), ...r.inventedElements].join(", ") || "—"} | ${r.outputTokens} | ${secs(r.firstLineMs)} | ${secs(r.totalMs)} |`
        : `| ${r.id} | failed: ${r.error?.slice(0, 80)} | | | | | | | |`,
    ),
    "",
    "Each request's first and final spec are saved next to this report; paste one into the playground to see it.",
  ];
  return lines.join("\n") + "\n";
}
