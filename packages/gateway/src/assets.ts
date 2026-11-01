const HASHED_PREFIX = "/assets/";

/** The key of the file a path asks for: `/` is the page. Nothing else is rewritten. */
export function assetKey(pathname: string): string {
  return pathname === "/" ? "/index.html" : pathname;
}

/** `/index.html` for a page route (its last segment has no dot), so the page's routes reload. */
export function fallbackKey(pathname: string): string | null {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".") ? null : "/index.html";
}

/** Vite's hashed output never changes under its name. Everything else is checked on each load. */
export function assetCacheControl(key: string): string {
  return key.startsWith(HASHED_PREFIX) ? "public, max-age=31536000, immutable" : "no-cache";
}
