<script setup lang="ts">
/** The engine's stages and its input loop, drawn to match src/engine.ts. */
const stages = [
  { name: "Spec text", note: "lines of Loom" },
  { name: "Parse", note: "tree + diagnostics" },
  { name: "Layout", note: "a box per element" },
  { name: "Paint", note: "canvas calls" },
  { name: "Canvas", note: "pixels" },
];
</script>

<template>
  <figure class="ed-fig">
    <svg viewBox="0 0 760 210" role="img" aria-labelledby="engine-diagram-title engine-diagram-desc">
      <title id="engine-diagram-title">Loom's rendering pipeline</title>
      <desc id="engine-diagram-desc">Spec text is parsed into a tree, laid out into boxes and painted onto the canvas. Pointer and keyboard input on the canvas runs actions, which change state, which causes a new layout.</desc>
      <defs>
        <marker id="ed-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" class="ed-arrowhead" />
        </marker>
      </defs>
      <g v-for="(s, i) in stages" :key="s.name" :transform="`translate(${i * 152}, 20)`">
        <rect x="0" y="0" width="128" height="62" rx="9" :class="i === 0 || i === 4 ? 'ed-box ed-end' : 'ed-box'" />
        <text x="64" y="27" class="ed-name" text-anchor="middle">{{ s.name }}</text>
        <text x="64" y="46" class="ed-note" text-anchor="middle">{{ s.note }}</text>
        <line v-if="i < 4" x1="130" y1="31" x2="150" y2="31" class="ed-line" marker-end="url(#ed-arrow)" />
      </g>
      <rect x="152" y="140" width="128" height="50" rx="9" class="ed-box ed-state" />
      <text x="216" y="170" class="ed-name" text-anchor="middle">State</text>
      <rect x="456" y="140" width="128" height="50" rx="9" class="ed-box" />
      <text x="520" y="162" class="ed-name" text-anchor="middle">Actions</text>
      <text x="520" y="180" class="ed-note" text-anchor="middle">on=, bind=</text>
      <path d="M672 84 V165 H588" class="ed-line" marker-end="url(#ed-arrow)" />
      <text x="680" y="128" class="ed-note">pointer, keys</text>
      <line x1="454" y1="165" x2="284" y2="165" class="ed-line" marker-end="url(#ed-arrow)" />
      <path d="M216 138 V112 H368 V84" class="ed-line ed-loop" marker-end="url(#ed-arrow)" />
      <text x="292" y="106" class="ed-note" text-anchor="middle">re-layout</text>
    </svg>
    <figcaption>Each stage reruns only when its input changes: editing the spec re-parses, a state change re-lays out, and hovering only repaints.</figcaption>
  </figure>
</template>

<style scoped>
.ed-fig { margin: 24px 0 }
svg { width: 100%; height: auto; display: block; font-family: var(--vp-font-family-base) }
.ed-box { fill: var(--vp-c-bg); stroke: var(--vp-c-border); stroke-width: 1.2 }
.ed-end { fill: var(--vp-c-bg-soft) }
.ed-state { stroke: var(--vp-c-brand-1) }
.ed-name { fill: var(--vp-c-text-1); font-size: 14px; font-weight: 600 }
.ed-note { fill: var(--vp-c-text-2); font-size: 12px }
.ed-line { stroke: var(--vp-c-text-3); stroke-width: 1.4; fill: none }
.ed-loop { stroke: var(--vp-c-brand-1) }
.ed-arrowhead { fill: var(--vp-c-text-3) }
figcaption { margin-top: 10px; font-size: 14px; color: var(--vp-c-text-2) }
</style>
