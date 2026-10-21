/**
 * What the visual regression suite renders: every core component's example
 * and every playground sample. The map and pin are covered by the map sample.
 *
 * This file is loaded both by the browser page and by the Playwright spec, so
 * it must not import the map entry point (its outlines are a JSON file).
 */
import { coreComponents } from "../src/components";
import { samples } from "../playground/samples";
import { exampleSpec } from "../test/examples";

export interface VisualCase {
  name: string;
  spec: string;
}

export const cases: VisualCase[] = [
  ...coreComponents.filter((c) => c.example).map((c) => ({ name: `component-${c.type}`, spec: exampleSpec(c, coreComponents) })),
  ...Object.entries(samples).map(([k, s]) => ({ name: `sample-${k}`, spec: s.spec })),
];

export const THEMES = ["light", "dark"] as const;
export const WIDTHS = [375, 1024] as const;
