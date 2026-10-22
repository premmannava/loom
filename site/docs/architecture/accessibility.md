---
title: Accessibility
description: The current accessibility status of Loom's canvas renderer, what works today, and what is planned.
---

# Accessibility

::: danger Canvas content isn't available to screen readers yet
Loom draws interfaces on a `<canvas>`, which assistive technology can't read. A hidden accessibility layer that mirrors the canvas is planned but not built. **Don't use Loom where accessibility is required until it lands.**
:::

## What works today

- **Keyboard.** Every interactive element is reachable with Tab and Shift+Tab, including separate parts of one element (a stepper's buttons, each star of a rating, each tab, each page number, a table's headers and rows). Enter and Space press the focused element; sliders, selects and date pickers follow the arrow keys. The engine draws a focus ring in the theme's focus color. The one gap: the world map can't be reached by keyboard.
- **Text entry.** While someone types, a real `<input>` sits over the field, so typing, input methods, autofill, password managers and the phone keyboard work as they do in any form.
- **Reduced motion.** Elements fade in only when the person hasn't asked for reduced motion.
- **Contrast.** The default themes' text and accent colors meet 4.5:1. Field and divider lines are lighter than WCAG's 3:1 for control boundaries.
- **A label.** The canvas gets `aria-label="Generated interface"` unless you set your own.

## What's missing

- Screen reader access to any element, its role, state or value.
- Text selection, copy and the browser's find in page.
- Right-to-left text and complex script shaping beyond what the canvas does on its own.
- Respecting the person's text size settings and high-contrast modes.

## On this website

The site's own pages, navigation, documentation and controls are ordinary HTML with keyboard focus styles. The interfaces in demos are canvases, so next to each one the **spec** is shown as text: it's the readable source of what the canvas shows.
