<script setup lang="ts">
import { withBase } from "vitepress";
import { examples } from "../../../examples/catalog";
import GalleryItem from "./GalleryItem.vue";
</script>

<template>
  <div class="gallery">
    <header class="gallery-head">
      <h1>Examples</h1>
      <p>
        Each example is a saved SayShape spec rendered by the real engine in your browser. They were written for this site, not generated
        live, and every name, price and record in them is made up. Nothing here is connected to a backend: when a spec emits an event,
        this page shows it and stops there.
      </p>
      <nav class="gallery-index" aria-label="Examples on this page">
        <a v-for="e in examples" :key="e.id" :href="`#${e.id}`">{{ e.title }}</a>
      </nav>
    </header>
    <GalleryItem v-for="e in examples" :key="e.id" :example="e" />
    <p class="gallery-foot">
      Want to change one? Open it in the <a :href="withBase('/playground.html')">playground</a>, or read how the
      <a :href="withBase('/docs/language/elements.html')">language</a> works.
    </p>
  </div>
</template>

<style scoped>
.gallery { max-width: 1240px; margin: 0 auto; padding: 40px 32px 72px }
.gallery-head { margin-bottom: 24px }
.gallery-head h1 { font-family: var(--loom-display); font-weight: 800; font-size: clamp(36px, 5vw, 56px); letter-spacing: -0.03em; margin: 0 0 14px; line-height: 1.05 }
.gallery-head p { margin: 0; max-width: 72ch; color: var(--vp-c-text-2); line-height: 1.65; font-size: 16.5px }
.gallery-index { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 22px; font-size: 14px }
.gallery-index a { color: var(--vp-c-brand-1); font-weight: 600; text-decoration: none }
.gallery-index a:hover { text-decoration: underline; text-underline-offset: 3px }
.gallery-foot { border-top: 1px solid var(--vp-c-divider); padding-top: 28px; color: var(--vp-c-text-2) }
.gallery-foot a { color: var(--vp-c-brand-1); font-weight: 600 }
@media (max-width: 900px) { .gallery { padding: 28px 20px 56px } }
</style>
