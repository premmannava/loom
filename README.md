# Loom

Loom is a UI language designed for AI models to write, and an engine that renders it by itself onto a canvas: its own parser, layout, painting and input handling, with no HTML elements and no React.

```
state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
```

Status: **early foundation (0.1)**. The engine, a first set of components, tests and debugging tools are in place. Text input, accessibility and the docs site are next.

## Why

Most generative UI today has a model write React code or JSON, then hands it to a web framework. Loom tries a different split:

- **The language is built for models.** One element per line, so every finished line renders while the model is still streaming. A mistake skips one line with a clear message instead of breaking the screen.
- **It can't run code.** Expressions only read state and do arithmetic. There is no way to reach JavaScript from a spec.
- **The engine owns the look.** Models choose `style=title` or `variant=secondary`, never colors or pixel sizes, so every generated screen stays on-brand.
- **The model guide is generated** from the component definitions, so the model's picture of the language can't drift from the engine.

## Quick start

```bash
npm install
npm run dev      # opens the playground
npm test         # unit tests
npm run build    # library build into dist/
```

Using the engine:

```ts
import { Loom, coreComponents, languageGuide } from "loom-ui";
import { mapComponents } from "loom-ui/map";

const loom = new Loom(canvas, { components: [...coreComponents, ...mapComponents] });

// Whole spec at once
loom.setSpec(specText);

// Or streamed from a model
loom.beginStream();
for await (const chunk of modelStream) loom.push(chunk);
loom.endStream();

// Hear what the user chose (from `emit:` actions)
loom.on("action", ({ name, value }) => console.log(name, value));

// The system prompt that teaches a model the language
const guide = languageGuide(loom.registry);
```

## How it works

```
spec text → parse → tree → layout → boxes → paint → canvas pixels
                               ↑                       │
             state ←── actions ←── pointer / keyboard ─┘
```

Each stage only re-runs when its inputs change: editing the spec re-parses, a state change re-lays out, hovering only repaints.

| File | Job |
|---|---|
| `src/parser.ts` | Spec text → node tree, with line-numbered diagnostics |
| `src/expr.ts` | The safe `{expression}` language |
| `src/actions.ts` | `on=` actions: inc, dec, toggle, set, emit |
| `src/layout.ts` | Headless layout: nodes → positioned boxes |
| `src/engine.ts` | The `Loom` class: pipeline, canvas, pointer and keyboard input |
| `src/component.ts` | The component contract (`ComponentDef`) |
| `src/components/` | Built-in components; `map/` is a separate entry point |
| `src/inspector.ts` | Debugging overlays, inspect mode, frame capture |
| `src/prompt.ts` | Generates the model guide from the registry |
| `src/theme.ts` | Design tokens for light and dark |

## Components

| Category | Components |
|---|---|
| Layout | `column`, `row`, `card`, `divider`, `spacer` |
| Content | `text`, `stat` |
| Input | `button`, `check` |
| Feedback | `progress` |
| Data | `map`, `pin` (from `loom-ui/map`) |

Every component is one `ComponentDef` object describing its props (used for validation, docs and the model guide), how it measures, how it paints and how it responds to presses. Adding a component never touches the engine.

## Debugging

Browser DevTools can't see inside a canvas, so Loom brings its own tools:

- **Layout boxes**: every box with its type and size.
- **Hit regions**: exactly what is clickable.
- **Inspect mode**: hover to highlight, click to select. The playground jumps to the spec line that created the element, and putting the cursor on a spec line selects its element.
- **Console**: `loom.tree`, `loom.boxes`, `loom.state.snapshot()`, `loom.find("button")`, `loom.state.set("days", 9)`.
- **Frame capture**: `await loom.inspector.captureFrame()` returns every canvas call made in one frame.

## Keyboard

Tab and Shift+Tab move between interactive elements, Enter or Space presses the focused one, and a focus ring is drawn on the canvas.

## Roadmap

1. **Foundation** (this release): engine, tests, inspector, first components.
2. **Components**: text input (via a positioned native input), select, tabs, table, list, chart, dialog, toast, plus an accessibility layer that mirrors the canvas for screen readers.
3. **Docs site**, built with Loom so every example is live.
4. **Real model** connection and streaming.
5. **App** on top.

## License

MIT. Country outlines in `src/components/map/world.json` come from Natural Earth (public domain) via world-atlas.
