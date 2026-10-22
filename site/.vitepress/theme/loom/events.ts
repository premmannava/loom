/**
 * What the site shows when a demo talks to its host. No demo on this site is
 * connected to a backend, so every emitted action is reported as simulated.
 */
import type { SayShape } from "./runtime";

export interface HostEvent {
  id: number;
  kind: "emit" | "screen" | "notify";
  text: string;
}

let next = 0;

function short(value: unknown): string {
  if (value === undefined) return "";
  let s: string;
  try { s = JSON.stringify(value); } catch { s = String(value); }
  return s.length > 90 ? s.slice(0, 87) + "…" : s;
}

/** Subscribe to the events a host would handle. Returns a cleanup function. */
export function onHostEvents(loom: SayShape, push: (e: HostEvent) => void): () => void {
  const offs = [
    loom.on("action", ({ name, value }) => push({ id: ++next, kind: "emit", text: `emit:${name}${value === undefined ? "" : " → " + short(value)}` })),
    loom.on("navigate", ({ screen, from }) => push({ id: ++next, kind: "screen", text: `screen ${from ?? "—"} → ${screen}` })),
    loom.on("notify", ({ text }) => push({ id: ++next, kind: "notify", text: `notify "${text}"` })),
  ];
  return () => offs.forEach((off) => off());
}
