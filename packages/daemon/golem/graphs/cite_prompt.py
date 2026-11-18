"""The system prompt section that tells a model how to cite what it read on the web."""

from __future__ import annotations

from golem.graphs.prompt import PromptContext, Section

CITE_SECTION = "cite_sources"

CITE_TEXT = (
    "When an answer uses facts from web results, cite the page right after the claim as a\n"
    "Markdown link, [Site name](url). Use only URLs that web_search or web_fetch returned in\n"
    "this conversation. Never write a bare URL, and never cite a page you did not get from a tool."
)


def cite_section(context: PromptContext) -> str | None:
    """The text when ``web_search`` or ``web_fetch`` is offered, else None.

    The text is fixed, so it is the same on every call of a session.
    """
    if "web_search" in context.tools or "web_fetch" in context.tools:
        return CITE_TEXT
    return None


CITE_PROMPT = Section(CITE_SECTION, cite_section)

__all__ = ["CITE_PROMPT", "CITE_SECTION", "CITE_TEXT", "cite_section"]
