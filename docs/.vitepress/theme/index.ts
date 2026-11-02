// golem's look for the docs: the web UI's palette and type on VitePress's default theme
// (docs/design/web.md, ADR-034). The palette comes from tokens.css through config.mts.

import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";

// Self-hosted, as in the web UI, so no font request leaves the site.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource/silkscreen";

import "virtual:golem-tokens.css";
import "./custom.css";

import { h } from "vue";
import GolemMermaid from "./GolemMermaid.vue";
import NotFound from "./NotFound.vue";
import PixelGolem from "./PixelGolem.vue";

export default {
  extends: DefaultTheme,
  // The pixel golem is the nav logo, and the 404 page is one of golem's full-screen states.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-title-before": () => h(PixelGolem, { cell: 3, decorative: true }),
      "not-found": () => h(NotFound),
    }),
  enhanceApp({ app }) {
    app.component("GolemMermaid", GolemMermaid);
    app.component("PixelGolem", PixelGolem);
  },
} satisfies Theme;
