import ts from "typescript";
import { describe, expect, it } from "vitest";
import { contrast, effectiveAccent, luminance, mix, normalizeHex, onColor, over } from "../playground/appearance/color";
import { exportPlan, themeCode } from "../playground/appearance/export";
import { auditTheme, lineContrast, PRESETS, resolveTheme, type PresetId, type Scheme } from "../playground/appearance/presets";
import { DEFAULT_PREFS, loadPrefs, parsePrefs, savePrefs, STORAGE_KEY, type AppearancePrefs, type PrefStore } from "../playground/appearance/prefs";
import { darkTheme, extendTheme, lightTheme } from "../src/theme";

const SCHEMES: Scheme[] = ["light", "dark"];

describe("hex input", () => {
  it("reads #RGB and #RRGGBB, with or without #, in any case", () => {
    expect(normalizeHex("#6D28D9")).toBe("#6d28d9");
    expect(normalizeHex("6d28d9")).toBe("#6d28d9");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("  #FFF ")).toBe("#ffffff");
  });

  it("refuses half-typed and invalid values instead of guessing", () => {
    for (const bad of ["", "#", "#3c", "#3cc2", "#3cc2b", "#3cc2b8f", "#gggggg", "red", "rgb(0,0,0)", "#12345678", "##abc"]) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
  });
});

describe("contrast", () => {
  it("matches WCAG's figures", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#0e7c76", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#0e7c76"), 9);
  });

  it("blends tints the way the canvas paints them", () => {
    expect(over("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
  });

  it("picks the label color that reads better on a fill", () => {
    expect(onColor("#0e7c76")).toBe("#ffffff");
    expect(onColor("#ffff00")).toBe("#0b0f14");
  });
});

describe("effective accent", () => {
  it("keeps a color that's already readable", () => {
    expect(effectiveAccent("#6d28d9", "#ffffff")).toMatchObject({ accent: "#6d28d9", adjusted: false });
  });

  it("darkens on light surfaces and lightens on dark ones, just enough", () => {
    const light = effectiveAccent("#ffff00", lightTheme.colors.surface);
    expect(light.adjusted).toBe(true);
    expect(light.ratio).toBeGreaterThanOrEqual(4.5);
    expect(light.ratio).toBeLessThan(4.7);
    expect(luminance(light.accent)).toBeLessThan(luminance("#ffff00"));
    const dark = effectiveAccent("#1a1a1a", darkTheme.colors.surface);
    expect(dark.adjusted).toBe(true);
    expect(dark.ratio).toBeGreaterThanOrEqual(4.5);
    expect(luminance(dark.accent)).toBeGreaterThan(luminance("#1a1a1a"));
  });

  it("always leaves a readable label on the accent", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#808080", "#ffffff", "#000000", "#f0e68c", "#7fffd4"]) {
      for (const s of SCHEMES) {
        const surface = (s === "dark" ? darkTheme : lightTheme).colors.surface;
        const e = effectiveAccent(hex, surface);
        expect(contrast(e.accent, surface), `${hex} ${s}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(e.onAccent, e.accent), `${hex} ${s} label`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("presets", () => {
  it("leave SayShape's default theme as it is for Teal", () => {
    expect(resolveTheme("teal", "light", null).theme).toEqual(lightTheme);
    expect(resolveTheme("teal", "dark", null).theme).toEqual(darkTheme);
    expect(resolveTheme("teal", "light", null).changes).toEqual({});
  });

  it.each(PRESETS.flatMap((p) => SCHEMES.map((s) => [p.id, s] as const)))("%s in %s passes every text, accent and focus check", (id, s) => {
    const failures = auditTheme(resolveTheme(id, s, null).theme).filter((c) => !c.pass);
    expect(failures).toEqual([]);
  });

  it("keep status colors apart from the accent and each other", () => {
    for (const p of PRESETS) for (const s of SCHEMES) {
      const c = resolveTheme(p.id, s, null).theme.colors;
      const tones = [c.accent, c.good, c.warn, c.bad];
      expect(new Set(tones.map((t) => t.toLowerCase())).size, `${p.id} ${s}`).toBe(4);
    }
  });

  it("make Neutral's control lines clear at 3:1", () => {
    for (const s of SCHEMES) expect(lineContrast(resolveTheme("neutral", s, null).theme)).toBeGreaterThanOrEqual(3);
  });

  it("resolve a custom accent per mode from the same request", () => {
    const light = resolveTheme("purple", "light", "#ffff00");
    const dark = resolveTheme("purple", "dark", "#ffff00");
    expect(light.accentAdjusted).toBe(true);
    expect(dark.accentAdjusted).toBe(false);
    expect(dark.theme.colors.accent).toBe("#ffff00");
    expect(light.requestedAccent).toBe("#ffff00");
    for (const r of [light, dark]) expect(auditTheme(r.theme).filter((c) => !c.pass)).toEqual([]);
  });

  it("only change colors, so sizes and fonts stay SayShape's", () => {
    const t = resolveTheme("blue", "dark", "#123456").theme;
    expect({ ...t, colors: undefined }).toEqual({ ...darkTheme, colors: undefined });
  });
});

describe("preferences", () => {
  it("read what was stored, field by field, defaulting what's wrong", () => {
    expect(parsePrefs(JSON.stringify({ preset: "purple", mode: "dark", accent: "#ABC" }))).toEqual({ preset: "purple", mode: "dark", accent: "#aabbcc" });
    expect(parsePrefs(JSON.stringify({ preset: "rainbow", mode: "dusk", accent: "#zz" }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ preset: "blue" }))).toEqual({ ...DEFAULT_PREFS, preset: "blue" });
    for (const bad of [null, "", "not json", "[]", "42", "null", '"teal"']) expect(parsePrefs(bad), String(bad)).toEqual(DEFAULT_PREFS);
  });

  const memory = (): PrefStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it("store only the preferences, under a versioned key, and nothing for the defaults", () => {
    const store = memory();
    const p: AppearancePrefs = { preset: "neutral", mode: "light", accent: null };
    expect(savePrefs(store, p)).toBe(true);
    expect([...store.data.keys()]).toEqual([STORAGE_KEY]);
    expect(JSON.parse(store.data.get(STORAGE_KEY)!)).toEqual({ preset: "neutral", mode: "light", accent: null });
    expect(loadPrefs(store)).toEqual(p);
    savePrefs(store, DEFAULT_PREFS);
    expect(store.data.size).toBe(0);
  });

  it("work without storage, or with storage that throws", () => {
    const broken: PrefStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(savePrefs(broken, { preset: "blue", mode: "dark", accent: null })).toBe(false);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(savePrefs(undefined, DEFAULT_PREFS)).toBe(false);
  });
});

describe("theme code", () => {
  const combos: AppearancePrefs[] = (["teal", "purple", "blue", "neutral"] as PresetId[]).flatMap((preset) =>
    (["light", "dark", "system"] as const).flatMap((mode) => [null, "#ffff00", "#1a1a1a"].map((accent) => ({ preset, mode, accent }))),
  );

  it("describes exactly the themes the playground shows", () => {
    for (const p of combos) {
      const plan = exportPlan(p);
      const shown = (s: Scheme) => resolveTheme(p.preset, s, p.accent).theme;
      const built = (s: Scheme, changes: object) => extendTheme(s === "dark" ? darkTheme : lightTheme, { colors: changes });
      if (plan.mode === "system") {
        expect(built("light", plan.light), JSON.stringify(p)).toEqual(shown("light"));
        expect(built("dark", plan.dark), JSON.stringify(p)).toEqual(shown("dark"));
      } else {
        expect(built(plan.mode, plan.changes), JSON.stringify(p)).toEqual(shown(plan.mode));
      }
    }
  });

  it("writes the adjusted colors, not the ones asked for", () => {
    const code = themeCode({ preset: "teal", mode: "light", accent: "#ffff00" });
    const effective = resolveTheme("teal", "light", "#ffff00").theme.colors.accent;
    expect(code).toContain(`accent: "${effective}"`);
    expect(code).not.toContain(`accent: "#ffff00"`);
  });

  it("is valid TypeScript using only loom-ui's public API", () => {
    for (const p of combos) {
      const code = themeCode(p);
      const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      expect(out.diagnostics ?? [], code).toEqual([]);
      const imports = /import \{ ([^}]+) \} from "loom-ui";/.exec(code)![1]!.split(",").map((s) => s.trim().replace(/^type /, ""));
      for (const name of imports) expect(["extendTheme", "lightTheme", "darkTheme", "SayShape"], name).toContain(name);
      expect(code).not.toMatch(/playground|appearance\//);
    }
  });

  it("follows the system with a listener it can remove, only in System mode", () => {
    const system = themeCode({ preset: "blue", mode: "system", accent: null });
    expect(system).toContain(`matchMedia("(prefers-color-scheme: dark)")`);
    expect(system).toContain(`addEventListener("change", apply)`);
    expect(system).toContain(`return () => query.removeEventListener("change", apply)`);
    const fixed = themeCode({ preset: "blue", mode: "dark", accent: null });
    expect(fixed).not.toContain("matchMedia");
    expect(fixed).not.toContain("lightTheme");
    expect(fixed).toContain("loom.setTheme(theme)");
  });

  it("is just SayShape's own theme for the defaults", () => {
    expect(themeCode({ preset: "teal", mode: "light", accent: null })).toContain("export const theme = lightTheme;");
    expect(themeCode({ preset: "teal", mode: "light", accent: null })).not.toContain("extendTheme");
  });
});
