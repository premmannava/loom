/**
 * Runs the evaluation set against a model and writes a report:
 *
 *   npm run eval                       every request, the model from .env.local
 *   npm run eval -- --model qwen3-14b  a different model on the same server
 *   npm run eval -- --only form,trap   only some categories or request ids
 *   npm run eval -- --no-repair        first tries only
 *
 * Settings come from .env.local (see scripts/model-env.ts). Results go to
 * eval/results/<date>-<model>/: report.md, results.json, and each request's
 * first and final spec as .loom files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";
import { cases } from "../eval/cases";
import { report, runEval, summarize } from "../eval/run";
import { readModelEnv } from "./model-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
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

  const guide = { imageHosts: [] };
  const guideTokens = Math.round(languageGuide(registry, guide).length / 4);
  console.log(`Evaluating ${model} at ${env.url}: ${list.length} requests, repair ${repair ? "on" : "off"}\n`);

  const results = await runEval(list, {
    config: { url: env.url, model, apiKey: env.apiKey || undefined },
    registry,
    guide,
    userSuffix: env.userSuffix || undefined,
    repair,
    onCase: (r, i, n) => {
      const mark = !r.ok ? "failed" : r.validFirst ? "valid" : r.validFinal ? "fixed" : `${r.problemsFinal} problems`;
      const extra = r.ok ? `${(r.totalMs / 1000).toFixed(1)} s${r.missing.length ? `, missing ${r.missing.join(", ")}` : ""}` : r.error ?? "";
      console.log(`${String(i + 1).padStart(2)}/${n}  ${r.id.padEnd(18)} ${mark.padEnd(12)} ${extra}`);
      if (!r.ok && i === 0) {
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
  writeFileSync(resolve(dir, "results.json"), JSON.stringify({ model, url: env.url, repair, summary: summarize(results), results }, null, 2));
  for (const r of results) {
    if (r.firstSpec) writeFileSync(resolve(dir, `${r.id}.first.loom`), r.firstSpec);
    if (r.finalSpec && r.finalSpec !== r.firstSpec) writeFileSync(resolve(dir, `${r.id}.final.loom`), r.finalSpec);
    // Everything the model sent for the first answer, thinking included, to diagnose empty or odd answers.
    if (r.firstRaw) writeFileSync(resolve(dir, `${r.id}.raw.txt`), r.firstRaw);
  }
  console.log("\n" + md.split("\n| Request |")[0]);
  console.log(`Full report: ${dir}/report.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
