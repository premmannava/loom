/**
 * Measures the model guide: characters and an estimate of tokens, by section,
 * for the configurations people use.
 *
 *   npm run guide:size
 *
 * Tokens are estimated as characters / 4. That is a rough rule for English
 * text with an unknown tokenizer, not a count: real numbers come from a
 * provider's usage report (npm run eval records them when the server sends them).
 */
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { languageGuide, guideSections, WORKED_EXAMPLES, type GuideOptions } from "../src/prompt";
import { refineMessages, type RefineContext } from "../src/model/context";
import type { ChatMessage } from "../src/model/stream";
import { Registry } from "../src/registry";

const all = new Registry([...coreComponents, ...mapComponents]);
const est = (chars: number) => Math.round(chars / 4);

const configs: Array<[string, GuideOptions]> = [
  ["full (default)", {}],
  ["full, no component examples", { examples: false }],
  ["full, profile: forms", { profile: "forms" }],
  ["full, profile: shop", { profile: "shop" }],
  ["compact", { mode: "compact" }],
  ["compact, profile: forms", { mode: "compact", profile: "forms" }],
  ["compact, profile: lists", { mode: "compact", profile: "lists" }],
  ["compact, profile: shop", { mode: "compact", profile: "shop" }],
];

const playground = { imageHosts: ["images.unsplash.com"] };
const rows: string[] = [];
for (const [name, opts] of configs) {
  const o = { ...playground, ...opts };
  let text: string;
  try { text = languageGuide(all, o); } catch (e) { rows.push(`| ${name} | ${(e as Error).message} | | |`); continue; }
  rows.push(`| ${name} | ${text.length.toLocaleString("en-US")} | ~${est(text.length).toLocaleString("en-US")} | ${guideSections(all, o).map((s) => `${s.name} ${s.text.length}`).join(", ")} |`);
}
console.log("| Guide | Characters | Tokens (estimated, chars/4) | Sections (characters) |\n|---|---|---|---|\n" + rows.join("\n"));

// What a refinement sends besides the guide, after some number of changes:
// replaying the whole conversation (what the playground did) versus a
// RefineContext. Each screen is the todo worked example, each request ~60 chars.
const spec = WORKED_EXAMPLES.todo + "\n";
const req = (i: number) => `Change ${String(i).padStart(2, "0")}: make the list a little different please`;
const chars = (m: ChatMessage[]) => m.reduce((n, x) => n + x.content.length, 0);
const out: string[] = [];
for (const turns of [1, 3, 10, 30]) {
  const replay: ChatMessage[] = [];
  for (let i = 0; i < turns; i++) replay.push({ role: "user", content: req(i) }, { role: "assistant", content: spec });
  replay.push({ role: "user", content: req(turns) });
  const ctx: RefineContext = { task: req(0), changes: Array.from({ length: turns - 1 }, (_, i) => req(i + 1)), spec };
  const bounded = refineMessages(ctx, req(turns)).messages;
  out.push(`| ${turns} | ${chars(replay).toLocaleString("en-US")} | ${chars(bounded).toLocaleString("en-US")} |`);
}
console.log(`\nContext sent with a refinement, besides the guide (characters; a ${spec.length}-character screen):\n\n| Earlier turns | Whole conversation | Bounded (refine) |\n|---|---|---|\n${out.join("\n")}`);
