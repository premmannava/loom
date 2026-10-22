/**
 * Component profiles: which components the MODEL is told about.
 *
 * Three sets are involved, and they're separate on purpose:
 *
 * 1. The renderer's components: the Registry a Loom instance was built with.
 *    A screen can use any of them, whoever wrote it.
 * 2. The components exposed to the model: a profile, a subset of (1). The
 *    guide describes only these, so the prompt is smaller and more focused.
 * 3. Validation: by default a generated spec is checked against the
 *    renderer's components. With generateSpec's enforceProfile, it's checked
 *    against the profile, so a component outside it is a problem the repair
 *    pass sends back.
 *
 * Profiles are chosen by the app, not guessed from the request: no extra model
 * call, keyword router or vector search.
 */
import type { ComponentDef } from "./component";
import { Registry } from "./registry";

/** A named set of components, for apps that know what kind of screens they need. */
export interface ComponentProfile {
  name: string;
  components: readonly string[];
}

/**
 * Built-in profiles. Each is a starting point for a kind of app; an app can
 * pass its own list instead. Dependencies are added when resolved.
 */
export const PROFILES: Readonly<Record<string, readonly string[]>> = {
  forms: ["card", "row", "text", "divider", "input", "check", "switch", "radio", "stepper", "slider", "button", "link", "badge", "screen"],
  lists: ["card", "row", "grid", "text", "badge", "divider", "list", "list-item", "each", "check", "button", "link", "input", "empty", "progress", "stat"],
  shop: ["card", "row", "grid", "text", "image", "badge", "rating", "stat", "button", "link", "radio", "stepper", "each", "list", "list-item", "divider", "screen", "tabs", "input", "empty"],
  dashboard: ["card", "row", "grid", "text", "stat", "progress", "badge", "list", "list-item", "each", "tabs", "divider", "empty"],
};

/**
 * Every profile includes these: the parser treats the top level as a column,
 * and nearly every screen has text, so the guide's own examples can rely on it.
 */
export const ALWAYS_EXPOSED = ["column", "text"] as const;

export interface ResolvedProfile {
  /** The profile's name, or "all" when every registered component is exposed. */
  name: string;
  /** The exposed component types, in the renderer registry's order (deterministic). */
  types: readonly string[];
  /** A registry of just the exposed components, for describing them and for validation. */
  registry: Registry;
}

/**
 * Resolve a profile against the renderer's registry, adding what its
 * components need: parents (a tab needs tabs) and required children (tabs
 * needs tab). Throws for a component the renderer doesn't have, since that's
 * an app configuration mistake.
 */
export function resolveProfile(renderer: Registry, profile?: string | ComponentProfile | readonly string[]): ResolvedProfile {
  if (profile === undefined || profile === "all") {
    return { name: "all", types: renderer.all().map((c) => c.type), registry: renderer };
  }
  const name = typeof profile === "string" ? profile : Array.isArray(profile) ? "custom" : (profile as ComponentProfile).name;
  const listed = typeof profile === "string" ? PROFILES[profile] : Array.isArray(profile) ? profile : (profile as ComponentProfile).components;
  if (!listed) throw new Error(`Unknown component profile "${String(profile)}". Use one of: all, ${Object.keys(PROFILES).join(", ")}, or a list of component names`);

  const want = new Set<string>([...ALWAYS_EXPOSED, ...listed]);
  for (const t of want) {
    if (!renderer.has(t)) throw new Error(`Profile "${name}" includes "${t}", which the renderer doesn't have. Register it, or leave it out of the profile`);
  }
  // Add parents and required children until nothing changes.
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of [...want]) {
      const def = renderer.get(t)!;
      const needs = [...(def.parents ?? []).filter((p) => p !== "root"), ...(Array.isArray(def.children) ? def.children : [])];
      for (const n of needs) {
        if (!want.has(n) && renderer.has(n)) { want.add(n); grew = true; }
      }
    }
  }
  const defs: ComponentDef[] = renderer.all().filter((c) => want.has(c.type));
  return { name, types: defs.map((c) => c.type), registry: new Registry(defs) };
}
