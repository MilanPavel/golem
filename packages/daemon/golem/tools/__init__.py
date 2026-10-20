"""Tools the agent can call. Plain Python: no LangChain or provider types."""

from golem.tools.fs import READ_ONLY_TOOLS
from golem.tools.registry import ToolRegistry
from golem.tools.shell import SHELL_TOOLS
from golem.tools.write import WRITE_TOOLS


def default_registry() -> ToolRegistry:
    """The tools every agent session gets."""
    return ToolRegistry([*READ_ONLY_TOOLS, *WRITE_TOOLS, *SHELL_TOOLS])


__all__ = ["default_registry"]
