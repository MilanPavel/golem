/**
 * The gateway prints a link that ends in `#t=<token>`. The page takes the token out of the
 * address at once, so it is not kept in history or sent anywhere but to `/auth/exchange`.
 * Returns null when there is no token, and removes the whole hash either way.
 */
export function takeLoginToken(loc: Pick<Location, "hash" | "pathname" | "search"> = location, hist: Pick<History, "replaceState"> = history): string | null {
  if (loc.hash === "") {
    return null;
  }
  const token = new URLSearchParams(loc.hash.slice(1)).get("t");
  hist.replaceState(null, "", loc.pathname + loc.search);
  return token === null || token === "" ? null : token;
}

/** Trades the token for the session cookie. True when the gateway accepted it (204). */
export async function exchangeToken(token: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchFn("/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
  return response.status === 204;
}
