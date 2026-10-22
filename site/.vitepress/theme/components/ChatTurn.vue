<script setup lang="ts">
/**
 * One reply in the chat: the interface the model wrote, rendered by its own
 * SayShape instance while the spec streams in, with the spec beneath it.
 * The parent owns the turn's data; this component turns it into engine
 * calls: beginStream on start and on reset, push for new text, and the
 * final spec when the reply is done.
 */
import { computed, ref, watch } from "vue";
import { withBase } from "vitepress";
import { highlightSpec } from "../loom/highlight";
import { useLoom } from "../loom/useLoom";
import { toBase64Url } from "../loom/runtime";
import { onHostEvents, type HostEvent } from "../loom/events";

export interface Turn {
  id: number;
  request: string;
  /** "change" when it refined the interface before it. */
  kind: "new" | "change";
  /** The spec so far; replaced, not appended, when a repair starts over. */
  text: string;
  /** Increments when the stream starts over (a repair). */
  resets: number;
  status: string;
  state: "streaming" | "done" | "failed" | "stopped";
  problems?: number;
}

const props = defineProps<{ turn: Turn }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const showSpec = ref(false);
const copied = ref("");
const events = ref<HostEvent[]>([]);
let pushed = 0;
let resetsSeen = 0;

const html = computed(() => highlightSpec(props.turn.text.replace(/\n$/, "")));
const hasInterface = computed(() => props.turn.text.trim().length > 0);
const playgroundHref = computed(() => withBase("/playground.html") + "#spec=" + toBase64Url(props.turn.text));

const { loom } = useLoom(canvas, (l) => {
  const off = onHostEvents(l, (e) => { events.value = [e, ...events.value].slice(0, 3); });
  l.beginStream();
  sync();
  return off;
});

/** Bring the engine up to date with the turn: new text, a restart, or the end. */
function sync() {
  const l = loom.value;
  if (!l) return;
  const t = props.turn;
  if (t.resets !== resetsSeen) { resetsSeen = t.resets; pushed = 0; l.beginStream(); }
  if (t.text.length > pushed) { l.push(t.text.slice(pushed)); pushed = t.text.length; }
  if (t.state !== "streaming" && l.isStreaming) {
    l.endStream();
    if (l.spec !== t.text) l.setSpec(t.text);
  }
}

watch(() => [props.turn.text, props.turn.resets, props.turn.state], sync);

async function copy() {
  try { await navigator.clipboard.writeText(props.turn.text); copied.value = "Copied"; }
  catch { copied.value = "Couldn't copy"; }
  setTimeout(() => { copied.value = ""; }, 1800);
}
</script>

<template>
  <article class="ct" :aria-busy="turn.state === 'streaming'">
    <div class="ct-ask">
      <span class="ct-kind">{{ turn.kind === "change" ? "Change" : "New interface" }}</span>
      <p>{{ turn.request }}</p>
    </div>
    <div class="ct-reply">
      <p class="ct-status" :class="turn.state" role="status" aria-live="polite">
        <span v-if="turn.state === 'streaming'" class="ct-dot" aria-hidden="true"></span>{{ turn.status }}
      </p>
      <div v-show="hasInterface" class="loom-stage ct-stage">
        <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="`Interface for: ${turn.request}. Drawn on a canvas; the spec below is its readable source.`"></canvas></div>
      </div>
      <ol v-if="events.length" class="loom-events" aria-label="Events sent to this page">
        <li v-for="e in events" :key="e.id"><code>{{ e.text }}</code><span v-if="e.kind === 'emit'">, received by this page and not sent anywhere</span></li>
      </ol>
      <div v-if="hasInterface && turn.state !== 'streaming'" class="ct-actions">
        <button class="loom-btn-text" type="button" :aria-expanded="showSpec" @click="showSpec = !showSpec">{{ showSpec ? "Hide spec" : "View spec" }}</button>
        <button class="loom-btn-text" type="button" @click="copy">{{ copied || "Copy spec" }}</button>
        <a class="loom-btn-text" :href="playgroundHref">Open in playground</a>
        <button class="loom-btn-text" type="button" :disabled="!loom" @click="loom?.setSpec(turn.text, { resetState: true })">Reset</button>
      </div>
      <pre v-if="hasInterface && (showSpec || turn.state === 'streaming')" class="spec-view numbered ct-spec" tabindex="0" aria-label="The spec the model wrote"><code v-html="html"></code></pre>
    </div>
  </article>
</template>

<style scoped>
.ct { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; min-width: 0 }
.ct-ask { justify-self: end; max-width: min(560px, 86%); background: var(--loom-panel); border: 1px solid var(--vp-c-divider); border-radius: 14px 14px 4px 14px; padding: 10px 14px 12px }
.ct-ask p { margin: 2px 0 0; font-size: 15.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere }
.ct-kind { font-size: 12px; font-weight: 600; color: var(--vp-c-text-2) }
.ct-reply { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0 }
.ct-status { margin: 0; font-size: 13.5px; color: var(--vp-c-text-2); display: flex; align-items: center; gap: 8px }
.ct-status.failed { color: var(--loom-bad); font-weight: 600 }
.ct-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vp-c-brand-1); animation: ct-pulse 1s ease-in-out infinite }
@keyframes ct-pulse { 50% { opacity: 0.25 } }
.ct-stage { border: 1px solid var(--vp-c-divider); border-radius: 14px }
.ct-actions { display: flex; flex-wrap: wrap; gap: 6px 18px }
.ct-spec { margin: 0; padding: 10px 0 12px; max-height: 320px; overflow: auto; background: var(--loom-code-bg); border: 1px solid var(--vp-c-divider); border-radius: 10px; font-size: 12.5px }
.loom-events { border: 0; padding: 0 !important; list-style: none; margin: 0; font-size: 13px; color: var(--vp-c-text-2) }
</style>
