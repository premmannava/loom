<script setup lang="ts">
/**
 * A documentation example: the highlighted spec (slot) with the same spec
 * rendered live by the SayShape engine underneath. Created by ```loom live fences.
 */
import { computed, ref, shallowRef } from "vue";
import { withBase } from "vitepress";
import { useLoom } from "../loom/useLoom";
import { fromBase64, usesMap } from "../loom/runtime";
import { onHostEvents, type HostEvent } from "../loom/events";
import type { Diagnostic } from "@loom/index";

const props = defineProps<{ spec: string }>();

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const problems = shallowRef<Diagnostic[]>([]);
const events = ref<HostEvent[]>([]);
// Decoding is plain string work, so the playground link is in the static HTML too.
const source = computed(() => decode(props.spec));
const playgroundHref = computed(() => withBase("/playground.html") + "#spec=" + props.spec.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));

function decode(b64: string): string {
  if (typeof atob === "function") return fromBase64(b64);
  return Buffer.from(b64, "base64").toString("utf8");
}

const { loom, failed } = useLoom(canvas, (l) => {
  const offDiag = l.on("diagnostics", (d) => { problems.value = d; });
  const offEvents = onHostEvents(l, (e) => { events.value = [e, ...events.value].slice(0, 3); });
  l.setSpec(source.value);
  l.renderNow();
  problems.value = l.diagnostics;
  return () => { offDiag(); offEvents(); };
}, { lazy: root, map: usesMap(source.value) });

function reset() {
  loom.value?.setSpec(source.value, { resetState: true });
  events.value = [];
}
</script>

<template>
  <div ref="root" class="loom-live">
    <div class="loom-live__code"><slot /></div>
    <div class="loom-live__result">
      <div class="loom-live__bar">
        <span class="loom-live__label"><span class="dot" aria-hidden="true"></span>Rendered by the SayShape engine</span>
        <span class="loom-live__actions">
          <button type="button" class="loom-btn-text" :disabled="!loom" @click="reset">Reset</button>
          <a class="loom-btn-text" :href="playgroundHref">Open in playground</a>
        </span>
      </div>
      <div class="loom-stage">
        <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="'Live preview of the example above, drawn on a canvas'"></canvas></div>
        <p v-if="failed" class="loom-live__failed">The preview couldn't start: {{ failed }}</p>
      </div>
      <ul v-if="problems.length" class="loom-diags" aria-label="Problems the parser reported">
        <li v-for="d in problems" :key="d.line + d.message" :class="d.severity">
          <span class="ln">Line {{ d.line }}</span><span class="sev">{{ d.severity }}</span><span class="msg">{{ d.message }}</span>
        </li>
      </ul>
      <ol v-if="events.length" class="loom-events" aria-live="polite" aria-label="Events sent to the host page">
        <li v-for="e in events" :key="e.id"><code>{{ e.text }}</code><span v-if="e.kind === 'emit'">, received by this page and not sent anywhere</span></li>
      </ol>
    </div>
  </div>
</template>
