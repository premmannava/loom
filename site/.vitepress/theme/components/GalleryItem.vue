<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";
import type { Example } from "../../../examples/catalog";
import { highlightSpec } from "../loom/highlight";
import { useLoom } from "../loom/useLoom";
import { onHostEvents, type HostEvent } from "../loom/events";

const props = defineProps<{ example: Example }>();

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const open = ref(false);
const copied = ref("");
const events = ref<HostEvent[]>([]);

const html = computed(() => highlightSpec(props.example.spec));
const lines = computed(() => props.example.spec.split("\n").length);
const playgroundHref = computed(() => withBase(`/playground.html?example=${props.example.id}`));
const sourceId = computed(() => `src-${props.example.id}`);

const { loom } = useLoom(canvas, (l) => {
  const off = onHostEvents(l, (e) => { events.value = [e, ...events.value].slice(0, 3); });
  l.setSpec(props.example.spec);
  return off;
}, { lazy: root });

function reset() {
  loom.value?.setSpec(props.example.spec, { resetState: true });
  events.value = [];
}

async function copy() {
  try {
    await navigator.clipboard.writeText(props.example.spec);
    copied.value = "Copied";
  } catch {
    copied.value = "Couldn't copy. Select the text instead.";
  }
  setTimeout(() => { copied.value = ""; }, 2000);
}
</script>

<template>
  <article :id="example.id" ref="root" class="gi">
    <div class="gi-info">
      <h2 class="gi-title"><a :href="`#${example.id}`" class="gi-anchor">{{ example.title }}</a></h2>
      <p class="gi-summary">{{ example.summary }}</p>
      <p class="gi-label">Shows</p>
      <ul class="gi-features">
        <li v-for="f in example.features" :key="f">{{ f }}</li>
      </ul>
      <p v-if="example.simulated" class="gi-sim"><strong>Simulated.</strong> {{ example.simulated }}</p>
      <div class="gi-actions">
        <button class="loom-btn quiet small" type="button" :aria-expanded="open" :aria-controls="sourceId" @click="open = !open">
          {{ open ? "Hide source" : "View source" }}
        </button>
        <a class="loom-btn quiet small" :href="playgroundHref">Open in playground</a>
        <button class="loom-btn quiet small" type="button" :disabled="!loom" @click="reset">Reset</button>
      </div>
    </div>
    <div class="gi-preview">
      <div class="loom-stage gi-stage">
        <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="`${example.title}, rendered by Loom on a canvas`"></canvas></div>
      </div>
      <ol v-if="events.length" class="loom-events" aria-live="polite" aria-label="Events sent to this page">
        <li v-for="e in events" :key="e.id"><code>{{ e.text }}</code><span v-if="e.kind === 'emit'">, received by this page and not sent anywhere</span></li>
      </ol>
    </div>
    <div v-show="open" :id="sourceId" class="gi-source">
      <div class="gi-source-head">
        <span>{{ lines }} lines of Loom</span>
        <button class="loom-btn-text" type="button" @click="copy">{{ copied || "Copy spec" }}</button>
      </div>
      <pre class="spec-view numbered" tabindex="0" :aria-label="`Loom spec for ${example.title}`"><code v-html="html"></code></pre>
    </div>
  </article>
</template>

<style scoped>
.gi {
  display: grid;
  grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
  border-top: 1px solid var(--vp-c-divider);
  padding: 40px 0;
  gap: 24px 48px;
  scroll-margin-top: 80px;
}
.gi-title { font-family: var(--loom-display); font-weight: 700; font-size: 26px; letter-spacing: -0.015em; margin: 0 0 10px; line-height: 1.2 }
.gi-anchor { color: inherit; text-decoration: none }
.gi-anchor:hover { color: var(--vp-c-brand-1) }
.gi-summary { margin: 0 0 18px; color: var(--vp-c-text-2); line-height: 1.6 }
.gi-label { margin: 0 0 6px; font-size: 13px; font-weight: 600 }
.gi-features { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px }
.gi-features li { font-size: 12.5px; padding: 3px 9px; border: 1px solid var(--vp-c-divider); border-radius: 6px; color: var(--vp-c-text-2); background: var(--loom-panel) }
.gi-sim { margin: 0 0 18px; font-size: 14px; color: var(--vp-c-text-2); border-left: 3px solid var(--loom-warn); padding-left: 12px; line-height: 1.55 }
.gi-sim strong { color: var(--vp-c-text-1) }
.gi-actions { display: flex; flex-wrap: wrap; gap: 8px }
.gi-preview { border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; align-self: start }
.gi-stage { min-height: 220px }
.gi-source { grid-column: 1 / -1; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; background: var(--loom-code-bg) }
.gi-source-head { display: flex; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--vp-c-divider); font-size: 13px; color: var(--vp-c-text-2) }
.gi-source pre { padding: 12px 0 16px; max-height: 540px; overflow: auto }

@media (max-width: 900px) {
  .gi { grid-template-columns: 1fr; padding: 32px 0 }
}
</style>
