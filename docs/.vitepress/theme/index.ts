// golem's look for the docs: the web UI's palette and type on VitePress's default theme
// (docs/design/index.md, ADR-034). The palette comes from tokens.css through config.mts.

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
import HomeDemo from "./HomeDemo.vue";
import HomeLegend from "./HomeLegend.vue";
import HomeWhy from "./HomeWhy.vue";
import NotFound from "./NotFound.vue";
import PixelGolem from "./PixelGolem.vue";
import SystemMap from "./SystemMap.vue";

export default {
  extends: DefaultTheme,
  // The pixel golem is the nav logo and the home page's hero, and the 404 page is one of
  // golem's full-screen states.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-title-before": () => h(PixelGolem, { cell: 3, decorative: true }),
      "home-hero-image": () => h("div", { class: "golem-hero" }, [h(PixelGolem, { cell: 28 })]),
      "not-found": () => h(NotFound),
    }),
  enhanceApp({ app }) {
    app.component("GolemMermaid", GolemMermaid);
    app.component("PixelGolem", PixelGolem);
    app.component("HomeLegend", HomeLegend);
    app.component("HomeWhy", HomeWhy);
    app.component("HomeDemo", HomeDemo);
    app.component("SystemMap", SystemMap);
  },
} satisfies Theme;
