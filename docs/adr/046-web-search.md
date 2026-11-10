# ADR-046: web_search asks DuckDuckGo's HTML page first, behind a provider setting

**Date**: 2026-11-10
**Status**: accepted

## Context

golem had no search tool. `web_fetch` reads a page whose address the model already knows. To search, the model scraped Google, and that failed almost every time. The shell has no network. Without the sandbox, `google.com/search` redirects to a consent page in the EU. Following the redirect gives a 92 KB page with no results, because it needs JavaScript. The model then answered from memory, with stale facts.

Google is not an option:

- **Scraping google.com** needs JavaScript to show results, and Google's terms forbid it.
- **Custom Search JSON API** is closed to new customers and shuts down on 2027-01-01.
- **Vertex AI Search** covers about 50 chosen sites, and needs a Cloud project with billing.

On 2026-11-10, `https://html.duckduckgo.com/html/?q=…` answered `200` with 10 results, with no key and no JavaScript.

## Decision

- **The tool** is `web_search`, with `query` (1 to 400 characters) and `max_results` (1 to 20, default 10). It returns numbered results, each with a title, a URL, and a snippet, inside `<web_content>` after a line that says it is data. Its description tells the model to read a result with `web_fetch`.
- **DuckDuckGo first.** The provider sends `POST https://html.duckduckgo.com/html/` with the form field `q`, as DuckDuckGo's own form does, and reads `a.result__a` and `.result__snippet` with the standard library's parser. A result's link is a redirect, `//duckduckgo.com/l/?uddg=<encoded URL>`, and the URL inside it is returned.
- **A provider setting.** `[web] search = "duckduckgo"` is the default. `"off"` leaves the tool out. A provider is one module with `async search(query, n) -> list[Result]`, so a later one (Brave, SearXNG, a SERP API) is one file and one more value.
- **The query goes to a third party.** DuckDuckGo sees the words, and the IP address they come from. The docs say so. The tool asks by default, like `web_fetch`.
- **Policy.** Not read-only, so it asks. The subject is the provider's host, `html.duckduckgo.com`, not the query. One "always allow" rule then covers every search, and a person decides about DuckDuckGo once, not per query.
- **Spacing.** Two searches start at least 5 seconds apart (`MIN_GAP_SECONDS`), because a burst is answered with a challenge. The provider keeps the time of its last request in the process and waits. The wait counts toward `[web] timeout_seconds`.
- **Failures.** No results is a result: `no results for '…'`. HTTP 202, 403, or 429, or a page without the results list, is an error: DuckDuckGo refused the search, too many searches in a short time, wait a minute or answer from what was found. DuckDuckGo answers a client that searches too often with a challenge, so this is expected, not a bug.

## Alternatives Considered

### Alternative 1: The query as the subject

- **Pros**: A person sees exactly what leaves.
- **Cons**: Every search asks again, and "always allow" would cover one query.
- **Why not**: What leaves is the query, but the decision is about the destination.

### Alternative 2: A regular expression on the page

- **Pros**: Fewer lines.
- **Cons**: Breaks on any change in attribute order or quoting.
- **Why not**: The standard library's parser is already used for `web_fetch`.

### Alternative 3: A search API with a key first

- **Pros**: Stable and allowed by its terms.
- **Cons**: Needs an account and a key before the first search.
- **Why not**: Search should work with no setup. Brave and others come as providers later.

## Consequences

### Positive

- The model can search, then read what it found, with no setup.
- A new provider is one module and one setting value.

### Negative

- The query is sent to DuckDuckGo.
- It reads a page made for people, so a markup change breaks it.

### Risks

- DuckDuckGo limits bursts. Measured on 2026-11-10: searches 15 s apart got 200 with 10 results 9 of 9 times, and a burst of 5 back to back got 200 for the first three and a challenge (202) for the 4th and 5th. The 5 s gap helps but does not promise anything. The error tells the model to wait a minute, and a provider with a key is the fix.
- The setting is read when the daemon starts, so changing it needs a restart.
