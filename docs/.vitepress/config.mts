// The docs site: VitePress over docs/, published to GitHub Pages (ADR-034).
// The side menu follows the map in docs/README.md. golem's own look comes in step 11.3.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DefaultTheme } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { NOT_PAGES, REPO_URL, bundleHtmlAssets, siteHref } from "./links.ts";

const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every ADR, numbered, with the title from its first heading ("# ADR-012: …"). */
function adrItems(): DefaultTheme.SidebarItem[] {
  return fs
    .readdirSync(path.join(docsDir, "adr"))
    .filter((name) => /^\d{3}-.*\.md$/.test(name))
    .sort()
    .map((name) => {
      const heading = fs.readFileSync(path.join(docsDir, "adr", name), "utf8").match(/^# ADR-0*(\d+):\s*(.+)$/m);
      const text = heading ? `${heading[1]}. ${heading[2]}` : name.replace(/\.md$/, "");
      return { text, link: `/adr/${name.replace(/\.md$/, "")}` };
    });
}

const sidebar: DefaultTheme.Sidebar = [
  {
    text: "Get started",
    items: [{ text: "Install", link: "/install" }],
  },
  {
    text: "Build golem",
    items: [
      { text: "Architecture", link: "/architecture" },
      { text: "The monorepo", link: "/monorepo" },
      { text: "Building, releasing, and running", link: "/sre" },
      { text: "The web UI's design", link: "/design/web" },
    ],
  },
  {
    text: "Project",
    items: [
      { text: "The vision", link: "/vision" },
      { text: "The plan", link: "/plan" },
      {
        text: "Decisions (ADRs)",
        link: "/adr/README",
        collapsed: true,
        items: adrItems(),
      },
    ],
  },
];

export default withMermaid({
  title: "golem",
  description: "Your own AI agent, living on your Mac.",
  base: "/golem/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: NOT_PAGES,

  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/golem/logo.svg" }]],

  markdown: {
    config(md) {
      // Links that leave docs/ go to GitHub, and bare asset paths in raw HTML are bundled.
      md.core.ruler.after("inline", "golem-links", (state) => {
        const page: string = state.env.relativePath ?? "";
        for (const block of state.tokens) {
          if (block.type === "html_block") block.content = bundleHtmlAssets(block.content);
          for (const token of block.children ?? []) {
            if (token.type === "link_open") {
              const href = token.attrGet("href");
              if (href !== null) token.attrSet("href", siteHref(href, page));
            } else if (token.type === "html_inline") {
              token.content = bundleHtmlAssets(token.content);
            }
          }
        }
      });
    },
  },

  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Install", link: "/install" },
      { text: "Architecture", link: "/architecture" },
      { text: "Decisions", link: "/adr/README" },
    ],
    sidebar,
    socialLinks: [{ icon: "github", link: REPO_URL }],
    search: { provider: "local" },
    editLink: {
      pattern: `${REPO_URL}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    outline: { level: [2, 3] },
  },

  // docs/images is served as is, so the logo and the favicon have stable URLs with no copy.
  // Mermaid is one large chunk, loaded only on pages that have a diagram.
  vite: { publicDir: path.join(docsDir, "images"), build: { chunkSizeWarningLimit: 3000 } },

  mermaid: {},
});
