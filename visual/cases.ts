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
  // Chart cases the example and sample don't reach: negative values, a gap in
  // a line, labels thinned on a phone, and the message shown instead of a plot.
  {
    name: "chart-edges",
    spec: `state pnl=[{q: "Q1", v: 4200}, {q: "Q2", v: -1800}, {q: "Q3", v: 900}, {q: "Q4", v: -300}] temps=[{d: "Mon", t: 18.5}, {d: "Tue", t: 21}, {d: "Wed"}, {d: "Thu", t: 19.5}, {d: "Fri", t: 23}, {d: "Sat", t: 23}] days=[${Array.from({ length: 30 }, (_, i) => `{d: "Oct ${i + 1}", n: ${(i * 7) % 13 + 2}}`).join(", ")}] none=[]
chart "Profit by quarter" kind=bar items=pnl x=q y=v format=money
chart "Temperature" kind=line items=temps x=d y=t
chart "Signups per day" kind=bar items=days x=d y=n
chart "Nothing yet" kind=line items=none x=d y=n
`,
  },
];

export const THEMES = ["light", "dark"] as const;
export const WIDTHS = [375, 1024] as const;
