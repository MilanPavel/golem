"""DuckDuckGo's plain HTML page as a search provider. No key, no JavaScript.

``POST https://html.duckduckgo.com/html/`` with the form field ``q``, as DuckDuckGo's own
form does. Two searches start at least :data:`MIN_GAP_SECONDS` apart, because a burst
is answered with a challenge. A result is ``a.result__a``
(title and link) with a ``.result__snippet``. The link is a redirect,
``//duckduckgo.com/l/?uddg=<encoded URL>``, and the address inside it is what
a result gives. A rate limit or a challenge page is a refusal.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx

from golem.tools.registry import ToolError
from golem.tools.search_provider import Result
from golem.tools.web import USER_AGENT

HOST = "html.duckduckgo.com"
URL = f"https://{HOST}/html/"
REFUSED_STATUSES = frozenset({202, 403, 429})
MAX_BYTES = 2_000_000
"""The most of the page that is read."""
MIN_GAP_SECONDS = 5.0
"""The least time between the starts of two searches, in this process."""


class Spacer:
    """Makes calls to :meth:`wait` return at least ``gap`` seconds apart, in the order they came."""

    def __init__(
        self,
        gap: float = MIN_GAP_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._gap = gap
        self._clock = clock
        self._sleep = sleep
        self._last: float | None = None
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            if self._last is not None:
                remaining = self._gap - (self._clock() - self._last)
                if remaining > 0:
                    await self._sleep(remaining)
            self._last = self._clock()


SPACER = Spacer()


class DuckDuckGo:
    def __init__(self, transport: httpx.AsyncBaseTransport | None, timeout: float) -> None:
        self._transport = transport
        self._timeout = timeout
        self._spacer = SPACER

    async def search(self, query: str, n: int) -> list[Result]:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
            "Accept-Encoding": "identity",
        }
        await self._spacer.wait()
        try:
            async with (
                httpx.AsyncClient(
                    transport=self._transport,
                    follow_redirects=False,
                    timeout=self._timeout,
                    headers=headers,
                    trust_env=False,
                ) as client,
                client.stream("POST", URL, data={"q": query}) as response,
            ):
                if response.status_code in REFUSED_STATUSES:
                    raise _refused(f"HTTP {response.status_code}")
                if response.status_code >= 400 or response.is_redirect:
                    raise ToolError(f"DuckDuckGo answered HTTP {response.status_code}")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        del body[MAX_BYTES:]
                        break
                page = body.decode(response.encoding or "utf-8", errors="replace")
        except httpx.HTTPError as exc:
            raise ToolError(f"cannot reach DuckDuckGo: {exc}") from exc
        return _results(page)[:n]


def _refused(why: str) -> ToolError:
    return ToolError(
        f"DuckDuckGo refused the search ({why}): too many searches in a short time. "
        "Wait a minute before searching again, or answer from what you already found."
    )


def _results(page: str) -> list[Result]:
    parser = _Parser()
    parser.feed(page)
    parser.close()
    if not parser.found_results_area:
        raise _refused("the page has no results list, which is how it answers a challenge")
    hits: list[Result] = []
    for entry in parser.entries:
        url = _target(entry.href)
        title = " ".join("".join(entry.title).split())
        if url is None or not title:
            continue
        hits.append(Result(title=title, url=url, snippet=" ".join("".join(entry.snippet).split())))
    return hits


def _target(href: str) -> str | None:
    """The page a result's link leads to: the ``uddg`` address inside DuckDuckGo's redirect."""
    parts = urlsplit(urljoin("https://duckduckgo.com/", href.strip()))
    if parts.hostname in ("duckduckgo.com", "www.duckduckgo.com"):
        if parts.path != "/l/":
            return None
        wrapped = parse_qs(parts.query).get("uddg")
        if not wrapped:
            return None
        parts = urlsplit(wrapped[0])
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return parts.geturl()


class _Entry:
    def __init__(self, *, ad: bool) -> None:
        self.ad = ad
        self.href = ""
        self.title: list[str] = []
        self.snippet: list[str] = []


class _Parser(HTMLParser):
    """Collects each ``div.result`` with its title link and snippet. Ads are left out."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[_Entry] = []
        self.found_results_area = False
        self._current: _Entry | None = None
        self._part: list[str] | None = None
        self._part_tag = ""
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = (values.get("class") or "").split()
        if values.get("id") == "links" or "no-results" in classes:
            self.found_results_area = True
        if tag == "div" and "result" in classes:
            entry = _Entry(ad="result--ad" in classes)
            self._current = entry
            if not entry.ad:
                self.entries.append(entry)
            return
        entry = self._current
        if entry is None:
            return
        if self._part is not None:
            if tag == self._part_tag:
                self._depth += 1
            return
        if tag == "a" and "result__a" in classes and not entry.href:
            entry.href = values.get("href") or ""
            self._open(entry.title, tag)
        elif "result__snippet" in classes and not entry.snippet:
            self._open(entry.snippet, tag)

    def handle_endtag(self, tag: str) -> None:
        if self._part is not None and tag == self._part_tag:
            self._depth -= 1
            if self._depth == 0:
                self._part = None

    def handle_data(self, data: str) -> None:
        if self._part is not None:
            self._part.append(data)

    def _open(self, part: list[str], tag: str) -> None:
        self._part, self._part_tag, self._depth = part, tag, 1


__all__ = ["HOST", "DuckDuckGo"]
