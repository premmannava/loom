/**
 * A Vue composable that owns one SayShape instance for a component: created in
 * the browser after mount (optionally only once it scrolls near the
 * viewport), kept in step with the site theme, and destroyed with every
 * listener removed when the component unmounts.
 */
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue";
import { createLoom, loomModules, watchSiteTheme, type CreateOptions, type SayShape, type LoomModules } from "./runtime";

export interface UseLoomOptions extends CreateOptions {
  /** Create the instance only when this element comes near the viewport. */
  lazy?: Ref<HTMLElement | null>;
  /** Follow the site's light/dark switch (default true). Return false while something else sets the theme. */
  followSiteTheme?: () => boolean;
}

type Setup = (loom: SayShape, mods: LoomModules) => void | (() => void);

export function useLoom(canvas: Ref<HTMLCanvasElement | null>, setup: Setup, opts: UseLoomOptions = {}) {
  const loom = shallowRef<SayShape | null>(null);
  const failed = shallowRef<string | null>(null);
  const cleanups: Array<() => void> = [];
  let alive = true;
  let observer: IntersectionObserver | null = null;

  async function start() {
    const el = canvas.value;
    if (!el || loom.value) return;
    try {
      const [instance, mods] = await Promise.all([createLoom(el, opts), loomModules()]);
      if (!alive) { instance.destroy(); return; }
      loom.value = instance;
      cleanups.push(watchSiteTheme(instance, { light: mods.lightTheme, dark: mods.darkTheme }, opts.followSiteTheme));
      const undo = setup(instance, mods);
      if (undo) cleanups.push(undo);
    } catch (e) {
      failed.value = e instanceof Error ? e.message : String(e);
    }
  }

  onMounted(() => {
    const target = opts.lazy?.value;
    if (target && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          void start();
        }
      }, { rootMargin: "400px 0px" });
      observer.observe(target);
    } else void start();
  });

  onBeforeUnmount(() => {
    alive = false;
    observer?.disconnect();
    cleanups.splice(0).forEach((f) => f());
    loom.value?.destroy();
    loom.value = null;
  });

  return { loom, failed };
}
