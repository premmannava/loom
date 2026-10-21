/**
 * Compares two benchmark runs saved with `npm run bench -- --outputJson`:
 *
 *   vite-node scripts/compare-bench.ts base.json head.json [--fail]
 *
 * Prints a table of median times and flags anything more than 20% slower.
 * Shared CI machines are noisy, so slowdowns are warnings unless --fail is
 * given. In GitHub Actions the table also goes to the job summary.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const THRESHOLD = 1.2;

interface BenchFile {
  files: Array<{ groups: Array<{ fullName: string; benchmarks: Array<{ name: string; median: number }> }> }>;
}

function medians(path: string): Map<string, number> {
  const data = JSON.parse(readFileSync(path, "utf8")) as BenchFile;
  const out = new Map<string, number>();
  for (const f of data.files) {
    for (const g of f.groups) {
      const group = g.fullName.split(" > ").slice(1).join(" > ");
      for (const b of g.benchmarks) out.set(`${group} › ${b.name}`, b.median);
    }
  }
  return out;
}

const [basePath, headPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const failOnSlowdown = process.argv.includes("--fail");
if (!basePath || !headPath) {
  console.error("Usage: vite-node scripts/compare-bench.ts base.json head.json [--fail]");
  process.exit(1);
}
if (!existsSync(basePath)) {
  console.log(`No base run at ${basePath} (the base may predate the benchmarks); nothing to compare.`);
  process.exit(0);
}

const base = medians(basePath);
const head = medians(headPath);
const fmt = (ms: number) => (ms >= 10 ? ms.toFixed(1) : ms.toFixed(2)) + " ms";
const rows: string[] = [];
const slower: string[] = [];

for (const [name, h] of head) {
  const b = base.get(name);
  if (b === undefined) { rows.push(`| ${name} | — | ${fmt(h)} | new |`); continue; }
  const ratio = h / b;
  const change = `${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(0)}%`;
  const flag = ratio > THRESHOLD ? " ⚠️" : "";
  if (ratio > THRESHOLD) slower.push(`${name}: ${fmt(b)} → ${fmt(h)} (${change})`);
  rows.push(`| ${name} | ${fmt(b)} | ${fmt(h)} | ${change}${flag} |`);
}

const table = ["| Benchmark (median) | Base | This change | Change |", "|---|---|---|---|", ...rows].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Benchmarks\n\n${table}\n`);

for (const s of slower) console.log(`${process.env.GITHUB_ACTIONS ? "::warning::" : ""}More than 20% slower: ${s}`);
if (slower.length && failOnSlowdown) process.exit(1);
