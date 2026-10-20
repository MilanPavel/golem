"""HTML to plain text a model reads well: headings, lists, links, and code kept, the rest dropped.

Uses only the standard library's parser. Scripts, styles, and embedded
frames are skipped whole. Links become ``[text](url)`` with ``url`` made
absolute against the page.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urljoin

SKIPPED = frozenset({"script", "style", "noscript", "svg", "iframe", "template", "object"})
TITLE_CHARS = 300
BLOCKS = frozenset(
    {
        "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
        "ul", "ol", "li", "table", "tr", "blockquote", "figure", "figcaption", "form",
        "h1", "h2", "h3", "h4", "h5", "h6", "pre", "dl", "dt", "dd", "hr",
    }
)  # fmt: skip
VOID = frozenset({"br", "hr", "img", "input", "meta", "link", "source", "wbr"})


def html_to_text(html: str, base_url: str) -> tuple[str, str | None]:
    """The page as text, and its ``<title>``."""
    parser = _Parser(base_url)
    parser.feed(_closed_title(html))
    parser.close()
    return parser.text(), parser.title


_TITLE_OPEN = re.compile(r"<title\b[^>]*>[^<]*", re.IGNORECASE)
_TITLE_CLOSE = re.compile(r"</title\s*>", re.IGNORECASE)


def _closed_title(html: str) -> str:
    """``html`` with an unclosed ``<title>`` ended at the next tag.

    From Python 3.13 the parser reads everything after ``<title>`` as its text
    until ``</title>``, so a page that never closes it would lose its body.
    """
    opened = _TITLE_OPEN.search(html)
    if opened is None or _TITLE_CLOSE.search(html, opened.end()) is not None:
        return html
    return f"{html[: opened.end()]}</title>{html[opened.end() :]}"


class _Parser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self._base = base_url
        self._out: list[str] = []
        self._skip = 0
        self._pre = 0
        self._links: list[str | None] = []
        self._in_title = False
        self._title: list[str] = []

    @property
    def title(self) -> str | None:
        title = " ".join("".join(self._title).split())[:TITLE_CHARS]
        return title or None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title" and not self._skip and not self._title:
            self._in_title = True
            return
        self._in_title = False
        if tag in SKIPPED:
            if tag not in VOID:
                self._skip += 1
            return
        if self._skip:
            return
        if tag in BLOCKS or tag == "br":
            self._newline(2 if tag in {"p", "pre", "blockquote", "table"} else 1)
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._out.append("#" * int(tag[1]) + " ")
        elif tag == "li":
            self._out.append("- ")
        elif tag == "pre":
            self._pre += 1
            self._out.append("```\n")
        elif tag == "code" and not self._pre:
            self._out.append("`")
        elif tag == "a":
            href = dict(attrs).get("href")
            self._links.append(urljoin(self._base, href) if href else None)
            self._out.append("[")
        elif tag in {"td", "th"}:
            self._out.append(" | ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
            return
        if tag in SKIPPED:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "pre":
            self._pre = max(0, self._pre - 1)
            self._out.append("\n```")
        elif tag == "code" and not self._pre:
            self._out.append("`")
        elif tag == "a" and self._links:
            href = self._links.pop()
            self._out.append(f"]({href})" if href else "]")
        if tag in BLOCKS and tag != "li":
            self._newline(2 if tag in {"p", "pre", "blockquote", "table"} else 1)

    def handle_data(self, data: str) -> None:
        if self._in_title:
            if sum(map(len, self._title)) < TITLE_CHARS:
                self._title.append(data)
            return
        if self._skip:
            return
        self._out.append(data if self._pre else re.sub(r"\s+", " ", data))

    def _newline(self, count: int) -> None:
        self._out.append("\n" * count)

    def text(self) -> str:
        lines: list[str] = []
        fenced = False
        for line in "".join(self._out).split("\n"):
            if line.strip() == "```":
                fenced = not fenced
                lines.append("```")
            else:
                lines.append(line.rstrip() if fenced else line.strip())
        joined = re.sub(r"\[\s*\]\([^)]*\)", "", "\n".join(lines))
        return re.sub(r"\n{3,}", "\n\n", joined).strip()


__all__ = ["html_to_text"]
