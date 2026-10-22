/**
 * Matching the chat app's look. MCP Apps hosts pass their design tokens as
 * CSS variables (hostContext.styles.variables): background, text, border and
 * status colors, fonts and corner radii. This maps the ones SayShape has a
 * slot for onto its theme, so an interface looks native in Claude, ChatGPT or
 * any other host. Anything the host leaves out keeps SayShape's own value.
 *
 * The accent stays SayShape's: hosts don't send a brand or accent color.
 */
import type { Theme } from "../../../src/theme";

/** Reads one host variable as a value the canvas can use, or undefined. */
export type ReadVar = (name: string, kind: "color" | "length" | "font") => string | undefined;

const COLOR_VARS: ReadonlyArray<[keyof Theme["colors"], string]> = [
  ["surface", "--color-background-primary"],
  ["ink", "--color-text-primary"],
  ["muted", "--color-text-secondary"],
  ["line", "--color-border-primary"],
  ["good", "--color-text-success"],
  ["warn", "--color-text-warning"],
  ["bad", "--color-text-danger"],
  ["focus", "--color-ring-primary"],
];

const RADIUS_VARS: ReadonlyArray<[keyof Theme["radius"], string]> = [
  ["sm", "--border-radius-sm"],
  ["md", "--border-radius-md"],
  ["lg", "--border-radius-lg"],
];

/** Corner radii beyond this are pills; they'd turn cards into ovals. */
const MAX_RADIUS = 24;

function px(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_RADIUS) : undefined;
}

/** A font stack we can hand to the canvas: no quotes that could break out, no url(), no semicolons. */
function fontStack(v: string | undefined): string | undefined {
  const s = v?.trim();
  if (!s || s.length > 300 || /[;{}()<>\\]/.test(s)) return undefined;
  return s;
}

export function hostTheme(base: Theme, read: ReadVar): Theme {
  const colors = { ...base.colors };
  for (const [slot, name] of COLOR_VARS) {
    const v = read(name, "color");
    if (v) colors[slot] = v;
  }
  const radius = { ...base.radius };
  for (const [slot, name] of RADIUS_VARS) {
    const v = px(read(name, "length"));
    if (v !== undefined) radius[slot] = v;
  }
  const font = { ...base.font };
  const sans = fontStack(read("--font-sans", "font"));
  const mono = fontStack(read("--font-mono", "font"));
  if (sans) font.family = sans;
  if (mono) font.mono = mono;
  return { ...base, name: `${base.name} (host)`, colors, radius, font };
}

/** The first family in a font stack, for preloading before the canvas draws with it. */
export function firstFamily(stack: string): string | undefined {
  const first = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || undefined;
}
