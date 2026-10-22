/**
 * Runs the evaluation set against a model and writes a report:
 *
 *   npm run eval                       every request, the model from .env.local
 *   npm run eval -- --model qwen3-14b  a different model on the same server
 *   npm run eval -- --only form,trap   only some categories or request ids
 *   npm run eval -- --no-repair        first tries only
 *
 * Comparing ways of prompting (same model, same settings, requests interleaved):
 *
 *   npm run eval -- --guide full,compact             the full and compact guides
 *   npm run eval -- --guide compact --profile shop   one profile; requests it can't build are reported, not sent
 *   npm run eval -- --guide compact --repair-guide same,full
 *                                                    does repairing with the full guide help?
 *   npm run eval -- --enforce-profile                elements outside the profile count as problems
 *   npm run eval -- --stream-usage                   ask the server for token usage (if it supports it)
 *
 * Settings come from .env.local (see scripts/model-env.ts). Results go to
 * eval/results/<date>-<model>/: report.md, results.json, and each request's
 * first and final spec as .loom files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { languageGuide, type GuideMode, type GuideOptions } from "../src/prompt";
import { Registry } from "../src/registry";
import { cases } from "../eval/cases";
import { report, runEval, summarize, type Variant } from "../eval/run";
import { readModelEnv } from "./model-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The variants asked for with --guide, --profile, --repair-guide and --enforce-profile; none means the default guide. */
function variantsFromArgs(base: GuideOptions): Variant[] {
  const list = (name: string) => arg(name)?.split(",").map((s) => s.trim()).filter(Boolean);
  const modes = list("guide") as GuideMode[] | undefined;
  const profile = arg("profile");
  const repairs = (list("repair-guide") ?? ["same"]) as Array<"same" | "full">;
  const enforceProfile = process.argv.includes("--enforce-profile");
  if (!modes && !profile && !list("repair-guide") && !enforceProfile) return [];
  for (const m of modes ?? []) if (m !== "full" && m !== "compact") throw new Error(`--guide takes full and/or compact, not "${m}"`);
  for (const r of repairs) if (r !== "same" && r !== "full") throw new Error(`--repair-guide takes same and/or full, not "${r}"`);
  const out: Variant[] = [];
  for (const mode of modes ?? ["full"]) {
    for (const repairGuide of repairs) {
      if (mode === "full" && repairGuide === "full" && repairs.includes("same")) continue; // the same as full+same
      const name = [mode, profile, repairGuide === "full" && mode !== "full" ? "full-repair" : ""].filter(Boolean).join("+");
      out.push({ name, guide: { ...base, mode, profile }, repairGuide, enforceProfile });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const env = readModelEnv("development", resolve(__dirname, ".."));
  const registry = new Registry([...coreComponents, ...mapComponents]);
  const repair = !process.argv.includes("--no-repair");
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const list = only ? cases.filter((c) => only.includes(c.id) || only.includes(c.category)) : cases;
  if (!list.length) throw new Error(`No requests match --only ${only?.join(",")}`);

  let model = arg("model") ?? env.model;
  if (!model) {
    // Like the playground: use the first model the server lists.
    const res = await fetch(`${env.url}/models`, { headers: env.apiKey ? { Authorization: `Bearer ${env.apiKey}` } : {} }).catch(() => null);
    const json = res?.ok ? ((await res.json()) as { data?: Array<{ id: string }> }) : null;
    model = json?.data?.map((m) => m.id).find((id) => !/embed/i.test(id)) ?? "";
    if (!model) throw new Error(`No model given and none listed at ${env.url}/models. Start the model server, or set LOOM_MODEL in .env.local.`);
  }

  const guide: GuideOptions = { imageHosts: [] };
  const variants = variantsFromArgs(guide);
  const guideTokens = Math.round(languageGuide(registry, variants[0]?.guide ?? guide).length / 4);
  const streamUsage = process.argv.includes("--stream-usage");
  console.log(`Evaluating ${model} at ${env.url}: ${list.length} requests${variants.length > 1 ? ` × ${variants.length} variants (${variants.map((v) => v.name).join(", ")})` : variants[0] ? ` with ${variants[0].name}` : ""}, repair ${repair ? "on" : "off"}\n`);

  let sentOne = false;
  const results = await runEval(list, {
    config: { url: env.url, model, apiKey: env.apiKey || undefined, streamUsage },
    registry,
    guide,
    variants: variants.length ? variants : undefined,
    userSuffix: env.userSuffix || undefined,
    repair,
    onCase: (r, i, n) => {
      if (r.supported === false) { console.log(`${String(i + 1).padStart(2)}/${n}  ${r.id.padEnd(18)} ${r.variant.padEnd(10)} not supported (needs ${r.unsupportedBy.join(", ")})`); return; }
      const mark = !r.ok ? "failed" : r.validFirst ? "valid" : r.validFinal ? "fixed" : `${r.problemsFinal} problems`;
      const extra = r.ok ? `${(r.totalMs / 1000).toFixed(1)} s${r.missing.length ? `, missing ${r.missing.join(", ")}` : ""}` : r.error ?? "";
      const firstSent = !sentOne;
      sentOne = true;
      console.log(`${String(i + 1).padStart(2)}/${n}  ${r.id.padEnd(18)} ${variants.length > 1 ? r.variant.padEnd(10) + " " : ""}${mark.padEnd(12)} ${extra}`);
      if (!r.ok && firstSent) {
        console.error(`\nThe first request failed, so the server is probably unreachable or the model isn't loaded. Stopping.`);
        process.exit(1);
      }
    },
  });

  const date = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const dir = resolve(__dirname, "..", "eval", "results", `${date}-${model.replace(/[^\w.-]+/g, "_")}`);
  mkdirSync(dir, { recursive: true });
  const md = report(results, { model, url: env.url, date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", guideTokens, repair });
  writeFileSync(resolve(dir, "report.md"), md);
  writeFileSync(resolve(dir, "results.json"), JSON.stringify({
    model, url: env.url, repair, streamUsage,
    variants: (variants.length ? variants : [{ name: "default", guide }]).map((v) => ({ ...v, summary: summarize(results.filter((r) => r.variant === v.name)) })),
    summary: summarize(results),
    results,
  }, null, 2));
  for (const r of results) {
    const base = variants.length > 1 ? `${r.id}.${r.variant}` : r.id;
    if (r.firstSpec) writeFileSync(resolve(dir, `${base}.first.loom`), r.firstSpec);
    if (r.finalSpec && r.finalSpec !== r.firstSpec) writeFileSync(resolve(dir, `${base}.final.loom`), r.finalSpec);
    // Everything the model sent for the first answer, thinking included, to diagnose empty or odd answers.
    if (r.firstRaw) writeFileSync(resolve(dir, `${base}.raw.txt`), r.firstRaw);
  }
  console.log("\n" + md.split("\n| Request |")[0]);
  console.log(`Full report: ${dir}/report.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
