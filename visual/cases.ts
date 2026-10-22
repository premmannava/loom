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
  // Multi-series and round chart cases the example and samples don't reach:
  // grouped bars with a gap and negatives, a wrapping legend, a pie folding
  // 9 items into Other, and the messages for too many series and a negative slice.
  {
    name: "chart-series-edges",
    spec: `state q=[{q: "Q1", a: 4200, b: 3100, c: -600}, {q: "Q2", a: -1800, b: 2500, c: 1200}, {q: "Q3", a: 900, c: 2000}, {q: "Q4", a: 3300, b: 2900, c: 2600}] spend=[{k: "Rent", v: 1800}, {k: "Groceries", v: 640}, {k: "Transport", v: 310}, {k: "Utilities", v: 220}, {k: "Dining out", v: 180}, {k: "Streaming", v: 45}, {k: "Gym", v: 40}, {k: "Books", v: 25}, {k: "Gifts", v: 60}] mixed=[{k: "A", v: 3}, {k: "B", v: -1}] wide=[{k: "A", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7}]
chart "Profit by region and quarter" kind=bar items=q x=q y=a,b,c labels="North America,Europe and Middle East,Asia Pacific" format=money
chart "Monthly spending" kind=pie items=spend x=k y=v format=money
chart "Mixed signs" kind=donut items=mixed x=k y=v
chart "Seven series" kind=line items=wide x=k y=a,b,c,d,e,f,g
`,
  },
  // Table cases the example and sample don't reach: missing and unusable
  // values, 0, false and negatives, long text, a read-only table, the empty
  // message, and a table too wide for a phone (it fits at desktop width).
  {
    name: "table-edges",
    spec: `state rows=[{name: "Trail socks", qty: 0, price: -4.5, ok: false}, {name: "A very long product name that has to be cut", qty: 12, price: 1299.99, ok: true}, {name: "No price", qty: "lots"}, {qty: 3, price: 18}] none=[] wide=[{a: 1200, b: 350, c: 79, d: 12, e: 24, f: 41}]
table "Order lines" items=rows
  table-column "Item" field=name
  table-column "Qty" field=qty format=number
  table-column "Price" field=price format=money
  table-column "In stock" field=ok
table "Nothing yet" items=none
  table-column "Item" field=name
table "Six money columns" items=wide
  table-column "Jan" field=a format=money
  table-column "Feb" field=b format=money
  table-column "Mar" field=c format=money
  table-column "Apr" field=d format=money
  table-column "May" field=e format=money
  table-column "Jun" field=f format=money
`,
  },
];

export const THEMES = ["light", "dark"] as const;
export const WIDTHS = [375, 1024] as const;
