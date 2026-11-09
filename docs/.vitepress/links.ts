// The docs are written to read well on GitHub, where a relative link can point at any file in
// the repo. On the site only pages exist, so links that leave docs/, or that point at a file the
// site does not publish, go to that file on GitHub instead (ADR-034).

import path from "node:path";

export const REPO_URL = "https://github.com/MilanPavel/golem";
const BLOB = `${REPO_URL}/blob/main/`;
const TREE = `${REPO_URL}/tree/main/`;

/** Files in docs/ that are not pages. Matches `srcExclude` in config.mts. */
export const NOT_PAGES = ["README.md", "adr/template.md", "architecture/_template.md"];

const ASSET = /\.(svg|png|jpe?g|gif|webp|avif|ico|mp4|webm|woff2?)$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Where a link in a page should point on the site.
 *
 * @param href the link as written in the markdown
 * @param page the page's path relative to docs/, such as `adr/024-commits-prs-releases.md`
 * @param from the file the link was written in, relative to docs/: the page itself, or a file the
 *   page includes, such as `../CONTRIBUTING.md`
 * @returns the href to use: unchanged for pages, anchors, assets, and absolute URLs, or a GitHub URL.
 *   A link to a page from an included file is made relative to the page instead.
 */
export function siteHref(href: string, page: string, from: string = page): string {
  if (href === "" || href.startsWith("#") || href.startsWith("/") || SCHEME.test(href)) return href;

  const hashAt = href.indexOf("#");
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  if (target === "" || ASSET.test(target)) return href;

  // A path relative to the repo root, in posix form.
  const fromRoot = path.posix.normalize(path.posix.join("docs", path.posix.dirname(from), target));
  const inDocs = fromRoot.startsWith("docs/");
  const inDocsPath = inDocs ? fromRoot.slice("docs/".length) : "";
  const isPage = inDocs && inDocsPath.endsWith(".md") && !NOT_PAGES.includes(inDocsPath);
  if (isPage) {
    if (from === page) return href;
    return path.posix.relative(path.posix.join("docs", path.posix.dirname(page)), fromRoot) + hash;
  }

  const isFolder = target.endsWith("/") || !path.posix.extname(fromRoot);
  return (isFolder ? TREE : BLOB) + fromRoot.replace(/\/$/, "") + hash;
}

const LINKS_FROM = /^<!--\s*links-from:\s*(\S+)\s*-->$/;

/**
 * `<!--@include:-->` pastes a file as is, so a page that includes a file from elsewhere, such as
 * CONTRIBUTING.md, says where that file's links were written. The path is relative to the page:
 *
 *     <!-- links-from: ../../CONTRIBUTING.md -->
 *     <!--@include: ../../CONTRIBUTING.md-->
 *     <!-- links-from: page -->
 *
 * @param html an html_block's content
 * @param page the page's path relative to docs/
 * @returns the file the next links were written in, relative to docs/, or undefined for other HTML
 */
export function linksFrom(html: string, page: string): string | undefined {
  const match = html.trim().match(LINKS_FROM);
  if (!match) return undefined;
  if (match[1] === "page") return page;
  return path.posix.normalize(path.posix.join(path.posix.dirname(page), match[1]!));
}

/**
 * Raw HTML in a page, such as `<img src="images/map.jpg">`, has bare relative paths that GitHub
 * resolves. Vite bundles an asset only when its path starts with `./` or `../`, so add `./`.
 */
export function bundleHtmlAssets(html: string): string {
  return html.replace(/(<(?:img|source)\b[^>]*?\s(?:src|srcset)=")(?![a-z][a-z0-9+.-]*:|\/|\.|#)/gi, "$1./");
}
