/**
 * The playground's appearance preferences: which preset, which mode, and an
 * optional custom accent. Only these are stored, under a versioned key;
 * anything unreadable falls back to the defaults.
 */
import { normalizeHex } from "./color";
import { presetById, type Mode, type PresetId } from "./presets";

export interface AppearancePrefs {
  preset: PresetId;
  mode: Mode;
  /** The accent asked for (#rrggbb), or null for the preset's own. */
  accent: string | null;
}

export const STORAGE_KEY = "loom-playground-appearance:v1";
export const DEFAULT_PREFS: AppearancePrefs = { preset: "teal", mode: "system", accent: null };
const MODES: readonly Mode[] = ["light", "dark", "system"];

/** Preferences from stored text, keeping each valid field and defaulting the rest. */
export function parsePrefs(raw: string | null | undefined): AppearancePrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { ...DEFAULT_PREFS }; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ...DEFAULT_PREFS };
  const d = data as Record<string, unknown>;
  const preset = typeof d.preset === "string" && presetById(d.preset) ? (d.preset as PresetId) : DEFAULT_PREFS.preset;
  const mode = typeof d.mode === "string" && (MODES as readonly string[]).includes(d.mode) ? (d.mode as Mode) : DEFAULT_PREFS.mode;
  const accent = typeof d.accent === "string" ? normalizeHex(d.accent) : null;
  return { preset, mode, accent };
}

export function serializePrefs(p: AppearancePrefs): string {
  return JSON.stringify({ preset: p.preset, mode: p.mode, accent: p.accent });
}

export const isDefault = (p: AppearancePrefs) => p.preset === DEFAULT_PREFS.preset && p.mode === DEFAULT_PREFS.mode && p.accent === null;

/** The bits of Storage this needs, so tests can pass a fake or a broken one. */
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Load preferences; storage that's missing or throws (private mode, blocked) gives the defaults. */
export function loadPrefs(store: PrefStore | null | undefined): AppearancePrefs {
  try { return parsePrefs(store?.getItem(STORAGE_KEY)); } catch { return { ...DEFAULT_PREFS }; }
}

/** Save preferences; the defaults are removed rather than stored. Returns false if storage failed. */
export function savePrefs(store: PrefStore | null | undefined, p: AppearancePrefs): boolean {
  if (!store) return false;
  try {
    if (isDefault(p)) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, serializePrefs(p));
    return true;
  } catch {
    return false;
  }
}
