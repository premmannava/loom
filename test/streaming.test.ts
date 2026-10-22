/**
 * Streaming guarantees (CLAUDE.md rule 3): any prefix of a spec, cut at a
 * line boundary, is a valid smaller screen, and nothing already on screen
 * moves or changes identity while the rest arrives.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { render } from "../src/testing";
import type { SayShapeNode } from "../src/types";
import { ALL_COMPONENTS, corpus, registry } from "./corpus";

/** Pre-order list of "id<parent" pairs: a prefix of the spec must give a prefix of this list. */
function outline(root: SayShapeNode): string[] {
  const out: string[] = [];
  const walk = (n: SayShapeNode, parent: string) => {
    if (n.id !== "root") out.push(`${n.id}<${parent}`);
    n.children.forEach((c) => walk(c, n.id));
  };
  walk(root, "");
  return out;
}

function linePrefixes(spec: string): string[] {
  const out = [""];
  let i = spec.indexOf("\n");
  while (i >= 0) {
    out.push(spec.slice(0, i + 1));
    i = spec.indexOf("\n", i + 1);
  }
  return out;
}

describe.each(corpus)("%s", (_name, spec) => {
  const full = parse(spec, registry);

  it("every line prefix reports exactly the full spec's diagnostics for those lines", () => {
    linePrefixes(spec).forEach((prefix, k) => {
      const r = parse(prefix, registry);
      expect(r.diagnostics, `first ${k} lines`).toEqual(full.diagnostics.filter((d) => d.line <= k));
    });
  });

  it("every line prefix's tree is the beginning of the next one's", () => {
    let prev: string[] = [];
    for (const prefix of linePrefixes(spec)) {
      const cur = outline(parse(prefix, registry).root);
      expect(cur.slice(0, prev.length)).toEqual(prev);
      prev = cur;
    }
    expect(prev).toEqual(outline(full.root));
  });

  it("a partial parse ignores only the unfinished last line", () => {
    for (let i = 0; i <= spec.length; i++) {
      const cut = spec.slice(0, i);
      const complete = cut.slice(0, cut.lastIndexOf("\n") + 1);
      expect(parse(cut, registry, { partial: true })).toEqual(parse(complete, registry));
    }
  });

  it("renders the same screen however the stream is chunked", () => {
    const finalOutline = outline(full.root);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 200 }), (sizes) => {
        const ui = render("", { components: ALL_COMPONENTS });
        ui.loom.beginStream();
        let pos = 0, i = 0, lastNodes = 0;
        while (pos < spec.length) {
          const n = sizes[i++ % sizes.length]!;
          ui.loom.push(spec.slice(pos, pos + n));
          pos += n;
          ui.loom.renderNow();
          // Already rendered elements never disappear while streaming.
          expect(ui.loom.metrics.nodes).toBeGreaterThanOrEqual(lastNodes);
          lastNodes = ui.loom.metrics.nodes;
          expect(finalOutline.slice(0, outline(ui.loom.tree!).length)).toEqual(outline(ui.loom.tree!));
        }
        ui.loom.endStream();
        ui.loom.renderNow();
        expect(outline(ui.loom.tree!)).toEqual(finalOutline);
        expect(ui.diagnostics).toEqual(full.diagnostics);
        ui.destroy();
      }),
      { numRuns: 25 },
    );
  });
});
