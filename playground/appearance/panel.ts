/**
 * The playground's Appearance panel: wires the controls in index.html to
 * the presets, preferences and export modules. Themes reach the canvas
 * through loom.setTheme only: the spec, state, selections and any open
 * popup stay as they are, and nothing is sent to a model.
 */
import type { Loom } from "../../src";
import { mix, normalizeHex } from "./color";
import { themeCode } from "./export";
import { PRESETS, resolveTheme, type Mode, type PresetId, type Scheme } from "./presets";
import { DEFAULT_PREFS, isDefault, loadPrefs, savePrefs, type AppearancePrefs, type PrefStore } from "./prefs";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** localStorage, or null where it isn't allowed (private windows, blocked storage). */
function storage(): PrefStore | null {
  try { return window.localStorage; } catch { return null; }
}

export function setupAppearance(loom: Loom): void {
  const panel = $<HTMLDetailsElement>("appearance");
  const presetsBox = $("apPresets");
  const hex = $<HTMLInputElement>("apHex");
  const picker = $<HTMLInputElement>("apColor");
  const note = $("apNote");
  const copyStatus = $("apCopyStatus");
  const code = $<HTMLTextAreaElement>("apCode");
  const system = matchMedia("(prefers-color-scheme: dark)");
  let prefs: AppearancePrefs = loadPrefs(storage());
  let followingSystem = false;

  // One radio per preset, with a swatch of its light and dark accents.
  for (const p of PRESETS) {
    const label = document.createElement("label");
    label.className = "ap-opt";
    const light = resolveTheme(p.id, "light", null).theme.colors.accent;
    const dark = resolveTheme(p.id, "dark", null).theme.colors.accent;
    label.innerHTML = `<input type="radio" name="apPreset" value="${p.id}"><span class="ap-swatch" aria-hidden="true" style="--a:${light};--b:${dark}"></span><span></span>`;
    label.lastElementChild!.textContent = p.label;
    presetsBox.appendChild(label);
  }

  const scheme = (): Scheme => (prefs.mode === "system" ? (system.matches ? "dark" : "light") : prefs.mode);

  /** Show the current preferences everywhere: canvas, page and controls. */
  function apply(): void {
    const s = scheme();
    const r = resolveTheme(prefs.preset, s, prefs.accent);
    const root = document.documentElement;
    // The page follows the mode through its own data-theme styles.
    if (prefs.mode === "system") delete root.dataset.theme;
    else root.dataset.theme = prefs.mode;
    if (isDefault(prefs)) {
      // Exactly Loom's default: the engine follows the system and any --loom-* CSS by itself.
      loom.setTheme("auto");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--hl");
    } else {
      loom.setTheme(r.theme);
      root.style.setProperty("--accent", r.theme.colors.accent);
      root.style.setProperty("--hl", mix(r.theme.colors.accent, r.theme.colors.surface, 0.85));
    }
    // Listen to the system only while following it.
    if (prefs.mode === "system" && !followingSystem) { system.addEventListener("change", apply); followingSystem = true; }
    if (prefs.mode !== "system" && followingSystem) { system.removeEventListener("change", apply); followingSystem = false; }

    for (const el of panel.querySelectorAll<HTMLInputElement>('input[name="apPreset"]')) el.checked = el.value === prefs.preset;
    for (const el of panel.querySelectorAll<HTMLInputElement>('input[name="apMode"]')) el.checked = el.value === prefs.mode;
    const shown = normalizeHex(prefs.accent ?? r.theme.colors.accent) ?? r.theme.colors.accent;
    if (document.activeElement !== hex) hex.value = shown;
    hex.removeAttribute("aria-invalid");
    picker.value = normalizeHex(shown) ?? "#000000";
    note.textContent = r.accentAdjusted
      ? `Shown as ${r.theme.colors.accent} in ${s} mode, so it stays readable as text and on buttons.`
      : prefs.accent ? "" : "Using the style's own accent.";
    if (!code.hidden) code.value = themeCode(prefs);
    savePrefs(storage(), prefs);
  }

  const update = (patch: Partial<AppearancePrefs>) => { prefs = { ...prefs, ...patch }; apply(); };

  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "apPreset") update({ preset: t.value as PresetId });
    if (t.name === "apMode") update({ mode: t.value as Mode });
  });
  // The color well and the text field both set the requested accent.
  picker.addEventListener("input", () => update({ accent: normalizeHex(picker.value) }));
  hex.addEventListener("input", () => {
    const v = normalizeHex(hex.value);
    // Half-typed values ("#3c") wait; nothing invalid is applied.
    if (v) update({ accent: v });
  });
  hex.addEventListener("change", () => {
    const v = normalizeHex(hex.value);
    if (v) { hex.value = v; return; }
    hex.setAttribute("aria-invalid", "true");
    note.textContent = "Enter a color as #rgb or #rrggbb, like #6d28d9.";
  });
  $("apReset").addEventListener("click", () => update({ accent: null }));
  $("apResetAll").addEventListener("click", () => { prefs = { ...DEFAULT_PREFS }; apply(); });

  $("apCopy").addEventListener("click", async () => {
    const text = themeCode(prefs);
    code.value = text;
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied. Paste it where you create your Loom instance.";
      code.hidden = true;
    } catch {
      // No clipboard (permissions, insecure page): show the code to copy by hand.
      copyStatus.textContent = "Couldn't copy automatically. Select the code below and copy it.";
      code.hidden = false;
      code.focus();
      code.select();
    }
  });

  // Escape or a click elsewhere closes the panel; focus goes back to its button.
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.open) { panel.open = false; panel.querySelector("summary")?.focus(); }
  });
  document.addEventListener("click", (e) => { if (panel.open && !panel.contains(e.target as Node)) panel.open = false; });

  apply();
}
