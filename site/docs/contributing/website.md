---
title: Publishing this site
description: How the Loom website is built with VitePress and deployed to GitHub Pages, and how to run it locally.
---

# Publishing this site

This website lives in `site/` and is built with [VitePress](https://vitepress.dev). It has its own `package.json` and lockfile, so its dependencies (VitePress, Vue, fonts) never become dependencies of the `loom-ui` library. Its demos import the engine straight from `src/`, so they always run the code in the repository.

## Run it locally

```bash
npm ci                    # the library's dependencies (also used to generate pages)
npm ci --prefix site      # the website's dependencies
npm run site:dev          # http://localhost:5173/loom/
```

`site:dev` and `site:build` first run `npm run site:docs`, which writes the component reference and model guide pages from the component definitions. Those generated files are ignored by git.

To check the production build the way GitHub Pages will serve it:

```bash
npm run site:build        # site/.vitepress/dist
npm run site:preview      # http://localhost:4173/loom/
npm run site:check        # internal links, assets, no localhost or secrets in the output
```

## Deployment

`.github/workflows/pages.yml` builds the site on every pull request (without publishing) and deploys it from `main` with GitHub's official Pages actions. It runs the website tests first, so a broken example or invalid snippet stops the deploy.

One-time repository setting, done by a repository admin:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

After the next push to `main` (or running the workflow by hand from the **Actions** tab), the site is at **https://premmannava.github.io/loom/**.

## How it's put together

| Path | What it is |
|---|---|
| `site/index.md`, `site/playground.md`, `site/examples/` | The landing page, playground and gallery, as Vue components in the theme |
| `site/examples/catalog.ts` | The gallery's specs: plain data, tested in `test/site.test.ts` |
| `site/docs/` | The documentation; `docs/components/` is generated |
| `site/.vitepress/theme/loom/` | Creating Loom instances in the browser, highlighting, events |
| `site/.vitepress/markdown.ts` | ` ```loom live ` blocks: highlighted source plus a live render |
| `scripts/gen-site-docs.ts` | Generates the component reference and guide pages |
| `scripts/check-site.mjs` | Checks the built site's links, assets and contents |

The engine needs a canvas, fonts and `window`, so every demo creates its instance after the page mounts in the browser and destroys it, with all its listeners, when the page unmounts. Pages are emitted as `.html` files, so every route works when visited directly or refreshed on GitHub Pages, which has no server-side routing.

The site has no model connection and no secrets: nothing from `.env.local` is read by the site build.
