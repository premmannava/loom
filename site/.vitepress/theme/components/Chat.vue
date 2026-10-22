<script setup lang="ts">
/**
 * The chat page: describe an interface, a model writes the SayShape spec
 * through the site's proxy (worker/), and the engine renders it in the
 * reply as it streams. Follow-up messages change the latest interface,
 * sending the first request, the changes since and the current spec.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref } from "vue";
import { withBase } from "vitepress";
import ChatTurn, { type Turn } from "./ChatTurn.vue";
import { generate, generationAvailable, humanCheck, MAX_REQUEST_CHARS, MODEL_LABEL, needsHumanCheck, type GenerateEvent, type Refinement } from "../loom/generate";

const suggestions = [
  "A tip calculator that splits the bill between friends",
  "A packing list for a weekend hike, with a progress bar",
  "A monthly budget with a category filter and a bar chart",
  "A sign-up form for a running club with a date picker",
];

const turns = ref<Turn[]>([]);
const draft = ref("");
const busy = ref(false);
const input = ref<HTMLTextAreaElement | null>(null);
const thread = ref<HTMLElement | null>(null);
const checkEl = ref<HTMLElement | null>(null);
/** What the next message changes, or null to start a new interface. */
const context = ref<Refinement | null>(null);
let check: ReturnType<typeof humanCheck> | null = null;
let controller: AbortController | null = null;
let nextId = 0;

const phaseText: Record<string, string> = {
  waiting: "Waiting for the model…",
  thinking: "The model is thinking before it writes…",
  writing: "Writing the interface…",
  repairing: "Fixing lines the parser skipped…",
};

const remaining = computed(() => MAX_REQUEST_CHARS - draft.value.length);
const placeholder = computed(() => (context.value ? "Describe a change, e.g. make the total stand out" : "Describe an interface…"));

function startCheck() {
  if (!needsHumanCheck || !checkEl.value) return;
  check ??= humanCheck(checkEl.value);
  check.start().catch(() => {});
}

function nearBottom() {
  const d = document.documentElement;
  return d.scrollHeight - (window.scrollY + window.innerHeight) < 240;
}
function toBottom() {
  void nextTick(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" }));
}

function newInterface() {
  context.value = null;
  input.value?.focus();
}

async function send(text = draft.value) {
  const request = text.trim();
  if (!request || busy.value) return;
  draft.value = "";
  busy.value = true;
  const refine = context.value ? { ...context.value } : undefined;
  const turn = reactive<Turn>({ id: ++nextId, request, kind: refine ? "change" : "new", text: "", resets: 0, status: phaseText.waiting!, state: "streaming" });
  turns.value.push(turn);
  toBottom();
  controller = new AbortController();
  const started = performance.now();
  try {
    const token = check ? await check.take() : undefined;
    await generate(request, {
      token,
      refine,
      signal: controller.signal,
      onEvent: (e: GenerateEvent) => {
        const follow = nearBottom();
        if (e.t === "phase" && phaseText[e.v]) turn.status = phaseText[e.v]!;
        else if (e.t === "text") turn.text += e.v;
        else if (e.t === "reset") { turn.text = ""; turn.resets++; }
        else if (e.t === "done") {
          turn.text = e.spec.endsWith("\n") ? e.spec : e.spec + "\n";
          turn.problems = e.problems;
          turn.state = "done";
          const secs = (e.ms / 1000).toFixed(1);
          turn.status = `Done in ${secs} s, ${e.problems ? `${e.problems} line${e.problems === 1 ? "" : "s"} flagged by the parser` : "no problems"}${e.repaired ? ", repaired once" : ""}.`;
          context.value = refine
            ? { task: refine.task, changes: [...refine.changes, request], spec: e.spec }
            : { task: request, changes: [], spec: e.spec };
        } else if (e.t === "error") { turn.state = "failed"; turn.status = e.message; }
        if (follow) toBottom();
      },
    });
    if (turn.state === "streaming") { turn.state = "failed"; turn.status = "The reply ended early. Try again."; }
  } catch {
    if (controller.signal.aborted) { turn.state = "stopped"; turn.status = turn.text.trim() ? "Stopped. What arrived is shown." : "Stopped."; }
    else { turn.state = "failed"; turn.status = "Couldn't reach the model service. Check your connection and try again."; }
  } finally {
    if (turn.state === "streaming") turn.state = "failed";
    // Keep the time even when it failed, so slow free-model replies are visible.
    if (turn.state !== "done" && !turn.status.includes(" s")) turn.status += ` (${((performance.now() - started) / 1000).toFixed(1)} s)`;
    busy.value = false;
    controller = null;
    void nextTick(() => input.value?.focus());
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

function grow() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

onBeforeUnmount(() => { controller?.abort(); check?.destroy(); });

const playground = withBase("/playground.html");
const docsModel = withBase("/docs/integration/model.html");
const docsLanguage = withBase("/docs/language/elements.html");
</script>

<template>
  <div class="chat">
    <header class="chat-head">
      <h1>Build with a model</h1>
      <p v-if="generationAvailable">
        Describe an interface. {{ MODEL_LABEL }} writes a SayShape spec, and SayShape renders and runs it right here, line by line as it
        arrives. Ask for changes and the latest interface is updated.
      </p>
      <p v-else>
        Generation isn't set up on this copy of the site. You can still edit specs in the <a :href="playground">playground</a>, or
        <a :href="docsModel">run generation locally</a> with your own model.
      </p>
    </header>

    <template v-if="generationAvailable">
      <section ref="thread" class="chat-thread" aria-label="Conversation" aria-live="off">
        <div v-if="!turns.length" class="chat-empty">
          <p class="chat-empty-lead">Try one of these, or write your own.</p>
          <ul class="chat-suggest">
            <li v-for="s in suggestions" :key="s"><button type="button" :disabled="busy" @click="send(s)">{{ s }}</button></li>
          </ul>
          <p class="chat-empty-note">
            The model only writes text in <a :href="docsLanguage">SayShape's language</a>. It can't run code or choose colors; the engine
            checks every line and draws the interface itself.
          </p>
        </div>
        <ChatTurn v-for="t in turns" :key="t.id" :turn="t" />
      </section>

      <form class="chat-compose" @submit.prevent="send()">
        <div v-if="context" class="chat-context">
          <span>Changing: <strong>{{ context.task }}</strong><template v-if="context.changes.length"> (+{{ context.changes.length }} change{{ context.changes.length === 1 ? "" : "s" }})</template></span>
          <button class="loom-btn-text" type="button" :disabled="busy" @click="newInterface">Start a new interface</button>
        </div>
        <div class="chat-box">
          <textarea
            ref="input"
            v-model="draft"
            rows="1"
            :maxlength="MAX_REQUEST_CHARS"
            :placeholder="placeholder"
            aria-label="Message"
            :disabled="busy"
            @keydown="onKey"
            @input="grow"
            @focus="startCheck"
          ></textarea>
          <button v-if="!busy" class="loom-btn primary" type="submit" :disabled="!draft.trim()">Send</button>
          <button v-else class="loom-btn quiet" type="button" @click="controller?.abort()">Stop</button>
        </div>
        <div ref="checkEl" class="chat-check"></div>
        <p class="chat-foot">
          <span :class="{ low: remaining < 40 }">{{ remaining }} characters left</span>
          Requests go to {{ MODEL_LABEL }} through OpenRouter; don't include anything private. It's a free model with a small daily limit
          shared by everyone, and results vary.
        </p>
      </form>
    </template>
  </div>
</template>

<style scoped>
.chat { max-width: 920px; margin: 0 auto; padding: 32px 24px 0; min-height: calc(100vh - var(--vp-nav-height, 64px)); display: flex; flex-direction: column }
.chat-head h1 { font-family: var(--loom-display); font-weight: 800; font-size: clamp(32px, 4.5vw, 48px); letter-spacing: -0.03em; line-height: 1.05; margin: 0 0 10px }
.chat-head p { margin: 0; max-width: 68ch; color: var(--vp-c-text-2); line-height: 1.6 }
.chat-head a, .chat-empty-note a { color: var(--vp-c-brand-1); font-weight: 600 }

.chat-thread { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 36px; padding: 32px 0 28px }
.chat-empty { display: grid; gap: 14px; padding: 8px 0 }
.chat-empty-lead { margin: 0; font-weight: 600 }
.chat-suggest { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px }
.chat-suggest button {
  width: 100%;
  height: 100%;
  text-align: left;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: 15px/1.45 var(--vp-font-family-base);
  cursor: pointer;
}
.chat-suggest button:hover:not(:disabled) { border-color: var(--vp-c-brand-1); background: var(--loom-panel) }
.chat-empty-note { margin: 4px 0 0; font-size: 14px; color: var(--vp-c-text-2); line-height: 1.6; max-width: 70ch }

.chat-compose {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: grid;
  gap: 8px;
  padding: 12px 0 16px;
  background: linear-gradient(to bottom, transparent, var(--vp-c-bg) 14px);
}
.chat-context { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; font-size: 13px; color: var(--vp-c-text-2) }
.chat-context strong { color: var(--vp-c-text-1); font-weight: 600 }
.chat-box { display: flex; gap: 10px; align-items: flex-end; padding: 10px; border: 1.5px solid var(--vp-c-border); border-radius: 16px; background: var(--vp-c-bg); box-shadow: var(--loom-shadow) }
.chat-box:focus-within { border-color: var(--vp-c-brand-1) }
.chat-box textarea {
  flex: 1;
  min-height: 40px;
  max-height: 180px;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font: 16px/1.5 var(--vp-font-family-base);
  padding: 8px 6px;
}
.chat-check:empty { display: none }
.chat-foot { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--vp-c-text-2) }
.chat-foot span { font-variant-numeric: tabular-nums; margin-right: 8px; font-weight: 600 }
.chat-foot span.low { color: var(--loom-warn) }

@media (max-width: 640px) {
  .chat { padding: 22px 16px 0 }
  .chat-suggest { grid-template-columns: 1fr }
}
</style>
