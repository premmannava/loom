<script setup lang="ts">
/**
 * The landing page's demo: a saved spec on one side, the real engine
 * rendering it on the other. On first view the spec is replayed in small
 * chunks, the way a model's response would stream in. Nothing is generated.
 */
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { withBase } from "vitepress";
import { heroExamples } from "../../../examples/catalog";
import { highlightSpec } from "../loom/highlight";
import { useLoom } from "../loom/useLoom";
import { prefersReducedMotion, replayStream } from "../loom/runtime";
import { onHostEvents, type HostEvent } from "../loom/events";

const active = ref(0);
const view = ref<"preview" | "spec">("preview");
const canvas = ref<HTMLCanvasElement | null>(null);
const shown = ref(heroExamples[0].example.spec);
const streaming = ref(false);
const lastEvent = shallowRef<HostEvent | null>(null);
let signal = { cancelled: false };

const current = computed(() => heroExamples[active.value]!.example);
const lines = computed(() => current.value.spec.split("\n").length);
const shownLines = computed(() => shown.value.split("\n").length);
const html = computed(() => highlightSpec(shown.value));
const playgroundHref = computed(() => withBase(`/playground.html?example=${current.value.id}`));
const status = computed(() => (streaming.value ? `Streaming line ${shownLines.value} of ${lines.value}` : `${lines.value} lines`));

const { loom } = useLoom(canvas, (l) => {
  const off = onHostEvents(l, (e) => { lastEvent.value = e; });
  void play(!prefersReducedMotion());
  return off;
});

async function play(stream: boolean) {
  const l = loom.value;
  if (!l) return;
  signal.cancelled = true;
  signal = { cancelled: false };
  lastEvent.value = null;
  const spec = current.value.spec;
  streaming.value = stream;
  const done = await replayStream(l, spec, { signal, instant: !stream, onProgress: (s) => { shown.value = s; } });
  if (done) { streaming.value = false; shown.value = spec; }
}

function choose(i: number) {
  if (i === active.value) return;
  active.value = i;
  shown.value = current.value.spec;
  void play(false);
}

function onTabKey(e: KeyboardEvent) {
  const n = heroExamples.length;
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
  if (e.key in moves) {
    e.preventDefault();
    const next = (active.value + moves[e.key]! + n) % n;
    choose(next);
    (document.getElementById(`wb-tab-${next}`) as HTMLButtonElement | null)?.focus();
  }
}

function resetState() {
  loom.value?.setSpec(current.value.spec, { resetState: true });
  lastEvent.value = null;
}

onBeforeUnmount(() => { signal.cancelled = true; });
</script>

<template>
  <section class="wb" aria-label="Live demo">
    <div class="wb-head">
      <div class="wb-tabs" role="tablist" aria-label="Example" @keydown="onTabKey">
        <button
          v-for="(h, i) in heroExamples"
          :id="`wb-tab-${i}`"
          :key="h.example.id"
          role="tab"
          type="button"
          :aria-selected="i === active"
          :tabindex="i === active ? 0 : -1"
          aria-controls="wb-panel"
          class="wb-tab"
          @click="choose(i)"
        >
          <span class="wb-tab-name">{{ h.example.title }}</span>
          <span class="wb-tab-shows">{{ h.shows }}</span>
        </button>
      </div>
      <div class="wb-view" role="group" aria-label="Show on small screens">
        <button type="button" :aria-pressed="view === 'preview'" @click="view = 'preview'">Interface</button>
        <button type="button" :aria-pressed="view === 'spec'" @click="view = 'spec'">Spec</button>
      </div>
    </div>

    <div id="wb-panel" class="wb-body" role="tabpanel" :aria-labelledby="`wb-tab-${active}`" :data-view="view">
      <div class="wb-spec">
        <div class="wb-pane-head">
          <span>Loom spec</span>
          <span class="wb-meta" aria-live="polite">{{ status }}</span>
        </div>
        <pre class="spec-view numbered wrap" :class="{ streaming }" tabindex="0" aria-label="The Loom spec for this interface"><code v-html="html"></code></pre>
      </div>
      <div class="wb-preview">
        <div class="wb-pane-head">
          <span>Rendered by the Loom engine</span>
          <span class="wb-meta">Interactive</span>
        </div>
        <div class="loom-stage wb-stage">
          <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="`${current.title}, rendered by Loom on a canvas. The spec is the readable source.`"></canvas></div>
        </div>
      </div>
    </div>

    <div class="wb-foot">
      <p class="wb-note">
        <strong>Saved spec, replayed as a stream.</strong>
        No model is called on this page; the text is the same each time. A model's response would arrive the same way, line by line.
        <span v-if="lastEvent" class="wb-event" aria-live="polite">Last event: <code>{{ lastEvent.text }}</code>, not sent anywhere.</span>
      </p>
      <div class="wb-actions">
        <button class="loom-btn quiet small" type="button" :disabled="!loom || streaming" @click="play(true)">Replay stream</button>
        <button class="loom-btn quiet small" type="button" :disabled="!loom" @click="resetState">Reset state</button>
        <a class="loom-btn quiet small" :href="playgroundHref">Edit in playground</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wb {
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg);
  box-shadow: var(--loom-shadow);
  overflow: hidden;
}
.wb-head { display: flex; align-items: stretch; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--vp-c-divider); background: var(--loom-panel) }
.wb-tabs { display: flex; overflow-x: auto }
.wb-tab {
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 12px 22px 11px;
  border: 0;
  border-right: 1px solid var(--vp-c-divider);
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  white-space: nowrap;
}
.wb-tab:hover { color: var(--vp-c-text-1) }
.wb-tab[aria-selected="true"] { background: var(--vp-c-bg); color: var(--vp-c-text-1); border-bottom-color: var(--vp-c-brand-1); margin-bottom: -1px }
.wb-tab-name { font-weight: 600; font-size: 15px }
.wb-tab-shows { font-size: 12.5px; color: var(--vp-c-text-2) }
.wb-tab:focus-visible { outline-offset: -3px }
.wb-view { display: none }

.wb-body { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); height: 600px }
.wb-spec, .wb-preview { display: flex; flex-direction: column; min-height: 0 }
.wb-spec { border-right: 1px solid var(--vp-c-divider); background: var(--loom-code-bg) }
.wb-pane-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-divider);
}
.wb-meta { font-weight: 400; color: var(--vp-c-text-2); font-variant-numeric: tabular-nums }
.wb-spec pre { flex: 1; overflow: auto; padding: 14px 0 24px }
.wb-spec pre:focus-visible { outline-offset: -2px }
.spec-view.wrap :deep(.line) { white-space: pre-wrap; overflow-wrap: anywhere; padding-left: 3.7em; text-indent: -3.7em }
.spec-view.streaming :deep(.line:last-child)::after {
  content: "";
  display: inline-block;
  width: 7px;
  height: 1.1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--vp-c-brand-1);
  animation: caret 0.9s steps(2) infinite;
}
@keyframes caret { 50% { opacity: 0 } }
.wb-stage { flex: 1; overflow: auto }

.wb-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--loom-panel);
}
.wb-note { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--vp-c-text-2); max-width: 70ch }
.wb-note strong { color: var(--vp-c-text-1); font-weight: 600 }
.wb-event { display: block; margin-top: 2px }
.wb-event code { font-size: 12px; color: var(--vp-c-brand-1) }
.wb-actions { display: flex; flex-wrap: wrap; gap: 8px }

@media (max-width: 860px) {
  .wb-head { flex-direction: column; gap: 0 }
  .wb-tab { padding: 10px 16px 9px; flex: 1 }
  .wb-view { display: flex; gap: 4px; padding: 8px 12px; border-top: 1px solid var(--vp-c-divider) }
  .wb-view button {
    flex: 1;
    height: 34px;
    border: 1px solid var(--vp-c-border);
    border-radius: 8px;
    background: var(--vp-c-bg);
    color: var(--vp-c-text-2);
    font: 600 13px var(--vp-font-family-base);
    cursor: pointer;
  }
  .wb-view button[aria-pressed="true"] { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1) }
  .wb-body { grid-template-columns: 1fr; height: auto }
  .wb-body[data-view="preview"] .wb-spec, .wb-body[data-view="spec"] .wb-preview { display: none }
  .wb-spec { border-right: 0 }
  .wb-spec pre { max-height: 520px }
  .wb-stage { max-height: 640px }
}
</style>
