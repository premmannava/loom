---
title: Local setup
description: Clone the SayShape repository, install it, run the tests and open the development playground.
---

# Local setup

SayShape isn't published to npm yet, so you work from the repository. You need **Node.js 18 or newer** and npm.

```bash
git clone https://github.com/premmannava/sayshape.git
cd sayshape
npm ci            # installs exactly what package-lock.json lists
npm run dev       # opens the development playground
```

`npm run dev` starts Vite and opens `/playground/index.html`: samples stream in on the left and render on the right, with the debugging panels underneath. It's the same engine as the [public playground](/playground), plus the **Ask a model** box, which needs a model server (see [Connecting a model](../integration/model)).

## Check that everything works

These are the checks the repository expects to pass before a change is merged, and the ones CI runs:

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit, contract, streaming, fuzz and interaction tests (Vitest)
npm run build       # the library, into dist/
npm run docs:check  # the README's component reference is up to date
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The development playground, with live reload |
| `npm test` | Unit, contract, streaming, fuzz and interaction tests |
| `npm run test:visual` | Visual regression tests (Playwright) |
| `npm run bench` | Benchmarks for parse, layout and paint |
| `npm run eval` | Scores a real model on a set of requests ([Measure it](../integration/model#measure-it)) |
| `npm run guide:size` | The model guide's size by section, mode and profile |
| `npm run build` | The library, into `dist/` |
| `npm run build:playground` | The development playground as static files |
| `npm run new:component -- <name>` | Scaffolds and registers a component |
| `npm run site:dev` | This website, with live reload ([Publishing this site](../contributing/website)) |

## Using it from another project

Build the library, then install the repository folder into your app as a local dependency. npm records it as a `file:` dependency, and the package's own `exports` give you `loom-ui`, `loom-ui/map`, `loom-ui/testing` and `loom-ui/model`.

```bash
# in the sayshape folder
npm run build

# in your app's folder
npm install ../sayshape
```

Rebuild SayShape after pulling changes. The package is still named `loom-ui`, SayShape's earlier working name; it will be renamed before it's published. When SayShape is published, this becomes an ordinary `npm install`.

Next: [render your first interface](./first-interface).
