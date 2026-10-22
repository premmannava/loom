# SayShape: brief for AI assistants

Read this before changing anything in this repository. It explains what SayShape is, the rules that keep it working, and how to make changes safely. The phase plan is in [`docs/PLAN.md`](docs/PLAN.md); user-facing documentation is in [`README.md`](README.md).

## What SayShape is

SayShape is two things that are designed together:

1. **A UI language for AI models to write.** It is line-based (one element per line, indentation for nesting), so a model's streamed output renders line by line. It can't run code, and it never contains colors, fonts or pixel sizes.
2. **An engine that renders that language entirely on its own.** It has its own parser, layout, painter and input handling, and draws onto a single `<canvas>`. It does not use HTML elements, CSS layout, React or any UI framework.

The goal is **generative UI**: a model produces an interface at runtime, in response to a user, and the engine renders it safely, consistently and fast. SayShape is not trying to replace React for human-built apps. It is trying to be the layer the model speaks.

```
state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
```

## How it works

```
spec text → parse → tree → layout → boxes → paint → canvas pixels
                               ↑                       │
             state ←── actions ←── pointer / keyboard ─┘
```

| Stage | File | Notes |
|---|---|---|
| Parse | `src/parser.ts` | Text → `SayShapeNode` tree plus line-numbered `Diagnostic`s. Validates against component definitions. |
| Derived values | `src/state.ts`, `src/parser.ts` | `derive total={…}` lines: parsed and checked (duplicates, state collisions, cycles, writes) into `ParseResult.derived`; `Store` works them out lazily through `evaluate`, caches each until something it reads changes, and refuses writes (`DerivedWriteError`). |
| Expressions | `src/expr.ts` | Own tokenizer, parser and evaluator for `{…}`. Whitelisted functions only. |
| Actions | `src/actions.ts` | `on=` strings: `inc`, `dec`, `toggle`, `set`, `emit`, `go`, `back`, `notify`, `add`, `remove`, `clear`, chained with `;`. |
| Data | `src/data.ts` | Lists and records: frozen, null-prototype values; host data copied in (`toData`); `readField` is the only way expressions reach inside them. |
| Lists | `src/each.ts` | `each` copies: per-copy scope (`scopeOf`) and where each item lives in state, for writing (`locateOf`). |
| Paths | `src/paths.ts` | Writing to `t.done` or `settings.theme`: `placeOf`, and `setIn`, which never changes data in place. |
| Layout | `src/layout.ts` | Headless: needs only a `TextMeasurer`. Produces `Box` trees. `shownChildren` drops hidden children and replaces `each` and `if` blocks with what they stand for. |
| Engine | `src/engine.ts` | `SayShape` class: dirty-stage pipeline, canvas sizing, paint, hit testing, pointer and keyboard. |
| Components | `src/components/` | One `ComponentDef` per component. `map/` is a separate entry point. |
| Contract | `src/component.ts` | `ComponentDef`, `PropDef`, contexts, and `PropReader` for typed prop access. |
| Popups | `src/popup.ts` | One popup at a time (a select's list, a date picker's calendar): `ComponentDef.popup` measures and paints it; the engine places it in the visible area, paints it last, hit-tests it first, swallows outside presses, routes keys to it and closes it when its owner goes. Its highlight and scroll live in engine-held `PopupState`, never app state. |
| Debugging | `src/inspector.ts` | Layout/hit overlays, inspect mode, frame capture. |
| Model guide | `src/prompt.ts` | `languageGuide(registry, opts)` builds the system prompt from component definitions: `mode: "full"` (default) or `"compact"`, and a `profile`. Full mode with no profile must stay byte-identical to `test/fixtures/guide-full.txt` unless a change is meant (then update the fixture). |
| Profiles | `src/profiles.ts` | Which elements the model is told about. Separate from the renderer's registry and from validation (`enforceProfile`). |
| Theme | `src/theme.ts` | Design tokens; light and dark; `--loom-*` CSS overrides. |
| Testing | `src/testing/` | `loom-ui/testing`: `render()` runs the real engine in Node against a recording canvas. |
| Model | `src/model/` | `loom-ui/model`: streams a spec from an OpenAI-compatible endpoint, removes thinking and fences, checks it and repairs it once. `context.ts`: bounded refinement (`refine`) and usage totals (unknown stays `undefined`, never 0). |
| Evaluation | `eval/`, `scripts/eval.ts` | 41 requests scored against a real model (`npm run eval`); `--guide full,compact`, `--profile`, `--repair-guide` compare prompting variants. `npm run guide:size` measures the guide. |
| MCP server | `mcp/` | Its own package (`sayshape-mcp`, with its own dependencies): an MCP Apps server with `sayshape_guide` and `show_interface`, and a one-file view (`mcp/src/ui`) that runs the engine inside chat apps such as Claude and ChatGPT. Bundles `../src`. `npm --prefix mcp test`, `npm --prefix mcp run test:e2e`. |

Each stage reruns only when its inputs change: `invalidate("parse" | "layout" | "paint")`. A spec edit re-parses, a state change re-lays out, and hover only repaints.

## Rules that must not be broken

These are the project's core guarantees. A change that breaks one is wrong even if the tests pass.

1. **Specs can never run code.** Expressions go through `src/expr.ts` only. Never use `eval`, `new Function`, `with`, dynamic `import`, or property access on host objects. New expression features must keep the "no route to JavaScript" property, and `test/expr.test.ts` must keep testing escape attempts.
2. **The parser never throws.** Every problem becomes a `Diagnostic` with a line number. Errors skip the line and its children; warnings keep the element and ignore the bad part.
3. **Streaming must keep working.** Any prefix of a valid spec, cut at a line boundary, must parse into a valid, smaller tree. Never add syntax that needs a closing line (no `end` blocks or multi-line values). Blocks that work by indentation, like `each` and `if`, are fine: they need nothing to close.
4. **Components never hard-code design.** Colors, fonts, radii, spacing and type sizes come from `ctx.theme`. Specs choose roles (`tone=`, `variant=`, `style=`), never values.
5. **The model guide is generated, never hand-written.** Describe a component's props, text, children and example in its `ComponentDef`; `languageGuide()` and the docs read from there. Don't duplicate component documentation by hand anywhere else.
6. **Layout stays headless.** `layout()` must not touch the canvas or the DOM; it only uses `ctx.measure`. That is what makes it testable in Node.
7. **Rendering stays on the canvas.** The only DOM uses are a temporary native `<input>` over a field while someone types in it (`src/dom-editor.ts`) and, planned, a hidden accessibility mirror. Do not render visible UI with HTML.
8. **Models generate specs, never components.** Components are reviewed TypeScript code. Nothing a model outputs at runtime may register a component or run code.
9. **No new runtime dependencies** without a strong reason. The library currently has none. Dev dependencies are fine.

## Commands

```bash
npm install
npm run dev                # playground at /playground/index.html
npm test                   # unit, contract, streaming, fuzz and interaction tests
npm run test:visual        # visual regression (Playwright); baselines come from Linux:
npm run test:visual:docker #   VISUAL_ARGS=--update-snapshots npm run test:visual:docker
npm run bench              # benchmarks
npm run eval               # score a real model (settings in .env.local, see .env.example)
npm run guide:size         # model guide size by section, per mode and profile
npm run typecheck          # tsc --noEmit
npm run build              # library → dist/
npm run build:playground   # static playground → dist-playground/
npm run docs:components    # regenerate the README component reference
npm run docs:check         # fail if it's out of date
npm run new:component -- <name>   # scaffold and register a component
npm run build:world        # regenerate map outlines (rarely needed)
npm run site:dev           # the website (needs npm ci --prefix site); site:build, site:check
```

The website has its own dependencies in `site/package.json`; never add them to the library. Its demos import the engine from `src/`. Its component reference and model guide pages are generated (`npm run site:docs`), and `test/site.test.ts` checks every gallery example and every SayShape block in its Markdown.

## Before you say a change is done

1. `npm run typecheck` passes.
2. `npm test` passes, with new tests for new behavior.
3. `npm run build` passes.
4. If a component's definition changed, `npm run docs:components` has been run.
5. For anything visual, the change has been looked at in the playground in light and dark mode. Use the inspector's layout boxes to check sizes. If it changes how something looks, update the visual baselines in the same commit (Linux only: `VISUAL_ARGS=--update-snapshots npm run test:visual:docker`, or add the `update-visual-baselines` label to the pull request and CI commits them).
6. Spec examples you add anywhere (component `example`, README, docs) parse with no diagnostics. `test/prompt.test.ts` checks component examples automatically.

## How to add a component

1. Run `npm run new:component -- <name>`, which creates the `ComponentDef` in `src/components/` and a test file, and registers it. (For large components, use a subfolder with its own entry point if it carries heavy data, like `map/`.) The contract tests in `test/contract.test.ts` now run on it and fail until it meets the rules below.
2. Fill in everything a model needs: `description` (one or two plain sentences on when to use it), `text` if it takes quoted text, every prop with `type`, `description` and `default` or `required`, `children`/`parents` if relevant, and a short `example`.
3. Implement `layout(box, ctx)` (set `box.h`; containers lay out `box.children` through `ctx.layout`). Implement `paint` and/or `paintOver` using theme tokens. Interactive components call `ctx.addHit(box)` while painting and define `press` if pressing does more than run `on=`. For several pressable parts in one element (stepper buttons, stars, tabs, page numbers), call `ctx.addHit(partBox(...), { detail })` once per part: each part becomes its own Tab stop and `press` reads `ctx.target.detail`. Read a `bind=` value with `p.bound()` and write it with `ctx.set(p.raw("bind"), value)`, never through `ctx.scope(name)`: `bind=` can be a path like `t.done` inside `each`, and these resolve it from the element's own item. Components that write a `bind=` state should then call `runOn(ctx)`, so `on=` runs with the new value. Define `drag` to follow the pointer while it's held (an element with `drag` is never pressed) and `key` to handle keys like the arrows while focused; see `slider` in `src/components/input.ts`. For an element people type into, define `editor()` (where its text sits and how it looks) and check `ctx.isEditing(node)` in paint, so the real `<input>` draws the text while it's open; see `input`.
4. Make sure it's exported and in `coreComponents` in `src/components/index.ts` (the scaffold does this). A separate entry point exports its own list instead, like `mapComponents`; add that list to `ALL` in `test/contract.test.ts` so the contract tests cover it.
5. Add tests: parsing with good and bad props, layout at narrow and wide widths, and interaction (state after a press). If it binds, add it to the table in `test/write-data.test.ts`, which checks `bind=` on an item inside `each` for every binding component (and fails until you do). Use `render()` from `src/testing` for interaction. The contract tests already cover documentation, layout bounds, theme-only colors and keyboard reach.
6. Add or update a playground sample if it helps show the component.
7. Run `npm run docs:components`.

Read `src/components/input.ts` (button, check, stepper), `src/components/navigation.ts` (tabs, pagination: pressable parts) and `src/components/map/index.ts` (custom hit testing) as references. Shared helpers are in `src/components/util.ts`.

## How to change the language

Language changes touch several places. Do them together, in this order:

1. `src/parser.ts` (and `tokenizeLine` if the line syntax changes), `src/expr.ts` or `src/actions.ts`.
2. Validation and diagnostics for the new syntax, with clear messages that say how to fix the problem.
3. `src/prompt.ts` so the model guide explains it.
4. Tests, including streaming (every prefix parses) and, for expressions, sandbox escape attempts.
5. The language section of `README.md`.
6. Keep old specs working, or document the breaking change in the README.

## Code style

- TypeScript strict mode, including `noUncheckedIndexedAccess`. No `any`; prefer narrow types.
- Small, plain functions. Comments explain why, not what.
- User-facing messages (diagnostics, docs) use plain words and say how to fix the problem: `"button" has no prop "colour". Known props: on, variant, disabled, if`.
- Commit messages: a short summary line, then a body listing what changed.

## Current status

Version 0.1, the foundation, plus the Phase 1 testing and tooling and lists and data. Working: the engine, parser, expressions, actions, keyboard focus (including parts of elements), inspector, 40 components (layout: `column`, `row`, `grid`, `card`, `list`, `list-item`, `accordion`, `divider`, `spacer`, `each`; content: `text`, `image`, `code`, `badge`, `avatar`; data: `stat`, `rating`, `chart` (bar and line, one series), `table` and `table-column` (sorting and single-row selection through state), `map`, `pin`; input: `button`, `link`, `check`, `switch`, `radio`, `select` (its options in a popup), `date-picker` (a calendar in a popup; dates are YYYY-MM-DD text worked out in `src/dates.ts`, never with `Date`), `stepper`, `slider`, `input`; navigation: `screen`, `tabs`, `tab`, `breadcrumb`, `pagination`; feedback: `progress`, `skeleton`, `empty`), screens with `go:` and `back`, `notify:` messages, images (own origin plus `imageHosts`), dragging, lists and records in state and from the host, field reads and list functions in expressions, `each` (with keys, nesting and limits of 500 items and 10,000 copies), `bind=` and actions on paths (`t.done`), `add`/`remove`/`clear`, `if` blocks (a line holding only `if=`), `derive` lines (read-only values worked out from state, top level only), warnings for names nothing defines, list functions (`filter`, `find`, `search`, `sort`, `take`) and formatting (`money`, `number`, `plural`), text input through an editor host (a real `<input>` while typing; a fake in `loom-ui/testing`), the model guide in full and compact modes with component profiles, bounded refinement context and per-attempt usage, the playground (with Ask a model, through the dev server to any OpenAI-compatible server), `loom-ui/model`, `npm run eval`, `loom-ui/testing`, unit, contract, streaming, fuzz and visual tests, benchmarks, a component scaffold and CI, the MCP Apps server in `mcp/` (SayShape interfaces inside chat apps that support MCP Apps), and the website in `site/` (VitePress: landing page, playground, examples and docs, deployed to GitHub Pages; see `site/docs/contributing/website.md`).

Known gaps: the map can't be reached by keyboard (recorded in `test/contract.test.ts`).

Limits: a spec derives at most 200 values (`MAX_DERIVED` in `src/parser.ts`). A `select` offers at most 200 options (`MAX_SELECT_OPTIONS`), 8 shown at once. A `table` shows at most 200 rows and 8 columns (`MAX_TABLE_ROWS`, `MAX_TABLE_COLUMNS` in `src/components/table.ts`) and a message instead of more, or when its columns don't fit. A `chart` draws at most 200 items (`MAX_CHART_ITEMS`) and says so instead of drawing more, or when it's too narrow for them (`src/components/chart.ts`). Elements may nest at most `MAX_DEPTH` (100) levels (`src/parser.ts`), because layout and paint are recursive. Deeper lines become an error diagnostic and are skipped. Data literals nest at most 20 levels and hold at most 10,000 values (`src/data.ts`); `each` shows at most 500 items and 10,000 copies per layout (`src/each.ts`).

Not built yet (see `docs/PLAN.md`): data sources and host commands, multi-line text and form validation, scrolling regions, a general overlay element and the components that need it (`dialog`, `menu`, `tooltip`; the popup layer only serves a component's own popup, like select's list), multi-select, tables beyond 200 rows or with scrolling or editing, charts beyond one-series bar and line, date ranges and times, the accessibility mirror, a production model server package and the reference store app. Don't describe these as existing.

## Where to look next

- [`docs/PLAN.md`](docs/PLAN.md): phases, the component pipeline, the testing strategy and the on-the-fly generation architecture.
- [`docs/examples/ecommerce.md`](docs/examples/ecommerce.md): the target the plan builds toward, written in the proposed syntax.
