---
title: How the engine works
description: SayShape's architecture. Parser, layout, painter, state, actions, popups and debugging tools, and the files that hold them.
---

# How the engine works

<EngineDiagram />

| Stage | File | What it does |
|---|---|---|
| Parse | `src/parser.ts` | Text to a `SayShapeNode` tree plus line-numbered diagnostics, validated against the component definitions |
| Expressions | `src/expr.ts` | Its own tokenizer, parser and evaluator for `{…}`, with a fixed list of functions |
| Derived values | `src/state.ts` | `derive` values, worked out lazily and cached until something they read changes |
| Actions | `src/actions.ts` | `on=` strings: `inc`, `dec`, `toggle`, `set`, `emit`, `go`, `back`, `notify`, `add`, `remove`, `clear` |
| Data | `src/data.ts` | Lists and records: frozen, with no prototype; host data is copied in |
| Lists | `src/each.ts` | `each` copies, each item's scope, and where it lives in state for writing |
| Layout | `src/layout.ts` | Headless: needs only a text measurer, and produces a box per element |
| Engine | `src/engine.ts` | The `SayShape` class: the staged pipeline, canvas sizing, painting, hit testing, pointer and keyboard |
| Components | `src/components/` | One `ComponentDef` per component; the map is a separate entry point |
| Popups | `src/popup.ts` | One popup at a time (a select's list, a date picker's calendar), painted last and hit-tested first |
| Theme | `src/theme.ts` | Design tokens, light and dark, `--loom-*` overrides |
| Model guide | `src/prompt.ts`, `src/profiles.ts` | The guide generated from components, in full and compact modes, with profiles |
| Model client | `src/model/` | `loom-ui/model`: streaming, cleaning, checking and one repair |
| Testing | `src/testing/` | `loom-ui/testing`: the real engine in Node against a recording canvas |

## Staged rendering

The engine tracks which stage is out of date: `parse`, `layout` or `paint`. A spec edit re-parses; a state change re-lays out; hovering or a focus ring only repaints. Frames are scheduled with `requestAnimationFrame`, and the `render` event reports how long each stage took. The playground shows those timings for the current spec.

## Components

A component is one `ComponentDef`: identity and documentation (`type`, `category`, `description`, `props`, `children`, `parents`, `example`), `layout(box, ctx)` to set its height and place children, `paint` and `paintOver` to draw with theme tokens, and optionally `press`, `drag`, `key`, `hitTest`, `editor` and `popup`. Registering it is all it takes: the parser validates its props, the guide describes it, the reference on this site documents it, and the engine lays it out and paints it. See [Adding a component](../contributing/components).

## Text input

Text fields are drawn on the canvas like everything else. While someone types in one, the engine places a real `<input>` exactly over it, with the field's font and colors, so the browser handles typing, selection, copy and paste, undo, input methods, autocorrect, password managers and the phone keyboard. Every keystroke writes the field's `bind=`. The `<input>` is removed when they leave the field.

## Popups

A `select` shows its options, and a `date-picker` its calendar, in a popup the engine draws above everything else. Only one is open at a time; a press outside closes it without pressing what's underneath; keys go to it while it's open. Because a canvas can't draw outside itself, the canvas grows while a long list is open and shrinks back afterwards.

## Debugging

Browser developer tools can't see inside a canvas, so SayShape has its own. All of them are in the [playground](/playground), and available from code:

| Tool | How | What it shows |
|---|---|---|
| Layout boxes | `loom.inspector.setBoxes(true)` | Every box, with its type and size |
| Hit regions | `loom.inspector.setHits(true)` | Exactly what is clickable |
| Inspect mode | `loom.inspector.setInspecting(true)` | Hover to highlight, click to select; `selectLine(n)` selects the element on a spec line |
| Describe | `loom.inspector.describe(node)` | A node's type, line, props and box |
| Frame capture | `await loom.inspector.captureFrame()` | Every canvas call made in one frame |
| Console | `loom.expose()` | Puts the instance on `window.loom` |

To find a bug, decide which stage it's in: an element missing or wrong is the parse (check `loom.diagnostics`); a wrong position or size is layout (turn on boxes); a right box that looks wrong is paint (capture a frame); a click that does nothing is input (turn on hit regions).
