import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
// The engine draws with Instrument Sans and IBM Plex Mono (src/theme.ts); the site uses the same faces,
// self-hosted, so the shell and the canvas match and no font is fetched from a third party.
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "./style.css";
import LoomLive from "./components/LoomLive.vue";
import Landing from "./components/Landing.vue";
import Gallery from "./components/Gallery.vue";
import Playground from "./components/Playground.vue";
import EngineDiagram from "./components/EngineDiagram.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("LoomLive", LoomLive);
    app.component("Landing", Landing);
    app.component("Gallery", Gallery);
    app.component("Playground", Playground);
    app.component("EngineDiagram", EngineDiagram);
  },
} satisfies Theme;
