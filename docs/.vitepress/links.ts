// The docs are written to read well on GitHub, where a relative link can point at any file in
// the repo. On the site only pages exist, so links that leave docs/, or that point at a file the
// site does not publish, go to that file on GitHub instead (ADR-034).

import path from "node:path";

export const REPO_URL = "https://github.com/MilanPavel/golem";
const BLOB = `${REPO_URL}/blob/main/`;
const TREE = `${REPO_URL}/tree/main/`;

/** Files in docs/ that are not pages. Matches `srcExclude` in config.mts. */
export const NOT_PAGES = ["README.md", "adr/template.md", "concepts/_template.md", "design/prototype.html"];

const ASSET = /\.(svg|png|jpe?g|gif|webp|avif|ico|mp4|webm|woff2?)$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Where a link in a page should point on the site.
 *
 * @param href the link as written in the markdown
 * @param page the page's path relative to docs/, such as `adr/024-commits-prs-releases.md`
 * @returns the href to use: unchanged for pages, anchors, assets, and absolute URLs, or a GitHub URL
 */
export function siteHref(href: string, page: string): string {
  if (href === "" || href.startsWith("#") || href.startsWith("/") || SCHEME.test(href)) return href;

  const hashAt = href.indexOf("#");
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  if (target === "" || ASSET.test(target)) return href;

  // A path relative to the repo root, in posix form.
  const fromRoot = path.posix.normalize(path.posix.join("docs", path.posix.dirname(page), target));
  const inDocs = fromRoot.startsWith("docs/");
  const inDocsPath = inDocs ? fromRoot.slice("docs/".length) : "";
  const isPage = inDocs && inDocsPath.endsWith(".md") && !NOT_PAGES.includes(inDocsPath);
  if (isPage) return href;

  const isFolder = target.endsWith("/") || !path.posix.extname(fromRoot);
  return (isFolder ? TREE : BLOB) + fromRoot.replace(/\/$/, "") + hash;
}

/**
 * Raw HTML in a page, such as `<img src="images/map.jpg">`, has bare relative paths that GitHub
 * resolves. Vite bundles an asset only when its path starts with `./` or `../`, so add `./`.
 */
export function bundleHtmlAssets(html: string): string {
  return html.replace(/(<(?:img|source)\b[^>]*?\s(?:src|srcset)=")(?![a-z][a-z0-9+.-]*:|\/|\.|#)/gi, "$1./");
}
