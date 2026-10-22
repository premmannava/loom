# Plan: text input

**Status:** done (2026-10-21), steps 1 to 5. What changed along the way is under [Results](#results). Part of [Phase 3](../PLAN.md#phase-3-components-and-engine) (the text input capability and the `input` component).
**Rough size:** 3 to 4 days, in five steps that each end in a working, tested commit.

## The problem

SayShape has no way to type. Testing with Qwen3 14B showed what that costs:

- Asked for a contact list where you can add a contact, the model invented an `input` element, which SayShape skips.
- "A login form" is an eval trap today, because it can't be built.
- A to-do list can only add a ready-made task ("Trail mix"), not one the user names.
- Search boxes and filters, the most common thing a generated screen needs, can't be made at all.

## What it will look like

```
state todos=[{text: "Pack water", done: false}] task=""
card
  text "Packing list" style=title
  each items=todos as=t
    check "{t.text}" bind=t.done
  row
    input "New item" bind=task placeholder="e.g. Sunscreen" on="add:todos:{text: task, done: false};set:task:''"
    button "Add" on="add:todos:{text: task, done: false};set:task:''" disabled={task == ''}
```

A search that filters a list as you type:

```
state query="" trails=[{name: "Camelback", miles: 2.5}, {name: "Piestewa Peak", miles: 2.1}, {name: "Flatiron", miles: 5.8}]
card
  input "Search trails" bind=query kind=search placeholder="Trail name"
  each items=trails as=t
    list-item "{t.name}" trailing="{t.miles} mi" if={includes(lower(t.name), lower(query))}
```

(A "no results" message would need to count the matches, which needs a list filter function. That's left for later.)

## The design

### 1. The `input` component

| Prop | Meaning |
|---|---|
| `"Label"` | Shown above the field, and read by screen readers |
| `bind` | The state name or path it reads and writes (required). Works inside `each` (`bind=t.text`) |
| `placeholder` | Hint shown while it's empty |
| `kind` | `text` (default), `email`, `number`, `password`, `search`. Picks the phone keyboard and what autofill offers. `number` writes a number, or `null` while empty |
| `on` | Runs when Enter is pressed, after the value is written |
| `disabled` | As on buttons |
| `max` | Longest value in characters (default 500, at most 10,000) |

SayShape paints the field: label, box, placeholder or value, and a focus ring, all from the theme. A password shows as dots. Long values are cut with an ellipsis when not focused.

### 2. Typing: a real `<input>`, only while focused

This is the approach the project brief already allows (rule 7: "a temporary native `<input>` while typing").

- When a field gets focus (clicked, tapped or reached with Tab), the engine places one real `<input>` exactly over the field's text area, styled with the theme's font, size and colors, with a transparent background. SayShape keeps painting the box, label and focus ring; the browser paints only the text, the caret and the selection.
- So the browser does what it's good at: typing, selection, copy and paste, undo, IME for Chinese, Japanese and Korean, autocorrect, password managers, autofill and the phone keyboard.
- **Every keystroke writes state.** That re-lays out the screen, so filters, counts and `{task}` in other text update as you type.
- When focus leaves (Tab, Escape, a click elsewhere), the `<input>` is removed and the canvas draws the value again.
- **Tab and Shift+Tab** in the field move to the next or previous canvas element, so the keyboard order stays the same. **Enter** writes the value and runs `on=`.
- The `<input>` follows the field when the page scrolls, the window resizes, or the layout changes while typing (for example a list growing above it). If the field disappears (its `if=` turns false), the `<input>` goes too.
- **Phones:** iPhones only open the keyboard if focus happens during the tap itself, so the engine focuses the `<input>` inside the pointer event, not on the next frame.

**For tests and Node:** the engine talks to an *editor host* interface. The browser host makes the `<input>`. `loom-ui/testing` uses a fake one, and gains `ui.type(query, text)`, so typing is tested in Node like everything else.

### 3. Language and guide

- One new expression function each for `lower(text)` and `upper(text)`, so searches can ignore case, and `trim(text)`. These were already planned for Phase 2.1.
- The guide gets the `input` element from its definition, as always, plus a line in DATA AND LISTS: "To add an item the user names, bind an input to a state value and add it: on="add:todos:{text: task, done: false};set:task:''"". The "no text fields yet" line goes.
- Validation (required fields, email format) is left for later. A model can already show a hint with `if=`.

### 4. Eval and samples

- `trap-login` stops being a trap and becomes a form case that expects `input`. The contacts case expects `input` too.
- New behavior check: typing into the first `input` changes the screen (a filter, a count, a greeting).
- Two new requests: a search that filters a list, and a sign-up form.
- New playground samples: "Search" (filter a list as you type) and a packing list with an Add field.

## Steps

| # | Step | Includes | Tests |
|---|---|---|---|
| 1 | **The field, painted** | `input` component: layout, paint (label, box, placeholder, value, password dots, ellipsis, focus ring), `bind` read, contract tests, docs | Layout at narrow and wide widths, theme-only colors, keyboard reach |
| 2 | **Typing in tests** | The editor host interface, the fake host, `ui.type()`, writing state on each keystroke, Enter runs `on=`, `kind=number` | Typing updates state and other text; inside `each` writes the item; Enter adds an item |
| 3 | **Typing in the browser** | The real `<input>`: placed and styled from the theme, follows scroll, resize and layout, Tab handoff both ways, Escape, removed when hidden, focus inside the tap for phones | Playwright: click and type, Tab through fields and buttons, IME composition events, a field that moves while typing; tried by hand on an iPhone and Android |
| 4 | **Guide, eval and samples** | `lower`, `upper`, `trim`; guide line; eval changes and the typing check; Search and packing samples; visual baselines | Guide examples parse and work; samples stream cleanly |
| 5 | **Docs** | README (component reference is generated; Limitations and Keyboard sections by hand), CLAUDE.md, PLAN.md | `docs:check` |

## Risks

- **The `<input>` and the canvas drifting apart.** If they're off by a pixel the text jumps when focus moves. Same font, size and baseline from the theme, and a Playwright screenshot comparing the focused and unfocused field, keep them aligned.
- **Text measured differently.** The canvas and the `<input>` both use the browser's text engine with the same font string, so widths match; long values scroll inside the `<input>` while typing and get an ellipsis on the canvas.
- **Re-layout on every keystroke.** A state change re-lays out the whole screen (about 5 ms for 1,000 elements today). That's fine for typing; the 500-item list benchmark shows the cost for big screens.
- **Phones.** Keyboard opening and page zoom on focus differ between iOS and Android. A font size of at least 16 px stops iOS from zooming. Needs a hand test on real devices.
- **Privacy.** A `password` field's value is still state, so it reaches the host through `change` events and would be visible in the playground's state panel. The playground will mask it; apps should treat it like any form value.

## Decisions to confirm

1. **Name and shape:** one `input` element with `kind=` (text, email, number, password, search), rather than separate elements. Multi-line text (`lines=3`) comes later.
2. **When state changes:** on every keystroke, so filters update live, rather than only when leaving the field.
3. **Native `<input>` while focused** (the approach in PLAN.md), rather than drawing a caret and handling keys on the canvas, which would lose IME, autofill, password managers and the phone keyboard's features.

## Results

All five steps shipped on `develop`, with Node tests through a fake editor host and Playwright tests with the real `<input>`.

Changes from the design above:

- **Decisions as proposed:** one `input` with `kind=`; state written on every keystroke; a real `<input>` only while typing.
- **Tabbing onto the canvas** now starts typing when its first element is a field. Before, the engine focused the field without opening it, so typing did nothing.
- **The input sits right after the canvas** in the page (position: fixed), so Tab past the last element leaves the canvas as it would from a normal field.
- **What's typed is kept** while the stored value is what it wrote: `1.` in a number field stores `1` without the field losing its dot.
- **The playground masks password values** in its state panel.
- **Alignment** is checked in Playwright by comparing the field's text before and while typing; they match to the pixel.

Still to do: multi-line text (`lines=`), validation, and a hand test on a real iPhone and Android phone.
