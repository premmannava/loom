/** Real specs shared by the streaming, fuzz and benchmark suites. */
import type { ComponentDef } from "../src/component";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";
import { samples } from "../playground/samples";
import { exampleSpec } from "./examples";

export const ALL_COMPONENTS: ComponentDef[] = [...coreComponents, ...mapComponents];
export const registry = new Registry(ALL_COMPONENTS);

/** Playground samples, the model guide's example and every component example. */
export const corpus: Array<[name: string, spec: string]> = [
  ...Object.entries(samples).map(([k, s]) => [`sample ${k}`, s.spec] as [string, string]),
  ["guide example", languageGuide(new Registry(coreComponents)).split("EXAMPLE\n")[1]!],
  ...ALL_COMPONENTS.filter((c) => c.example).map((c) => [`example ${c.type}`, exampleSpec(c, ALL_COMPONENTS)] as [string, string]),
];
