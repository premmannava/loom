<script setup lang="ts">
import { withBase } from "vitepress";
import { generationAvailable } from "../loom/generate";
import Workbench from "./Workbench.vue";
import { highlightSpec } from "../loom/highlight";

const REPO = "https://github.com/premmannava/sayshape";

const concepts = [
  {
    name: "State",
    text: "Values the interface can change, declared on state lines. Controls write to them through bind=, and they can hold lists and records.",
    code: `state qty=2 gift=false\nstepper "Quantity" bind=qty min=1`,
  },
  {
    name: "Derived values",
    text: "Read-only values worked out from state and kept current. Totals, filtered lists and chart data are written once and shared.",
    code: `derive subtotal={qty * 24}\nderive total={subtotal + (gift ? 4 : 0)}`,
  },
  {
    name: "Components",
    text: "Forty built-in elements, from rows and cards to tables, charts, selects and date pickers. Each is reviewed TypeScript; a spec can only use them.",
    code: `table items=orders key=id sort=by direction=dir\n  table-column "Total" field=total format=money`,
  },
  {
    name: "Themes",
    text: "Specs choose roles like tone=good or variant=secondary, never colors or sizes. Your app picks the theme, so every generated screen matches it.",
    code: `text "Paid" tone=good\nbutton "Cancel" variant=secondary`,
  },
  {
    name: "Host actions",
    text: "Local actions change state. emit: hands a choice to your app, which decides what actually happens: save, call an API, ask the model again.",
    code: `button "Place order" on="emit:order:{qty}"`,
  },
];

const uses = [
  { title: "Calculators and quotes", text: "Inputs, sliders and derived totals that update as people adjust them.", id: "tip-calculator" },
  { title: "Checklists and editable lists", text: "Lists held in state that people tick off, add to and remove from.", id: "grocery-checklist" },
  { title: "Dashboards over your data", text: "Bar and line charts, stats and sortable tables that read the same filtered list.", id: "monthly-budget" },
  { title: "Forms and requests", text: "Selects, date pickers, text fields and steppers, with the result handed to your app.", id: "equipment-request" },
  { title: "Multi-step flows", text: "Several screens sharing one state, like configure, then review a cart.", id: "product-builder" },
  { title: "Lookup tables", text: "Search as you type, filter by category, sort any column, select a row.", id: "equipment-table" },
];

const works = [
  "Parser with line-numbered diagnostics; a bad line is skipped, never fatal",
  "Layout, painting, hit testing, pointer and keyboard focus, all on one canvas",
  "State, derived values, lists, conditions, screens and actions",
  "40 components, including tables, bar and line charts, selects, a date picker and text input",
  "A generated model guide (full and compact) and a model client that streams, checks and repairs once",
  "Unit, contract, streaming, fuzz and visual tests",
];
const notYet = [
  "Screen reader support. Canvas content is not exposed to assistive technology yet",
  "Scrolling regions, dialogs, menus and tooltips",
  "Multi-line text and form validation",
  "Tables beyond 200 rows, charts beyond one bar or line series",
  "An npm package, and a production model server",
];

const href = (p: string) => withBase(p);
</script>

<template>
  <div class="landing">
    <header class="hero">
      <h1 class="hero-title">A UI language for&nbsp;AI. An engine that brings it to&nbsp;life.</h1>
      <div class="hero-side">
        <p class="hero-lede">
          Turn compact, declarative specs into interactive interfaces, with components, state, calculations and actions powered by SayShape.
          A model writes a few lines of text; SayShape parses them, lays them out, paints them on a canvas and runs them.
        </p>
        <div class="hero-cta">
          <a class="loom-btn primary" :href="href('/playground.html')">Try the playground</a>
          <a class="loom-btn quiet" :href="href('/docs/')">Read the docs</a>
          <a v-if="generationAvailable" class="loom-btn quiet" :href="href('/chat.html')">Build with AI</a>
        </div>
        <p class="hero-status">Early prototype, v0.1. Open source under MIT. <a :href="href('/docs/architecture/limitations.html')">What works and what doesn't</a>.</p>
      </div>
    </header>

    <Workbench />

    <section class="block split" aria-labelledby="two-halves">
      <div class="split-head">
        <h2 id="two-halves">The model writes the spec. SayShape runs it.</h2>
        <p>
          These are separate jobs. A model only produces text in SayShape's language. It never writes code, styles or components.
          SayShape's engine, running in the browser, turns that text into a working interface and keeps it working: totals recalculate,
          lists change, screens switch, all without going back to the model.
        </p>
      </div>
      <ol class="pipeline" aria-label="From request to interface">
        <li class="stage generated"><span class="stage-name">Request</span><span class="stage-text">Someone asks for an interface</span></li>
        <li class="stage generated"><span class="stage-name">Model</span><span class="stage-text">Your model, guided by a reference generated from SayShape's components</span></li>
        <li class="stage handoff"><span class="stage-name">SayShape spec</span><span class="stage-text">Plain text: elements, state, expressions, actions. No code</span></li>
        <li class="stage engine"><span class="stage-name">Engine</span><span class="stage-text">Parses, validates, lays out and paints on a canvas</span></li>
        <li class="stage engine"><span class="stage-name">Interactive interface</span><span class="stage-text">State and actions run locally; emit: events reach your app</span></li>
      </ol>
      <div class="pipeline-legend" aria-hidden="true">
        <span class="lg generated">Written by a model</span>
        <span class="lg engine">Rendered and run by SayShape</span>
      </div>
      <p class="split-foot">
        Because each line stands alone, a half-finished response is still a valid, smaller screen, so the interface can appear while the model is
        still writing. Specs can't run JavaScript: expressions go through SayShape's own evaluator, which can only read state, do arithmetic and call
        a fixed list of functions. <a :href="href('/docs/getting-started/pipeline.html')">How the pipeline works</a>
      </p>
    </section>

    <section class="block" aria-labelledby="concepts">
      <h2 id="concepts">What a spec can say</h2>
      <dl class="concepts">
        <div v-for="c in concepts" :key="c.name" class="concept">
          <dt>{{ c.name }}</dt>
          <dd>
            <p>{{ c.text }}</p>
            <pre class="spec-view mini" tabindex="0" :aria-label="`${c.name} example`"><code v-html="highlightSpec(c.code)"></code></pre>
          </dd>
        </div>
      </dl>
      <p class="more"><a :href="href('/docs/language/elements.html')">Learn the language</a></p>
    </section>

    <section class="block" aria-labelledby="uses">
      <h2 id="uses">What you can build with it today</h2>
      <p class="block-intro">Each of these is a working example in the gallery, using only features that exist now. Data in the examples is fictional.</p>
      <ul class="uses">
        <li v-for="u in uses" :key="u.id">
          <a :href="href(`/examples/#${u.id}`)">
            <span class="use-title">{{ u.title }}</span>
            <span class="use-text">{{ u.text }}</span>
          </a>
        </li>
      </ul>
    </section>

    <section class="block status" aria-labelledby="status">
      <h2 id="status">Current status and limitations</h2>
      <p class="block-intro">
        SayShape is a prototype. It isn't published to npm, and it shouldn't be used where accessibility is required until the accessibility layer exists.
      </p>
      <div class="status-cols">
        <div>
          <h3>Works today</h3>
          <ul><li v-for="w in works" :key="w">{{ w }}</li></ul>
        </div>
        <div>
          <h3>Not built yet</h3>
          <ul><li v-for="n in notYet" :key="n">{{ n }}</li></ul>
        </div>
      </div>
    </section>

    <section class="block closing" aria-labelledby="start">
      <h2 id="start">Start with a spec</h2>
      <div class="closing-links">
        <a class="loom-btn primary" :href="href('/playground.html')">Try the playground</a>
        <a class="loom-btn quiet" :href="href('/docs/getting-started/setup.html')">Quickstart</a>
        <a class="loom-btn quiet" :href="href('/examples/')">Examples</a>
        <a class="loom-btn quiet" :href="REPO">Source on GitHub</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing { max-width: 1240px; margin: 0 auto; padding: 40px 32px 72px }

.hero { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px 56px; align-items: end; margin-bottom: 36px }
.hero-title {
  font-family: var(--loom-display);
  font-weight: 800;
  font-size: clamp(38px, 5.4vw, 68px);
  line-height: 1.02;
  letter-spacing: -0.03em;
  margin: 0;
  text-wrap: balance;
}
.hero-lede { margin: 0 0 20px; font-size: 17px; line-height: 1.6; color: var(--vp-c-text-2); max-width: 54ch }
.hero-cta { display: flex; flex-wrap: wrap; gap: 10px }
.hero-status { margin: 16px 0 0; font-size: 13.5px; color: var(--vp-c-text-2) }
.hero-status a, .split-foot a, .more a { color: var(--vp-c-brand-1); font-weight: 600; text-underline-offset: 3px }

.block { margin-top: 96px }
.block h2 {
  font-family: var(--loom-display);
  font-weight: 700;
  font-size: clamp(26px, 3vw, 36px);
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 14px;
}
.block-intro { margin: 0 0 28px; color: var(--vp-c-text-2); max-width: 68ch; line-height: 1.6 }

.split-head { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px 56px; align-items: start; margin-bottom: 36px }
.split-head p { margin: 4px 0 0; color: var(--vp-c-text-2); line-height: 1.65; max-width: 66ch }

.pipeline { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; position: relative }
.stage { position: relative; padding: 18px 18px 18px 0; display: grid; gap: 6px; align-content: start }
.stage::before {
  content: "";
  display: block;
  height: 3px;
  border-radius: 2px;
  margin-bottom: 14px;
  margin-right: 10px;
  background: var(--vp-c-border);
}
.stage.engine::before { background: var(--vp-c-brand-1) }
.stage.handoff::before { background: linear-gradient(90deg, var(--vp-c-border) 50%, var(--vp-c-brand-1) 50%) }
.stage:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 13px;
  right: 2px;
  width: 9px;
  height: 9px;
  border-top: 2px solid var(--vp-c-text-3);
  border-right: 2px solid var(--vp-c-text-3);
  transform: rotate(45deg);
}
.stage-name { font-weight: 700; font-size: 16px }
.stage.handoff .stage-name { font-family: var(--vp-font-family-mono); font-weight: 500; color: var(--vp-c-brand-1) }
.stage-text { font-size: 14px; color: var(--vp-c-text-2); line-height: 1.5; max-width: 24ch }
.pipeline-legend { display: grid; grid-template-columns: 2fr 1fr 2fr; margin-top: 8px; font-size: 13px; color: var(--vp-c-text-2) }
.pipeline-legend .engine { grid-column: 3 }
.lg::before { content: ""; display: inline-block; width: 18px; height: 3px; border-radius: 2px; margin-right: 8px; vertical-align: middle; background: var(--vp-c-border) }
.lg.engine::before { background: var(--vp-c-brand-1) }
.split-foot { margin: 32px 0 0; color: var(--vp-c-text-2); line-height: 1.65; max-width: 80ch }

.concepts { margin: 8px 0 0; border-top: 1px solid var(--vp-c-divider) }
.concept { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 9fr); gap: 8px 40px; padding: 22px 0; border-bottom: 1px solid var(--vp-c-divider) }
.concept dt { font-weight: 700; font-size: 17px }
.concept dd { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 32px; align-items: start }
.concept p { margin: 0; color: var(--vp-c-text-2); line-height: 1.6 }
.spec-view.mini { background: var(--loom-code-bg); border: 1px solid var(--vp-c-divider); border-radius: 8px; padding: 10px 14px; overflow-x: auto; font-size: 12.5px }
.more { margin: 20px 0 0 }

.uses { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--vp-c-divider); border-left: 1px solid var(--vp-c-divider) }
.uses li { border-right: 1px solid var(--vp-c-divider); border-bottom: 1px solid var(--vp-c-divider) }
.uses a { display: grid; gap: 6px; padding: 20px 22px 22px; height: 100%; color: inherit; text-decoration: none }
.uses a:hover { background: var(--loom-panel) }
.uses a:hover .use-title { color: var(--vp-c-brand-1) }
.use-title { font-weight: 700; font-size: 16px }
.use-text { font-size: 14px; color: var(--vp-c-text-2); line-height: 1.55 }

.status-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 56px }
.status h3 { font-size: 16px; margin: 0 0 10px }
.status ul { margin: 0; padding-left: 18px; color: var(--vp-c-text-2); line-height: 1.6 }
.status li { margin: 6px 0 }
.status li::marker { color: var(--vp-c-text-3) }

.closing { border-top: 1px solid var(--vp-c-divider); padding-top: 40px; display: flex; flex-wrap: wrap; gap: 20px 40px; align-items: center; justify-content: space-between }
.closing h2 { margin: 0 }
.closing-links { display: flex; flex-wrap: wrap; gap: 10px }

@media (max-width: 960px) {
  .landing { padding: 28px 20px 56px }
  .hero, .split-head { grid-template-columns: 1fr }
  .pipeline { grid-template-columns: 1fr }
  .stage { grid-template-columns: 22px 1fr; column-gap: 14px; padding: 0 0 22px }
  .stage::before { grid-row: 1 / span 2; width: 3px; height: auto; margin: 4px 0 0 9px }
  .stage:not(:last-child)::after { top: auto; bottom: 6px; left: 5px; right: auto; transform: rotate(135deg) }
  .stage-text { max-width: none }
  .pipeline-legend { grid-template-columns: 1fr; gap: 6px }
  .pipeline-legend .engine { grid-column: 1 }
  .concept, .concept dd { grid-template-columns: 1fr }
  .uses { grid-template-columns: 1fr }
  .status-cols { grid-template-columns: 1fr }
  .block { margin-top: 72px }
}
@media (min-width: 961px) and (max-width: 1180px) {
  .uses { grid-template-columns: repeat(2, minmax(0, 1fr)) }
}
</style>
