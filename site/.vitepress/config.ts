import { defineConfig, type DefaultTheme } from "vitepress";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../../src/component";
import { loomLivePlugin } from "./markdown";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const loomGrammar = JSON.parse(readFileSync(here("./loom.tmLanguage.json"), "utf8"));

const REPO = "https://github.com/premmannava/loom";
const SITE_URL = "https://premmannava.github.io/loom/";
const TITLE = "Loom";
const DESCRIPTION = "A UI language for AI models to write, and a canvas engine that renders it: parser, layout, painting, state and input of its own.";

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

const docsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Getting started",
    items: [
      { text: "What Loom is", link: "/docs/" },
      { text: "Local setup", link: "/docs/getting-started/setup" },
      { text: "Your first interface", link: "/docs/getting-started/first-interface" },
      { text: "From spec to pixels", link: "/docs/getting-started/pipeline" },
    ],
  },
  {
    text: "Language",
    items: [
      { text: "Elements and nesting", link: "/docs/language/elements" },
      { text: "State", link: "/docs/language/state" },
      { text: "Bindings", link: "/docs/language/bindings" },
      { text: "Expressions and functions", link: "/docs/language/expressions" },
      { text: "Derived values", link: "/docs/language/derived" },
      { text: "Lists and iteration", link: "/docs/language/lists" },
      { text: "Conditional visibility", link: "/docs/language/conditions" },
      { text: "Actions and navigation", link: "/docs/language/actions" },
      { text: "Validation and diagnostics", link: "/docs/language/diagnostics" },
    ],
  },
  {
    text: "Components",
    items: [
      { text: "Overview", link: "/docs/components/" },
      ...CATEGORIES.map((c) => ({ text: cap(c), link: `/docs/components/${c}` })),
    ],
  },
  {
    text: "Integration",
    items: [
      { text: "Embedding Loom", link: "/docs/integration/embedding" },
      { text: "Host data and events", link: "/docs/integration/host-data" },
      { text: "Loading, success and failure", link: "/docs/integration/states" },
      { text: "Themes", link: "/docs/integration/themes" },
      { text: "Images", link: "/docs/integration/images" },
      { text: "Connecting a model", link: "/docs/integration/model" },
      { text: "The model guide", link: "/docs/integration/model-guide" },
      { text: "Streaming, validation and repair", link: "/docs/integration/streaming" },
    ],
  },
  {
    text: "Architecture",
    items: [
      { text: "How the engine works", link: "/docs/architecture/" },
      { text: "The expression boundary", link: "/docs/architecture/security" },
      { text: "Accessibility", link: "/docs/architecture/accessibility" },
      { text: "Limits and status", link: "/docs/architecture/limitations" },
    ],
  },
  {
    text: "Contributing",
    items: [
      { text: "Development", link: "/docs/contributing/" },
      { text: "Adding a component", link: "/docs/contributing/components" },
      { text: "Publishing this site", link: "/docs/contributing/website" },
    ],
  },
];

export default defineConfig({
  base: "/loom/",
  lang: "en-US",
  title: TITLE,
  titleTemplate: ":title · Loom",
  description: DESCRIPTION,
  // Pages are emitted as .html files, which GitHub Pages serves for direct visits and refreshes.
  cleanUrls: false,
  srcExclude: ["README.md", "**/node_modules/**"],
  appearance: true,
  sitemap: { hostname: SITE_URL },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/loom/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#0E7C76" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: TITLE }],
    ["meta", { property: "og:title", content: "Loom: a UI language for AI, and an engine that brings it to life" }],
    ["meta", { property: "og:description", content: DESCRIPTION }],
    ["meta", { property: "og:url", content: SITE_URL }],
    ["meta", { property: "og:image", content: `${SITE_URL}og.png` }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],
  themeConfig: {
    logo: { light: "/logo.svg", dark: "/logo-dark.svg", alt: "" },
    siteTitle: "Loom",
    nav: [
      { text: "Playground", link: "/playground", activeMatch: "^/playground" },
      { text: "Examples", link: "/examples/", activeMatch: "^/examples" },
      { text: "Docs", link: "/docs/", activeMatch: "^/docs/" },
    ],
    socialLinks: [{ icon: "github", link: REPO, ariaLabel: "Loom on GitHub" }],
    sidebar: { "/docs/": docsSidebar },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    editLink: { pattern: `${REPO}/edit/main/site/:path`, text: "Suggest a change to this page" },
    footer: {
      message: `Loom is an early prototype (v0.1), released under the MIT License. <a href="${REPO}">Source on GitHub</a>.`,
    },
  },
  markdown: {
    languages: [loomGrammar],
    theme: { light: "github-light", dark: "github-dark" },
    config(md) {
      md.use(loomLivePlugin);
    },
  },
  vite: {
    resolve: {
      alias: { "@loom": here("../../src") },
    },
    server: { fs: { allow: [here("../.."), here("..")] } },
    // The playground's appearance helpers live next to the development playground and are reused here.
    build: { chunkSizeWarningLimit: 900 },
  },
});
