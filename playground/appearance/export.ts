/**
 * "Copy theme code": TypeScript that sets up the theme the playground is
 * showing, with loom-ui's public API only (extendTheme, lightTheme,
 * darkTheme, SayShape#setTheme). It writes the effective colors, after any
 * contrast adjustment, not the ones asked for.
 */
import type { Theme } from "../../src/theme";
import { presetById, resolveTheme, type Scheme } from "./presets";
import type { AppearancePrefs } from "./prefs";

type Colors = Partial<Theme["colors"]>;

/** What the code sets up: one theme, or a light and a dark one that follow the system. */
export type ExportPlan =
  | { mode: "light" | "dark"; changes: Colors }
  | { mode: "system"; light: Colors; dark: Colors };

export function exportPlan(p: AppearancePrefs): ExportPlan {
  const changes = (s: Scheme) => resolveTheme(p.preset, s, p.accent).changes;
  return p.mode === "system" ? { mode: "system", light: changes("light"), dark: changes("dark") } : { mode: p.mode, changes: changes(p.mode) };
}

/** A theme expression: SayShape's base theme as is, or extendTheme with the changed colors. */
function themeExpr(base: "lightTheme" | "darkTheme", colors: Colors, indent = ""): string {
  const keys = Object.keys(colors) as Array<keyof Theme["colors"]>;
  if (!keys.length) return base;
  const lines = keys.map((k) => `${indent}    ${k}: "${colors[k]}",`).join("\n");
  return `extendTheme(${base}, {\n${indent}  colors: {\n${lines}\n${indent}  },\n${indent}})`;
}

export function themeCode(p: AppearancePrefs): string {
  const plan = exportPlan(p);
  const preset = presetById(p.preset)?.label ?? p.preset;
  const about = `// SayShape theme: ${preset}${p.accent ? `, accent ${p.accent}` : ""}, ${plan.mode === "system" ? "following the system's light or dark mode" : `${plan.mode} mode`}.\n` +
    `// Assumes \`loom\` is your SayShape instance: const loom = new SayShape(canvas, { components: coreComponents }).`;
  if (plan.mode !== "system") {
    const base = plan.mode === "dark" ? "darkTheme" : "lightTheme";
    const needsExtend = Object.keys(plan.changes).length > 0;
    return [
      `import { ${needsExtend ? "extendTheme, " : ""}${base}, type SayShape } from "loom-ui";`,
      "",
      about,
      `export const theme = ${themeExpr(base, plan.changes)};`,
      "",
      `export function applyTheme(loom: SayShape): void {`,
      `  loom.setTheme(theme);`,
      `}`,
      "",
    ].join("\n");
  }
  const needsExtend = Object.keys(plan.light).length + Object.keys(plan.dark).length > 0;
  return [
    `import { ${needsExtend ? "extendTheme, " : ""}darkTheme, lightTheme, type SayShape } from "loom-ui";`,
    "",
    about,
    `export const light = ${themeExpr("lightTheme", plan.light)};`,
    `export const dark = ${themeExpr("darkTheme", plan.dark)};`,
    "",
    `/** Use the light or dark theme to match the system, now and when it changes. Returns a function that stops following it. */`,
    `export function followSystemAppearance(loom: SayShape): () => void {`,
    `  const query = window.matchMedia("(prefers-color-scheme: dark)");`,
    `  const apply = () => loom.setTheme(query.matches ? dark : light);`,
    `  apply();`,
    `  query.addEventListener("change", apply);`,
    `  return () => query.removeEventListener("change", apply);`,
    `}`,
    "",
  ].join("\n");
}
