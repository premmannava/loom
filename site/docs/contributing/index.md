---
title: Development
description: Working on SayShape itself. Commands, tests, the rules every change must keep, and what to check before a change is done.
---

# Development

The repository's brief for contributors, human or AI, is [`CLAUDE.md`](https://github.com/premmannava/sayshape/blob/main/CLAUDE.md). This page summarizes it.

```bash
npm ci
npm run dev          # development playground
npm test             # unit, contract, streaming, fuzz and interaction tests
npm run typecheck
npm run build
```

## Tests

| Suite | Where | What it checks |
|---|---|---|
| Unit | `test/*.test.ts` | Parser, expressions, actions, layout, the model guide |
| Contract | `test/contract.test.ts` | Every registered component against the project rules: documentation, layout bounds at three widths, theme-only colors and fonts, hit regions and keyboard reach |
| Streaming | `test/streaming.test.ts` | Every prefix of every sample renders a valid, smaller screen, however it's chunked |
| Fuzz | `test/fuzz.test.ts` | Random and damaged specs, expressions and actions never throw (`FUZZ_RUNS=5000 npm test` for a longer run) |
| Website | `test/site.test.ts` | Every gallery example renders cleanly and behaves as described; every SayShape block in these docs parses |
| Visual | `visual/` | Component examples and samples in light and dark at two widths, against baselines (Playwright) |
| Benchmarks | `bench/` | Parse, layout and paint timings; pull requests are compared with their base |

Interaction tests use `loom-ui/testing`, which runs the real engine in Node against a canvas that records what's drawn:

```ts
import { render } from "loom-ui/testing";

const ui = render(`state n=0
button "Add" on=inc:n
text "Clicked {n} times"`);

ui.press({ type: "button", text: "Add" });
expect(ui.state.n).toBe(1);
expect(ui.text()).toContain("Clicked 1 times");
```

Visual baselines are made on Linux in the Playwright image, because fonts render differently on each platform: `VISUAL_ARGS=--update-snapshots npm run test:visual:docker`, or add the `update-visual-baselines` label to a pull request and CI commits them.

## Rules every change keeps

1. Specs can never run code. Expressions go through `src/expr.ts` only.
2. The parser never throws. Every problem is a diagnostic with a line number.
3. Streaming keeps working: no syntax that needs a closing line.
4. Components never hard-code design. Colors, fonts, radii, spacing and type sizes come from the theme.
5. The model guide and component docs are generated from component definitions, never written by hand.
6. Layout stays headless: it only measures text.
7. Rendering stays on the canvas.
8. Models generate specs, never components.
9. No new runtime dependencies without a strong reason. The library has none.

## Before a change is done

1. `npm run typecheck`, `npm test` and `npm run build` pass.
2. If a component definition changed, `npm run docs:components` has been run.
3. Anything visual has been looked at in light and dark mode, and visual baselines are updated in the same change.
4. Spec examples added anywhere parse with no diagnostics.
