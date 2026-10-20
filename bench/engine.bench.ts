/**
 * Engine benchmarks on 1,000- and 5,000-element specs.
 *
 *   npm run bench                                   print timings
 *   npm run bench -- --outputJson bench.json        save them (CI does this per commit)
 *   npm run bench -- --compare bench.json           compare against a saved run
 *
 * Paint runs against the recording canvas from loom-ui/testing, so it
 * measures the engine's and components' own work, not the browser's raster.
 */
import { bench, describe } from "vitest";
import { coreComponents } from "../src/components";
import { layoutTree } from "../src/layout";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { Store } from "../src/state";
import { render } from "../src/testing";
import { MonoMeasurer } from "../src/text";
import { lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const rootProps = { pad: "20", gap: "14" };

/** About `elements` elements: repeated order cards using most core components. */
export function bigSpec(elements: number): string {
  const card = (i: number) => `card
  text "Order #${i}: trail runner socks, merino blend" style=title
  text "{qty} pairs, shipped to the valley campground" tone=muted
  row
    stat label="Each" value="\${price}"
    stat label="Total" value={qty * price + ${i % 7}}
  progress value={qty} max=10 label="Packed {qty} of 10"
  check "Gift wrap" bind=gift
  row
    button "Remove" variant=secondary on=dec:qty
    button "Add" on=inc:qty
`;
  const perCard = 11;
  const lines = ["state qty=2 price=24 gift=false"];
  for (let i = 0; i * perCard < elements; i++) lines.push(card(i));
  return lines.join("\n");
}

for (const size of [1000, 5000]) {
  const spec = bigSpec(size);
  const parsed = parse(spec, registry, { rootProps });
  const store = new Store();
  parsed.state.forEach((s) => store.declare(s.key, s.value));
  const measure = new MonoMeasurer();

  describe(`${parsed.nodeCount} elements`, () => {
    bench("parse", () => {
      parse(spec, registry, { rootProps });
    });

    bench("layout", () => {
      layoutTree(parsed.root, 1024, registry, lightTheme, measure, store.scope);
    });

    const ui = render(spec, { width: 1024 });
    bench("full frame (parse, layout, paint)", () => {
      ui.loom.setSpec(spec);
      ui.loom.renderNow();
    });

    bench("state change (layout and paint)", () => {
      ui.loom.state.set("qty", (Number(ui.state.qty) + 1) % 10);
      ui.loom.renderNow();
    });
  });
}
