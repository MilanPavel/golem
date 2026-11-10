"""Tools the agent can call. Plain Python: no LangChain or provider types."""

from golem.config import WebSettings
from golem.tools.artifacts import READ_ARTIFACT
from golem.tools.fs import READ_ONLY_TOOLS
from golem.tools.registry import ToolRegistry, ToolSource
from golem.tools.search import WEB_SEARCH
from golem.tools.shell import SHELL_TOOLS
from golem.tools.todos import TODO_WRITE
from golem.tools.web import WEB_FETCH
from golem.tools.write import WRITE_TOOLS


def default_registry(
    source: ToolSource | None = None, web: WebSettings | None = None
) -> ToolRegistry:
    """The tools every agent session gets, plus ``source``'s, such as MCP servers'.

    ``web_search`` is left out when ``web.search`` is ``"off"``.
    """
    search = [] if web is not None and web.search == "off" else [WEB_SEARCH]
    return ToolRegistry(
        [
            *READ_ONLY_TOOLS,
            *WRITE_TOOLS,
            *SHELL_TOOLS,
            WEB_FETCH,
            *search,
            READ_ARTIFACT,
            TODO_WRITE,
        ],
        source,
    )


__all__ = ["default_registry"]
