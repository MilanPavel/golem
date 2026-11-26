"""Tools the agent can call. Plain Python: no LangChain or provider types."""

from golem.config import WebSettings
from golem.tools.artifacts import READ_ARTIFACT
from golem.tools.delegate import DELEGATE
from golem.tools.fs import READ_ONLY_TOOLS
from golem.tools.memory import MEMORY_TOOLS
from golem.tools.plan import PROPOSE_PLAN
from golem.tools.registry import ToolRegistry, ToolSource
from golem.tools.search import WEB_SEARCH
from golem.tools.shell import SHELL_TOOLS
from golem.tools.skills import LOAD_SKILL
from golem.tools.todos import TODO_WRITE
from golem.tools.web import WEB_FETCH
from golem.tools.write import WRITE_TOOLS


def default_registry(
    source: ToolSource | None = None, web: WebSettings | None = None
) -> ToolRegistry:
    """The tools every agent session gets, plus ``source``'s, such as MCP servers'.

    ``web_search`` is left out when ``web.search`` is ``"off"``. ``recall`` and ``remember`` are
    offered only to a run that carries memory (see :class:`ToolScope`).
    """
    # Imported here: golem.data.tools imports golem.tools.registry, which runs this package first.
    from golem.data.tools import DATA_TOOLS

    search = [] if web is not None and web.search == "off" else [WEB_SEARCH]
    return ToolRegistry(
        [
            *READ_ONLY_TOOLS,
            *WRITE_TOOLS,
            *SHELL_TOOLS,
            WEB_FETCH,
            *search,
            READ_ARTIFACT,
            DELEGATE,
            TODO_WRITE,
            PROPOSE_PLAN,
            LOAD_SKILL,
            *MEMORY_TOOLS,
            *DATA_TOOLS,
        ],
        source,
    )


__all__ = ["default_registry"]
