/**
 * The web pages a turn found or read, for the source chips under and inside an answer.
 *
 * A source comes from a `web_search` hit or a `web_fetch`. Its title and snippet are text from a page,
 * so a client shows them as text, never as markup.
 */

export type ToolSource = {
  url: string;
  title: string;
  snippet: string;
  /** `search` is a hit in search results. `read` is a page golem fetched. */
  kind: "search" | "read";
};

/** A source of the turn: the one that won the merge, and when it arrived (the tool's completion time). */
export type TurnSource = ToolSource & { at?: string };

type WithSources = { sources?: readonly ToolSource[]; sourcesAt?: string };

/**
 * The URL as one key: no fragment, no trailing slash, a lowercase scheme and host.
 * Null for anything that is not an http or https URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "";
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

/**
 * Every source of a turn's tool calls, once per page, in the order first seen. A page that was both
 * a search hit and read is `read`; its title comes from the read, or from the hit when the read had none.
 */
export function turnSources(tools: readonly WithSources[]): TurnSource[] {
  const found = new Map<string, TurnSource>();
  for (const tool of tools) {
    for (const source of tool.sources ?? []) {
      const key = normalizeUrl(source.url);
      if (key === null) continue;
      const earlier = found.get(key);
      const next: TurnSource = { ...source, ...(tool.sourcesAt === undefined ? {} : { at: tool.sourcesAt }) };
      if (earlier === undefined) found.set(key, next);
      else if (earlier.kind === "search" && source.kind === "read") found.set(key, { ...next, title: next.title || earlier.title });
    }
  }
  return [...found.values()];
}

/** The source an href names, or undefined when the turn never found or read that page. */
export function sourceFor(sources: readonly TurnSource[], href: string): TurnSource | undefined {
  const key = normalizeUrl(href);
  if (key === null) return undefined;
  return sources.find((source) => normalizeUrl(source.url) === key);
}

/** The host without `www.`, lower case, or the raw text when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url;
  }
}

/** The host and path without the scheme, such as `arxiv.org/abs/2611.04121`. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${hostOf(url)}${path}`;
  } catch {
    return url;
  }
}

/** The http and https targets of the `[label](url)` links in a Markdown text. */
function linksIn(markdown: string): string[] {
  const urls: string[] = [];
  for (const match of markdown.matchAll(/\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi)) urls.push(match[1] as string);
  return urls;
}

/** How many times the answer links each source, keyed by the source's normalized URL. */
export function citeCounts(sources: readonly TurnSource[], answer: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const key = normalizeUrl(source.url);
    if (key !== null) counts.set(key, 0);
  }
  for (const href of linksIn(answer)) {
    const key = normalizeUrl(href);
    if (key !== null && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The count for one source, from `citeCounts`. */
export function citedTimes(counts: ReadonlyMap<string, number>, source: ToolSource): number {
  const key = normalizeUrl(source.url);
  return key === null ? 0 : (counts.get(key) ?? 0);
}

/**
 * A hue in degrees from the host, the same every time for the same host, for the letter mark.
 * The page picks saturation and lightness for the theme.
 */
export function hostHue(host: string): number {
  let hash = 2166136261;
  for (let i = 0; i < host.length; i += 1) {
    hash ^= host.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

/** The letter of the mark: the first letter or digit of the host, upper case. */
export function hostLetter(host: string): string {
  const letter = host.replace(/^www\./i, "").match(/[a-z0-9]/i)?.[0];
  return (letter ?? "?").toUpperCase();
}
