"""The ``cite_sources`` section: shown only when a web tool is offered, and short."""

from __future__ import annotations

import pytest

from golem.graphs.cite_prompt import CITE_PROMPT, CITE_TEXT, cite_section
from golem.graphs.prompt import PromptContext, SystemPrompt


@pytest.mark.parametrize(
    ("tools", "shown"),
    [
        (("web_search",), True),
        (("web_fetch",), True),
        (("read_file", "web_fetch"), True),
        (("read_file",), False),
        ((), False),
    ],
)
def test_the_section_needs_a_web_tool(tools: tuple[str, ...], shown: bool) -> None:
    context = PromptContext(state={}, tools=tools)
    assert cite_section(context) == (CITE_TEXT if shown else None)


def test_the_text_asks_for_markdown_links_from_tool_urls() -> None:
    assert "[Site name](url)" in CITE_TEXT
    assert "bare URL" in CITE_TEXT
    assert len(CITE_TEXT) < 400


def test_the_section_is_named_in_the_prompt_parts() -> None:
    parts = SystemPrompt(sections=(CITE_PROMPT,)).parts(
        PromptContext(state={}, tools=("web_fetch",))
    )
    assert [name for name, _ in parts] == ["cite_sources"]
