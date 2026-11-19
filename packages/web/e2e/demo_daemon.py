"""The real daemon with a canned web, for the search demo (`just demo-web`).

``web_search`` and ``web_fetch`` reach the network through ``ToolContext.network``, which tests
replace (see ``golem.tools.registry.Network``). The daemon itself never sets it, so this
launcher does, on the one place a tool context is built, and then runs ``golem-daemon serve``
unchanged. A transport answers the search page and three article pages from memory, and a
resolver gives every host a public address, so the guard against private addresses passes.
Nothing leaves the machine, and product code is untouched. The pages are short paraphrases
written for the demo; the addresses are the real ones of the sources they stand for.
"""

from __future__ import annotations

import sys
from typing import Any
from urllib.parse import quote

import httpx

from golem.cli import main
from golem.graphs import tools_node
from golem.tools.registry import Network, ToolContext

SEP = "https://plato.stanford.edu/entries/infinity/"
DELFT = "https://ocw.tudelft.nl/courses/infinity-and-the-foundations-of-mathematics/"
HALMOS = "https://archive.org/details/halmos-naive-set-theory"
NUMBERPHILE = "https://www.youtube.com/watch?v=elvOZm0d4H0"

HITS = [
    (
        "Infinity (Stanford Encyclopedia of Philosophy)",
        SEP,
        "Infinity has puzzled thinkers since antiquity: endless processes, limits, infinite sets.",
    ),
    (
        "Infinity and the foundations of mathematics (TU Delft OpenCourseWare)",
        DELFT,
        "A lecture series on counting the uncountable, from Hilbert's hotel to Cantor's diagonal.",
    ),
    (
        "Naive Set Theory by Paul Halmos (Internet Archive)",
        HALMOS,
        "A short, readable book that builds sets, orders, cardinals and infinity from scratch.",
    ),
    (
        "How big is infinity? (Numberphile)",
        NUMBERPHILE,
        "A friendly video about countable and uncountable infinities, for a first look.",
    ),
]

PAGES = {
    SEP: (
        "Infinity",
        [
            "Infinity is not one idea but several. There is the potential infinite, a process "
            "that can always go on, like counting. There is the actual infinite, a completed "
            "collection such as all the whole numbers. And there is infinity as a limit.",
            "Cantor showed that infinite sets come in different sizes. The even numbers can be "
            "paired with all whole numbers one to one, so they are just as numerous. The real "
            "numbers cannot be listed at all, so there are more of them.",
        ],
    ),
    DELFT: (
        "Infinity and the foundations of mathematics",
        [
            "Lecture 1 opens with Hilbert's hotel: a hotel with infinitely many rooms that is "
            "full, and can still take another guest by moving everyone along one room.",
            "Later lectures prove that the reals cannot be listed with the diagonal argument, "
            "and introduce cardinal numbers as the sizes of sets.",
        ],
    ),
    HALMOS: (
        "Naive Set Theory",
        [
            "Halmos's Naive Set Theory is a short introduction to the language of sets. It "
            "covers functions, orders, and the natural numbers, and ends with cardinal "
            "numbers and the ways infinite sets are compared.",
        ],
    ),
}


def _search_page() -> str:
    rows: list[str] = []
    for title, url, snippet in HITS:
        target = f"//duckduckgo.com/l/?uddg={quote(url, safe='')}&amp;rut=demo"
        rows.append(
            '<div class="result results_links web-result">'
            f'<h2 class="result__title"><a class="result__a" href="{target}">{title}</a></h2>'
            f'<a class="result__snippet" href="{target}">{snippet}</a>'
            "</div>"
        )
    return '<html><body><div id="links" class="results">' + "".join(rows) + "</div></body></html>"


def _article(title: str, paragraphs: list[str]) -> str:
    body = "".join(f"<p>{p}</p>" for p in paragraphs)
    return f"<html><head><title>{title}</title></head><body>{body}</body></html>"


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.host == "html.duckduckgo.com":
        return httpx.Response(200, html=_search_page())
    page = PAGES.get(str(request.url))
    if page is None:
        return httpx.Response(404, html="<html><body>Not found</body></html>")
    return httpx.Response(200, html=_article(*page))


async def _public(_host: str) -> list[str]:
    """Every host is a public address (TEST-NET-3 is not global, so a real one is used)."""
    return ["93.184.216.34"]


CANNED = Network(transport=httpx.MockTransport(_handler), resolve=_public)


def _tool_context(*args: Any, **kwargs: Any) -> ToolContext:
    return ToolContext(*args, **{**kwargs, "network": CANNED})


def run() -> int:
    tools_node.ToolContext = _tool_context  # type: ignore[misc,assignment]
    return main(["serve"])


if __name__ == "__main__":
    sys.exit(run())
