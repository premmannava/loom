/**
 * Design tokens. Components never use literal colors or sizes: they read
 * everything from the theme, which is what keeps model-generated screens
 * on-brand.
 */
export interface Theme {
  name: string;
  colors: {
    surface: string;
    ink: string;
    muted: string;
    line: string;
    accent: string;
    onAccent: string;
    good: string;
    warn: string;
    bad: string;
    focus: string;
    land: string;
    landHighlight: string;
    landHover: string;
    debug: string;
  };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; md: number; lg: number };
  font: { family: string; mono: string };
  text: { caption: number; body: number; lead: number; title: number; display: number };
  control: { height: number };
}

const base = {
  space: { xs: 4, sm: 8, md: 14, lg: 22, xl: 32 },
  radius: { sm: 5, md: 10, lg: 16 },
  font: {
    family: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
  },
  text: { caption: 12, body: 15, lead: 18, title: 24, display: 32 },
  control: { height: 42 },
};

export const lightTheme: Theme = {
  name: "light",
  ...base,
  colors: {
    surface: "#FFFFFF",
    ink: "#172030",
    muted: "#5B6577",
    line: "#D3D8E0",
    accent: "#0E7C76",
    onAccent: "#FFFFFF",
    good: "#2E7D32",
    warn: "#B45309",
    bad: "#C62828",
    focus: "#2563EB",
    land: "#D3D9E2",
    landHighlight: "#A6D6D1",
    landHover: "#B3BDCB",
    debug: "#C2410C",
  },
};

export const darkTheme: Theme = {
  name: "dark",
  ...base,
  colors: {
    surface: "#1C222D",
    ink: "#E6EAF0",
    muted: "#98A2B3",
    line: "#2A3240",
    accent: "#3CC2B8",
    onAccent: "#06211F",
    good: "#6CCB74",
    warn: "#F5B454",
    bad: "#F87171",
    focus: "#7AA7FF",
    land: "#2C3443",
    landHighlight: "#1E5B57",
    landHover: "#3D495C",
    debug: "#FB923C",
  },
};

/** Build a theme by overriding parts of another. */
export function extendTheme(from: Theme, patch: DeepPartial<Theme>): Theme {
  const out = structuredClone(from) as Theme;
  for (const [k, v] of Object.entries(patch)) {
    const key = k as keyof Theme;
    if (v && typeof v === "object") Object.assign(out[key] as object, v);
    else (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** Color tokens can be supplied from CSS as `--loom-<token>` (e.g. --loom-accent). */
export function themeFromCSS(el: Element, from: Theme): Theme {
  const cs = getComputedStyle(el);
  const colors = { ...from.colors };
  for (const key of Object.keys(colors) as Array<keyof Theme["colors"]>) {
    const cssName = "--loom-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    const v = cs.getPropertyValue(cssName).trim();
    if (v) colors[key] = v;
  }
  return { ...from, colors };
}
