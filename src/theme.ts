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
    /**
     * Categorical colors for chart series and pie slices, used in this order.
     * series1 is the accent. The first four stay apart under common color
     * blindness (protanopia, deuteranopia), checked with every pair against each other.
     */
    series1: string;
    series2: string;
    series3: string;
    series4: string;
    series5: string;
    series6: string;
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
    series1: "#0E7C76",
    series2: "#A2461A",
    series3: "#64399D",
    series4: "#AD8B1C",
    series5: "#C74C8E",
    series6: "#2F8EFC",
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
    series1: "#3CC2B8",
    series2: "#B74C05",
    series3: "#7C61A8",
    series4: "#B08E26",
    series5: "#DD569F",
    series6: "#2F8EFC",
  },
};

/** The chart series colors, in order. */
export function seriesColors(theme: Theme): string[] {
  const c = theme.colors;
  return [c.series1, c.series2, c.series3, c.series4, c.series5, c.series6];
}

/** How many series colors a theme has: the most series one chart draws. */
export const SERIES_COUNT = 6;

/**
 * Series 1 is the accent: when an override changes the accent but says
 * nothing about series1, series1 follows it, so a rebranded theme's charts
 * still open in its own color.
 */
function followAccent(from: Theme["colors"], to: Theme["colors"], patch: Partial<Theme["colors"]>): void {
  if (patch.accent !== undefined && patch.series1 === undefined && from.series1 === from.accent) to.series1 = to.accent;
}

/** Build a theme by overriding parts of another. */
export function extendTheme(from: Theme, patch: DeepPartial<Theme>): Theme {
  const out = structuredClone(from) as Theme;
  for (const [k, v] of Object.entries(patch)) {
    const key = k as keyof Theme;
    if (v && typeof v === "object") Object.assign(out[key] as object, v);
    else (out as unknown as Record<string, unknown>)[key] = v;
  }
  if (patch.colors) followAccent(from.colors, out.colors, patch.colors);
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** The CSS custom property for a color token: accent → --loom-accent, landHover → --loom-land-hover, series2 → --loom-series-2. */
export function cssVarOf(key: keyof Theme["colors"]): string {
  return "--loom-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/(\d+)$/, "-$1");
}

/** Color tokens can be supplied from CSS as `--loom-<token>` (e.g. --loom-accent, --loom-series-2). */
export function themeFromCSS(el: Element, from: Theme): Theme {
  const cs = getComputedStyle(el);
  const colors = { ...from.colors };
  const patch: Partial<Theme["colors"]> = {};
  for (const key of Object.keys(colors) as Array<keyof Theme["colors"]>) {
    const v = cs.getPropertyValue(cssVarOf(key)).trim();
    if (v) colors[key] = patch[key] = v;
  }
  followAccent(from.colors, colors, patch);
  return { ...from, colors };
}
