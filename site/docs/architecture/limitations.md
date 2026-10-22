---
title: Limits and status
description: What SayShape can and can't do today, its built-in limits, and what's planned.
---

# Limits and status

SayShape is an **early prototype, version 0.1**. This page separates what's built from what's planned. If something isn't listed as built, assume it isn't.

## Built

- The engine: parser, expressions, actions, layout, painting, hit testing, keyboard focus (including parts of elements), popups and the inspector.
- 40 components ([reference](../components/)): layout, content, data (stat, rating, bar and line charts, tables with sorting and selection, the world map), input (buttons, checks, switches, radios, select, date picker, stepper, slider, text input), navigation (screens, tabs, breadcrumb, pagination) and feedback (progress, skeleton, empty).
- State with lists and records, host data, `each` with keys and nesting, `bind=` and actions on paths, `add`, `remove` and `clear`, `if` blocks, `derive` lines, list and formatting functions, screens with `go:` and `back`, `notify:` messages, and images from allowed hosts.
- The model guide (full and compact, with profiles), `loom-ui/model` (streaming, cleaning, checking, one repair, bounded refinement), an evaluation script, and `loom-ui/testing`.
- Unit, contract, streaming, fuzz and visual tests, benchmarks, a component scaffold and CI.

## Not built yet

- **Accessibility layer.** Canvas content isn't exposed to screen readers ([Accessibility](./accessibility)).
- **Data sources and host commands.** Your app fetches data and sets state; a spec can't declare where data comes from.
- **Multi-line text and form validation** (required fields, email format). A spec can show a hint with `if=` for now.
- **Scrolling regions and overlays.** No scrolling areas inside a screen, and no dialogs, menus or tooltips. The popup layer only serves a component's own popup.
- **Multi-select**, typing to search in a select, option groups.
- **Larger tables**: more than 200 rows, scrolling, sticky headers, editable cells, multi-row selection.
- **More charts**: pie, stacked, several series, legends, tooltips, time or numeric axes.
- **Dates beyond one day**: ranges, times, time zones, other locales.
- **Packaging**: an npm release and a production model server.

## Built-in limits

| Limit | Value |
|---|---|
| Nesting depth | 100 levels; deeper lines are an error and skipped |
| Derived values per spec | 200 |
| Items per `each` | 500 |
| Repeated elements per screen | 10,000 |
| Data literals | 20 levels deep, 10,000 values |
| `select` options | 200, eight shown at once |
| `table` | 200 rows and 8 columns; a message instead of more |
| `chart` | 200 items, one series |

Numbers, money and dates are formatted in US English. Weeks start on Sunday.

## Claims this site doesn't make

SayShape hasn't been benchmarked against other UI approaches, so nothing here says it's faster or uses fewer tokens. The engine's own timings are shown in the playground for the spec you're looking at. Model quality varies by model; measure yours with `npm run eval`.

## Roadmap

The phase plan is in [`docs/PLAN.md`](https://github.com/premmannava/loom/blob/main/docs/PLAN.md) in the repository: scrolling and dialogs plus the accessibility layer next, then the model server and an app built on top.
