"""Tools the agent can call. Plain Python: no LangChain or provider types."""

from golem.tools.artifacts import READ_ARTIFACT
from golem.tools.fs import READ_ONLY_TOOLS
from golem.tools.registry import ToolRegistry
from golem.tools.shell import SHELL_TOOLS
from golem.tools.todos import TODO_WRITE
from golem.tools.web import WEB_FETCH
from golem.tools.write import WRITE_TOOLS


def default_registry() -> ToolRegistry:
    """The tools every agent session gets."""
    return ToolRegistry(
        [*READ_ONLY_TOOLS, *WRITE_TOOLS, *SHELL_TOOLS, WEB_FETCH, READ_ARTIFACT, TODO_WRITE]
    )


__all__ = ["default_registry"]
