// The docs site: VitePress over docs/, published to GitHub Pages (ADR-034).
// The side menu follows the map in docs/README.md. golem's look is in theme/ (step 11.3).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { type DefaultTheme, defineConfig } from "vitepress";
import { NOT_PAGES, REPO_URL, bundleHtmlAssets, linksFrom, siteHref } from "./links.ts";
import { golemContainers } from "./containers.ts";
import { faviconHref, markCss } from "./golem.ts";
import { checkTokens, parseTokens, tokensCss } from "./tokens.ts";

const SITE_BASE = "/golem/";
const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The static gallery (`pnpm --filter @golem/web build:gallery`), published at /gallery/.
const galleryDir = path.resolve(docsDir, "../packages/web/dist-gallery");
const tokensFile = path.resolve(docsDir, "../packages/web/src/styles/tokens.css");

/**
 * Serves the web UI's palette to the theme, read from tokens.css on every build and never
 * copied: `virtual:golem-tokens.css` (the --golem-* properties) and `virtual:golem-tokens`
 * (the values, for Mermaid). A token the theme uses but the file lacks fails the build.
 */
function golemTokens(): Plugin {
  const css = "virtual:golem-tokens.css";
  const js = "virtual:golem-tokens";
  const read = () => {
    const palette = parseTokens(fs.readFileSync(tokensFile, "utf8"));
    checkTokens(palette);
    return palette;
  };
  return {
    name: "golem-tokens",
    resolveId(id) {
      if (id === css || id === js) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${css}`) {
        this.addWatchFile(tokensFile);
        const palette = read();
        return `${tokensCss(palette)}\n${markCss(palette)}`;
      }
      if (id === `\0${js}`) {
        this.addWatchFile(tokensFile);
        return `export default ${JSON.stringify(read())};`;
      }
    },
  };
}

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
    items: [
      { text: "Introduction", link: "/guide/introduction" },
      { text: "Install", link: "/install" },
      { text: "First chat", link: "/guide/first-chat" },
    ],
  },
  {
    text: "Use golem",
    items: [
      { text: "Models and API keys", link: "/guide/models" },
      { text: "Commands", link: "/guide/commands" },
      { text: "Tools and permissions", link: "/guide/permissions" },
      { text: "MCP servers", link: "/guide/mcp" },
      { text: "Skills", link: "/guide/skills" },
      { text: "The web UI", link: "/guide/web" },
      { text: "Settings", link: "/guide/settings" },
    ],
  },
  // golem's architecture, one idea per chapter: the idea in agents generally, then golem's
  // version, then its details (docs/architecture/_template.md). Step 11.6 adds the chapters.
  {
    text: "How golem works",
    items: [
      {
        text: "Overview",
        link: "/architecture",
        collapsed: false,
        items: [
          { text: "The agent loop", link: "/architecture/agent-loop" },
          { text: "Talking to models", link: "/architecture/models" },
          { text: "The daemon", link: "/architecture/daemon" },
          { text: "The protocol", link: "/architecture/protocol" },
          { text: "Sessions", link: "/architecture/sessions" },
          { text: "Tools", link: "/architecture/tools" },
          { text: "Permissions", link: "/architecture/permissions" },
          { text: "Sandboxes", link: "/architecture/sandboxes" },
          { text: "Context", link: "/architecture/context" },
          { text: "Skills", link: "/architecture/skills" },
          { text: "MCP", link: "/architecture/mcp" },
          { text: "The terminal app", link: "/architecture/tui" },
          { text: "The web UI", link: "/architecture/web" },
          { text: "Tracing", link: "/architecture/tracing" },
        ],
      },
    ],
  },
  {
    text: "Build golem",
    items: [
      { text: "Hacking on golem", link: "/contributing/hacking" },
      { text: "Contributing", link: "/contributing/" },
      { text: "The monorepo", link: "/monorepo" },
      {
        text: "Build, release, run",
        items: [
          { text: "Building and checking", link: "/ops/build" },
          { text: "Releasing", link: "/ops/release" },
          { text: "Running", link: "/ops/run" },
        ],
      },
    ],
  },
  {
    text: "Design",
    items: [
      { text: "The design system", link: "/design/" },
      { text: "The web UI", link: "/design/web" },
      { text: "The setup window", link: "/design/setup-window" },
      { text: "MCP management", link: "/design/mcp" },
    ],
  },
  {
    text: "Project",
    items: [
      { text: "The vision", link: "/vision" },
      { text: "Roadmap", link: "/roadmap" },
      {
        text: "Decisions (ADRs)",
        link: "/adr/README",
        collapsed: true,
        items: adrItems(),
      },
    ],
  },
];

export default defineConfig({
  title: "golem",
  description: "Your own AI agent, living on your Mac.",
  base: SITE_BASE,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: NOT_PAGES,

  // /gallery/ is not a page: buildEnd copies the gallery build there. Links to it are not dead.
  ignoreDeadLinks: [/^\/gallery\//],

  // The gallery is its own static page with its own bundle, so it is copied in, not built by VitePress.
  buildEnd(siteConfig) {
    if (!fs.existsSync(path.join(galleryDir, "index.html")) && !fs.existsSync(path.join(galleryDir, "gallery.html"))) {
      throw new Error(`The gallery is not built: ${galleryDir} is empty. Run \`just gallery-build\`.`);
    }
    const target = path.join(siteConfig.outDir, "gallery");
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(galleryDir, target, { recursive: true });
    // Vite names the page after its entry. The site serves a folder's index.html.
    const built = path.join(target, "gallery.html");
    if (fs.existsSync(built)) fs.renameSync(built, path.join(target, "index.html"));
  },

  // The favicon is the pixel golem, drawn from logo.ts in the theme's colours.
  head: [["link", { rel: "icon", type: "image/svg+xml", href: faviconHref(parseTokens(fs.readFileSync(tokensFile, "utf8"))) }]],

  markdown: {
    config(md) {
      // Links that leave docs/ go to GitHub, and bare asset paths in raw HTML are bundled.
      md.core.ruler.after("inline", "golem-links", (state) => {
        // An included file's links resolve from that file, after a links-from marker (links.ts).
        const page: string = state.env.relativePath ?? "";
        let from = page;
        for (const block of state.tokens) {
          if (block.type === "html_block") {
            from = linksFrom(block.content, page) ?? from;
            block.content = bundleHtmlAssets(block.content);
          }
          for (const token of block.children ?? []) {
            if (token.type === "link_open") {
              const href = token.attrGet("href");
              if (href !== null) token.attrSet("href", siteHref(href, page, from));
              // The gallery is a separate static page, not a VitePress page: it gets the site's base,
              // and a target makes the router leave the click to the browser.
              if (href?.startsWith("/gallery/")) {
                token.attrSet("href", `${SITE_BASE}${href.slice(1)}`);
                token.attrSet("target", "_self");
              }
            } else if (token.type === "html_inline") {
              token.content = bundleHtmlAssets(token.content);
            }
          }
        }
      });

      // A ```mermaid block becomes <GolemMermaid>, drawn in golem's palette (theme/).
      const fence = md.renderer.rules.fence!;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!;
        if (token.info.trim() === "mermaid") {
          return `<GolemMermaid code="${encodeURIComponent(token.content)}" />\n`;
        }
        return fence(tokens, idx, options, env, self);
      };

      // ::: shem, ```tablet, ::: concept, and ::: golem (containers.ts).
      golemContainers(md);
    },
  },

  themeConfig: {
    nav: [
      { text: "Install", link: "/install" },
      { text: "Architecture", link: "/architecture" },
      { text: "Decisions", link: "/adr/README" },
    ],
    sidebar,
    socialLinks: [{ icon: "github", link: REPO_URL }],
    search: { provider: "local" },
    editLink: {
      // The Contributing page is CONTRIBUTING.md, included, so its edits go there. The function
      // runs in the browser, so it cannot use REPO_URL.
      pattern: ({ filePath }) => {
        const edit = "https://github.com/MilanPavel/golem/edit/main/";
        return filePath === "contributing/index.md" ? `${edit}CONTRIBUTING.md` : `${edit}docs/${filePath}`;
      },
      text: "Edit this page on GitHub",
    },
    outline: { level: [2, 3] },
  },

  // docs/images is served as is, so the README's images have stable URLs with no copy.
  // Mermaid is one large chunk, loaded only on pages that have a diagram.
  vite: {
    publicDir: path.join(docsDir, "images"),
    build: { chunkSizeWarningLimit: 3000 },
    plugins: [golemTokens()],
  },
});
