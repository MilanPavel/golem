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

import GolemMermaid from "./GolemMermaid.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("GolemMermaid", GolemMermaid);
  },
} satisfies Theme;
