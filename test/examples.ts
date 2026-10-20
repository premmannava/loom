/**
 * A component's example as a complete spec. Components that only go inside a
 * parent (pin, tab, list-item) are wrapped in the parent's own example line,
 * along with that example's state, so the snippet renders as it would in use.
 *
 * Kept free of the map entry point so the visual suite can import it.
 */
import type { ComponentDef } from "../src/component";

const isState = (l: string) => /^state\s/.test(l);

export function exampleSpec(def: ComponentDef, all: readonly ComponentDef[]): string {
  const example = def.example ?? "";
  const parentType = def.parents?.find((p) => p !== "root");
  if (!parentType) return example + "\n";
  const parent = all.find((d) => d.type === parentType);
  const parentLines = (parent?.example ?? parentType).split("\n");
  const head = parentLines.find((l) => l.startsWith(parentType)) ?? parentType;
  const lines = example.split("\n");
  return [...parentLines.filter(isState), ...lines.filter(isState), head, ...lines.filter((l) => !isState(l)).map((l) => "  " + l)].join("\n") + "\n";
}
