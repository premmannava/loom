---
title: Themes
description: How Loom themes work. Design tokens, light and dark themes, CSS overrides and extendTheme.
---

# Themes

Components never use literal colors or sizes. They read design tokens from the theme: `colors`, `space`, `radius`, `font`, `text` sizes and the `control` height. Specs choose **roles** (`tone=good`, `variant=secondary`, `style=title`) and the theme decides what each role looks like, so a generated screen always matches your app.

Loom ships `lightTheme` and `darkTheme`. With `theme: "auto"` (the default) it follows the page: a `data-theme="light"` or `data-theme="dark"` attribute on `<html>` if there is one, otherwise the system's light or dark setting.

## Overriding colors from CSS

With `theme: "auto"`, color tokens can be set as `--loom-*` CSS variables on the canvas or any ancestor:

```css
canvas {
  --loom-accent: #6d28d9;
  --loom-on-accent: #ffffff;
}
```

Token names become kebab case: `onAccent` is `--loom-on-accent`, `landHighlight` is `--loom-land-highlight`.

## Building a theme in code

```ts
import { extendTheme, lightTheme, darkTheme } from "loom-ui";

const brand = extendTheme(lightTheme, {
  colors: { accent: "#6d28d9" },
  radius: { md: 6 },
});
loom.setTheme(brand);
```

`setTheme` keeps the spec, state, selections and any open popup as they are. To follow light and dark yourself, set one theme or the other when your page's mode changes. This site does that: its own light/dark switch calls `setTheme` with `lightTheme` or `darkTheme`.

## Color tokens

| Token | Used for |
|---|---|
| `surface` | The background the screen is drawn on |
| `ink`, `muted` | Text, and quieter text |
| `line` | Field borders, dividers and table rules |
| `accent`, `onAccent` | Primary buttons, selections and focus of attention; the label color on the accent |
| `good`, `warn`, `bad` | Status roles (`tone=good`, …) |
| `focus` | The keyboard focus ring |
| `land`, `landHighlight`, `landHover` | The world map |
| `debug` | The inspector's overlays |

## Trying styles

The [playground](/playground) can preview a spec in four color styles and in light or dark, and copies the TypeScript to recreate a style with `extendTheme`. Styles change colors only; they're a playground feature, not part of the language, so models still can't choose colors.

## Contrast

Loom's default text and accent colors meet 4.5:1 against their surfaces. Its default field and divider lines are lighter than the 3:1 that WCAG asks of control boundaries; the playground's Neutral style meets it. Check contrast for any custom accent you choose, in both light and dark.
