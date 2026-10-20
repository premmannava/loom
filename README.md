# Loom

**A UI language built for AI models to write, and an engine that renders it entirely on its own.**

Loom has its own parser, layout engine, painter and input handling. It draws straight onto a `<canvas>`, without HTML elements, CSS layout or React. A model streams a few lines of Loom, and the interface appears on screen line by line while the model is still writing.

![The Loom playground: a spec on the left, the world map it describes rendered on canvas on the right](docs/images/playground.png)

```
state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
```

> **Status: 0.1, early foundation.** The engine, a first set of components, tests and debugging tools are in place. Text input, accessibility and the docs site come next. See [Limitations](#limitations) before using it for anything real.

---

## Contents

- [Why Loom](#why-loom)
- [Quick start](#quick-start)
- [The Loom language](#the-loom-language)
- [Components](#components)
- [Using the engine](#using-the-engine)
- [Connecting a model](#connecting-a-model)
- [How it works](#how-it-works)
- [Debugging](#debugging)
- [Writing a component](#writing-a-component)
- [Theming](#theming)
- [Project structure](#project-structure)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why Loom

Most generative UI today has a model write React code or JSON, then hands it to a web framework. Loom takes a different approach:

| | Model writes React/JSX | Loom |
|---|---|---|
| Half-finished output | Can't render until the code compiles | Every finished line renders immediately |
| A mistake in the output | One syntax error breaks the component | The bad line is skipped with a clear message |
| Safety | Generated code must be sandboxed | Specs can't run code at all |
| Who controls the look | Whatever CSS the model writes | The engine; the model only picks roles like `variant=secondary` |
| Build step | Compile and bundle | None: text in, pixels out |

Four ideas drive the design:

1. **Line-based and streamable.** One element per line and indentation for nesting, so a partial response is always a valid, smaller screen.
2. **Safe by construction.** `{expressions}` can only read state, do arithmetic and call a few whitelisted functions. There is no route from a spec to JavaScript.
3. **The engine owns the design.** Specs never contain colors, fonts or pixel sizes, so every generated screen stays on-brand.
4. **One source of truth.** Each component is defined once. That definition drives validation, documentation and the guide that teaches a model the language, so none of them can fall out of sync.

---

## Quick start

Requires Node.js 18 or newer.

```bash
git clone https://github.com/premmannava/loom.git
cd loom
npm install
npm run dev        # opens the playground
```

| Command | What it does |
|---|---|
| `npm run dev` | Starts the playground with live reload |
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Type-checks everything |
| `npm run build` | Builds the library into `dist/` |
| `npm run build:playground` | Builds the playground as a static site into `dist-playground/` |
| `npm run docs:components` | Regenerates the component reference in this README |
| `npm run build:world` | Regenerates the map's country outlines |

The playground streams sample specs as a model would. Once a sample finishes you can edit the spec, toggle the debugging overlays, and watch state and emitted actions in the panels.

---

## The Loom language

### Elements

One element per line: its type, optional quoted text, then `name=value` props.

```
button "Save changes" variant=secondary on=emit:save
```

Prop values can be bare (`variant=secondary`), quoted (`label="Water (L)"`) or an expression (`value={price * qty}`). Quotes can be escaped with a backslash.

### Nesting

Indent children under a container. Two spaces is the convention; tabs count as two spaces.

```
card
  text "Your order" style=title
  row
    button "Cancel" variant=secondary
    button "Pay"
```

### State

Declare state on unindented `state` lines, usually at the top. Values are numbers, `true`/`false`, `null` or text.

```
state qty=2 price=24 gift=false name="Ada"
```

State declared in a spec only sets the starting value. A value the user has already changed is kept when the spec is re-parsed.

### Expressions

Anything inside `{…}` is evaluated against state.

```
text "Total: ${qty * price + (gift ? 4 : 0)}"
stat label="Each" value={round(price / 3, 2)}
```

- Operators: `+ - * / %`, `== != < <= > >=`, `&& || !`, and `a ? b : c`
- Text joins with `+`: `{'$' + price}` (use single quotes inside a quoted prop)
- Functions: `min`, `max`, `round(n, digits)`, `floor`, `ceil`, `abs`, `fixed(n, digits)`
- There is no property access, assignment or global access. An unknown name shows as `—` rather than guessing.

### Actions

Interactive elements run actions from their `on=` prop.

| Action | Effect |
|---|---|
| `inc:key` or `inc:key:by` | Add 1 (or `by`) |
| `dec:key` or `dec:key:by` | Subtract 1 (or `by`), never below 0 |
| `toggle:key` | Flip true/false |
| `set:key:value` | Set a literal, or an expression: `set:total:{a + b}` |
| `emit:name` or `emit:name:value` | Tell the host app what the user chose |

Run several in order with `;`:

```
button "Place order" on="set:placed:true;emit:order:{qty}"
```

`emit` is how a generated screen talks back to your app, for example to send the user's choice to the model for the next step.

### Conditions

Every element accepts `if=`. The element (and everything inside it) is shown only while the condition is true.

```
text "Packed!" tone=good if=water
text "All done" if={read && walk && drink}
```

### Comments

Lines starting with `#` are ignored.

### Errors

Loom never stops on a mistake. Each problem becomes a diagnostic with a line number:

- **Errors** (unknown element, element in the wrong place): that line and anything nested under it are skipped.
- **Warnings** (unknown prop, bad value, broken expression): the element still renders, and the bad part is ignored.

```
L10  Unknown element "sparkle". It was skipped, along with anything inside it
L4   "button" has no prop "colour". Known props: on, variant, disabled, if
L7   variant should be one of primary, secondary, danger; got "huge"
```

---

## Components

| Category | Components |
|---|---|
| Layout | [`column`](#column), [`row`](#row), [`card`](#card), [`divider`](#divider), [`spacer`](#spacer) |
| Content | [`text`](#text) |
| Data | [`stat`](#stat), [`map`](#map), [`pin`](#pin) |
| Input | [`button`](#button), [`check`](#check) |
| Feedback | [`progress`](#progress) |

All components also accept `if=` ([Conditions](#conditions)). `map` and `pin` ship in a separate entry point, `loom-ui/map`, because the country outlines add about 76 KB.

<!-- COMPONENTS:START (generated from src/components) -->
### `column`

Stacks its children vertically.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 8). |
| `pad` | number | Inner padding in pixels (default 0). |

Children: any elements.

```
column gap=6
  text "First"
  text "Second"
```

### `row`

Places its children side by side, splitting the width equally.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 10). |
| `pad` | number | Inner padding in pixels (default 0). |
| `align` | `top` / `center` / `bottom` | Vertical alignment of children: top, center or bottom. |

Children: any elements.

```
row gap=10
  button "Cancel" variant=secondary
  button "Save"
```

### `card`

A surface that groups related content, stacked vertically.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 14). |
| `pad` | number | Inner padding in pixels (default 22). |

Children: any elements.

```
card
  text "Order summary" style=title
  text "2 items" tone=muted
```

### `divider`

A thin horizontal line separating sections.

```
divider
```

### `spacer`

Empty vertical space.

| Prop | Type | Description |
|---|---|---|
| `size` | number | Height in pixels (default 8). |

```
spacer size=16
```

### `text`

A paragraph or heading. Wraps to the available width. Use {expressions} to show state.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The words to show. May include {expressions}. |
| `style` | `display` / `title` / `lead` / `body` / `caption` | display, title, lead, body or caption. |
| `weight` | `regular` / `semibold` / `bold` | regular, semibold or bold. Titles default to bold. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |
| `align` | `left` / `center` / `right` | left, center or right. |

```
text "Weekend in Yosemite" style=title
text "{guests} guests, {nights} nights" tone=muted
```

### `stat`

A labelled number, for key figures like totals or counts.

| Prop | Type | Description |
|---|---|---|
| `label` | string, required | Short caption above the value. |
| `value` | string, required | The figure to show, usually an {expression}. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |
| `align` | `left` / `center` | left or center. |

```
stat label="Total" value="${price*qty}"
```

### `progress`

A horizontal bar showing how far a value is toward a maximum.

| Prop | Type | Description |
|---|---|---|
| `value` | number, required | Current amount, usually an {expression}. |
| `max` | number | The full amount (default 100). |
| `label` | string | Optional caption above the bar. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |

```
progress value={done} max=5 label="{done} of 5 steps"
```

### `button`

A pressable button that runs actions. Use emit: to tell the app what the user chose.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The button label. |
| `on` | action | What happens when pressed, e.g. inc:count, set:done:true, emit:book. Separate several with ; |
| `variant` | `primary` / `secondary` / `danger` | primary (filled), secondary (outlined) or danger. |
| `disabled` | condition | Expression; when true the button is greyed out and can't be pressed. |

```
button "Book now" on=emit:book
button "Back" variant=secondary on=dec:step
```

### `check`

A checkbox that toggles a true/false state value.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The label next to the box. |
| `bind` | state, required | The state name this checkbox reads and writes. |

```
state agreed=false
check "I agree to the terms" bind=agreed
```

### `map`

A world map with clickable countries. Highlight countries by name and add pin children for places.

| Prop | Type | Description |
|---|---|---|
| `highlight` | string | Comma-separated country names to tint, e.g. "Japan,Brazil". |
| `bind` | state | State name that receives the clicked country's name. |

Children: `pin`.

```
state picked=none
map highlight="Japan,Kenya" bind=picked
  pin "Tokyo" lat=35.68 lon=139.69
```

### `pin`

A labelled point on a map, placed by latitude and longitude.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The place name shown next to the pin. |
| `lat` | number, required | Latitude in degrees (-90 to 90). |
| `lon` | number, required | Longitude in degrees (-180 to 180). |

Only inside: `map`.

```
pin "Nairobi" lat=-1.29 lon=36.82
```
<!-- COMPONENTS:END -->

---

## Using the engine

> Loom isn't published to npm yet. Until it is, build it with `npm run build` and import from `dist/`, or import from `src/` in your own bundler. The examples use the package name it will have, `loom-ui`.

```ts
import { Loom, coreComponents } from "loom-ui";
import { mapComponents } from "loom-ui/map";

const canvas = document.querySelector("canvas")!;
const loom = new Loom(canvas, {
  components: [...coreComponents, ...mapComponents],
});

loom.setSpec(`
state count=0
card
  text "Clicked {count} times"
  button "Click me" on=inc:count
`);
```

The canvas fills its parent's width and grows to fit its content.

### Options

| Option | Default | Description |
|---|---|---|
| `components` | required | The components this instance understands |
| `theme` | `"auto"` | A `Theme`, or `"auto"` to follow light/dark mode and `--loom-*` CSS variables |
| `width` | parent width | A fixed width in CSS pixels |
| `minHeight` | `0` | Minimum canvas height |
| `padding` | `20` | Space around the whole screen |
| `animate` | `true` | Fade new elements in (off when the user prefers reduced motion) |

### Methods

| Method | Description |
|---|---|
| `setSpec(text, { resetState? })` | Replace the whole spec |
| `beginStream({ keepState? })` | Start a streamed spec; clears state unless `keepState` |
| `push(chunk)` | Append streamed text. Only complete lines render |
| `endStream()` | Finish the stream and render the last line |
| `on(event, handler)` | Subscribe to an event; returns an unsubscribe function |
| `state.get(key)` / `state.set(key, value)` | Read or change state from your app |
| `setTheme(theme)` | Switch themes |
| `find(type)` | All nodes of a type, e.g. `loom.find("button")` |
| `expose(name?)` | Put the instance on `window` for the console (default `window.loom`) |
| `destroy()` | Remove listeners and stop rendering |

### Events

| Event | Payload | When |
|---|---|---|
| `action` | `{ name, value, node }` | An `emit:` action ran |
| `change` | `{ key, value }` | A state value changed |
| `diagnostics` | `Diagnostic[]` | The spec's problems changed |
| `render` | `Metrics` | A frame was painted (node count and timings) |
| `inspect` | `{ node, box }` or `null` | Inspect mode selected something |

```ts
loom.on("action", ({ name, value }) => {
  if (name === "order") submitOrder(value);
});
```

### Keyboard

The canvas is focusable. Tab and Shift+Tab move between interactive elements, Enter or Space presses the focused one, and a focus ring is drawn on the canvas.

---

## Connecting a model

`languageGuide()` builds the system prompt that teaches a model Loom. It's generated from the registered components, so it always matches what the engine supports.

```ts
import { languageGuide } from "loom-ui";

const system = languageGuide(loom.registry);
```

Stream the model's response straight into the engine:

```ts
loom.beginStream();
for await (const chunk of streamFromYourServer(userPrompt)) {
  loom.push(chunk);
}
loom.endStream();
```

Then send the user's choices back to the model with `emit` actions:

```ts
loom.on("action", ({ name, value }) => {
  continueConversation(`The user chose ${name}: ${value}`);
});
```

> **Keep API keys on a server.** Call the model from your backend and stream the text to the browser. Never put a model API key in front-end code.

A ready-made model connection is on the [roadmap](#roadmap).

---

## How it works

```
spec text → parse → tree → layout → boxes → paint → canvas pixels
                               ↑                       │
             state ←── actions ←── pointer / keyboard ─┘
```

1. **Parse** (`src/parser.ts`). Each line becomes a node, and indentation decides its parent. Props are checked against the component definitions, and problems become diagnostics. While streaming, the unfinished last line is ignored.
2. **Layout** (`src/layout.ts`). Each component sets its own height given a position and width. Containers place their children: `column` and `card` stack them, `row` splits the width equally and centers them. The result is a box (`x, y, width, height`) for every element. Layout only needs a text measurer, so it runs without a canvas and is unit-tested.
3. **Paint** (`src/engine.ts`). The boxes are walked in order and each component draws itself with canvas calls, using colors from the theme. Interactive components register their boxes as hit regions while painting.
4. **Input**. A click or key press is matched against the hit regions, the component's actions run, state changes, and the pipeline runs again.

Each stage only reruns when its inputs change: editing the spec re-parses, a state change re-lays out, and hovering only repaints. A typical screen renders in well under a millisecond.

---

## Debugging

Browser DevTools can't see inside a canvas, so Loom ships its own tools. All of them are available in the playground and from code.

| Tool | How to use it | What it shows |
|---|---|---|
| Layout boxes | `loom.inspector.setBoxes(true)` | Every box, with its type and size |
| Hit regions | `loom.inspector.setHits(true)` | Exactly what is clickable |
| Inspect mode | `loom.inspector.setInspecting(true)` | Hover to highlight, click to select. The playground jumps to the spec line, and putting the cursor on a spec line selects its element |
| Describe | `loom.inspector.describe(node)` | A node's type, line, props and box |
| Frame capture | `await loom.inspector.captureFrame()` | Every canvas call made in one frame |
| Console | `loom.expose()` | `loom.tree`, `loom.boxes`, `loom.state.snapshot()`, `loom.find("button")` |

To find a bug, first decide which stage it's in:

- **An element is missing or wrong:** check `loom.diagnostics` and `loom.tree` (parse).
- **Wrong position or size:** turn on layout boxes (layout).
- **The box is right but it looks wrong:** capture a frame (paint).
- **A click does nothing:** turn on hit regions (input).

---

## Writing a component

A component is one `ComponentDef` object. Registering it is all it takes: the parser validates its props, the model guide describes it, and the engine lays it out and paints it.

```ts
import type { ComponentDef } from "loom-ui";

export const badge: ComponentDef = {
  type: "badge",
  category: "content",
  description: "A small rounded label for a status.",
  text: { description: "The badge label.", required: true },
  props: {
    tone: {
      type: "enum",
      values: ["accent", "good", "warn", "bad"],
      default: "accent",
      description: "Color role.",
    },
  },
  example: `badge "Shipped" tone=good`,

  layout(box) {
    box.h = 24;
  },

  paint(box, ctx) {
    const p = ctx.props(box.node);
    const label = p.text();
    const color = ctx.theme.colors[p.oneOf("tone", ["accent", "good", "warn", "bad"] as const, "accent")];
    const { g } = ctx;
    g.font = ctx.font(600, 12);
    const w = g.measureText(label).width + 20;
    ctx.roundRect(box.x, box.y, w, box.h, 12);
    g.fillStyle = color;
    g.fill();
    g.fillStyle = ctx.theme.colors.onAccent;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, box.x + w / 2, box.y + box.h / 2 + 1);
  },
};

const loom = new Loom(canvas, { components: [...coreComponents, badge] });
```

What a `ComponentDef` can define:

| Field | Purpose |
|---|---|
| `type`, `category`, `description`, `example` | Identity and documentation; also used in the model guide |
| `text` | Whether it takes quoted text |
| `props` | Prop names, types and descriptions, used for validation and docs |
| `children` | `"any"` or a list of allowed child types; omit for leaf components |
| `parents` | Restrict where it can appear |
| `layout(box, ctx)` | Required. Set `box.h`; containers also lay out `box.children` |
| `paint(box, ctx)` / `paintOver(box, ctx)` | Draw before or after children |
| `hitTest(box, x, y)` | Refine clicks inside the box (the map uses this per country) |
| `press(ctx)` | What happens on activation; by default it runs the `on` prop |
| `cursor(target)` | Mouse cursor over it |

Use `ctx.props(node)` to read props. It evaluates `{expressions}` and fills templates for you: `num`, `str`, `bool`, `cond`, `oneOf` and `text`.

---

## Theming

Components never use literal colors or sizes. They read design tokens from the theme: `colors`, `space`, `radius`, `font`, `text` sizes and `control` height. Loom ships `lightTheme` and `darkTheme`, and with `theme: "auto"` it follows the page's light or dark mode.

With `theme: "auto"`, you can override colors from CSS with `--loom-*` variables on the canvas or any ancestor:

```css
canvas {
  --loom-accent: #6D28D9;
  --loom-on-accent: #FFFFFF;
}
```

Or build a theme in code:

```ts
import { extendTheme, lightTheme } from "loom-ui";

const brand = extendTheme(lightTheme, {
  colors: { accent: "#6D28D9" },
  radius: { md: 6 },
});
loom.setTheme(brand);
```

---

## Project structure

```
src/
  engine.ts         The Loom class: pipeline, canvas, pointer and keyboard input
  parser.ts         Spec text → node tree, with diagnostics
  expr.ts           The safe expression language
  actions.ts        on= actions
  layout.ts         Headless layout
  component.ts      The ComponentDef contract and PropReader
  registry.ts       The set of components an instance knows
  inspector.ts      Debugging overlays, inspect mode, frame capture
  prompt.ts         Generates the model guide
  theme.ts          Design tokens
  text.ts           Text measuring and wrapping
  state.ts          The state store
  components/       Built-in components; map/ is a separate entry point
playground/         The development playground
test/               Unit tests (Vitest)
scripts/            Build scripts (map outlines, component docs)
docs/               Plan, examples and images
CLAUDE.md           Brief for AI assistants working on this repo
docs/images/        README images
```

---

## Limitations

Loom draws everything itself, so it gives up what the browser normally provides for free. Today it does **not** have:

- **Text input.** No text fields yet; this is the next priority.
- **Screen reader support.** A canvas is invisible to assistive technology. A hidden accessibility layer that mirrors the canvas is planned.
- **Text selection, copy and browser find.**
- **Scrolling regions, overlays, dialogs or menus.**
- **Right-to-left or complex-script text shaping** beyond what the canvas does on its own.

Don't use Loom where accessibility is required until the accessibility layer lands.

---

## Roadmap

The full phase-by-phase plan, including the component pipeline, testing strategy and how a model generates UI on the fly, is in [`docs/PLAN.md`](docs/PLAN.md). [`docs/examples/ecommerce.md`](docs/examples/ecommerce.md) shows the complete store the plan builds toward.

1. **Foundation** (0.1, done): engine, parser, expressions, actions, keyboard focus, inspector, first components, tests, playground.
2. **Components**: text input (a real input positioned over the canvas while typing), select, tabs, table, list, chart, dialog and toast, plus the accessibility layer.
3. **Docs site**, built with Loom so every example is live.
4. **Model connection**: a server-side streaming endpoint and a measured comparison against other generative UI formats (token count, validity, time to first pixel).
5. **An app** built on top.

---

## License

[MIT](LICENSE).

Country outlines in `src/components/map/world.json` come from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas).
