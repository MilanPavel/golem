"""Named tools, their argument models, and one way to call them.

A tool takes a Pydantic model of its arguments and a :class:`ToolContext`,
and returns a :class:`ToolResult`. A failure the model should read is a
:class:`ToolError`. The graph turns the registry into provider tool schemas
and calls :meth:`ToolRegistry.call`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

MAX_OUTPUT_CHARS = 100_000
"""What the model receives from one call, at most."""


class ToolError(Exception):
    """A tool call that did not work. The message goes to the model as the result."""


@dataclass(frozen=True, slots=True)
class ToolContext:
    """What a call may touch. ``root`` is the session folder, or None without one."""

    root: Path | None


@dataclass(frozen=True, slots=True)
class ToolResult:
    """``output`` goes to the model. ``summary`` is one short line for the screen."""

    output: str
    summary: str


@dataclass(frozen=True, slots=True)
class Tool[A: BaseModel]:
    """``read_only`` tools change nothing outside golem, so the default policy allows them.

    ``path_arg`` names the argument a rule's ``path`` is matched against, and
    ``match_arg`` the one its ``match`` is.
    """

    name: str
    description: str
    args: type[A]
    run: Callable[[A, ToolContext], Awaitable[ToolResult]]
    read_only: bool = False
    path_arg: str | None = None
    match_arg: str | None = None

    def schema(self) -> dict[str, object]:
        """The OpenAI function format, which every chat model's ``bind_tools`` accepts."""
        parameters = self.args.model_json_schema()
        parameters.pop("title", None)
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": parameters,
            },
        }

    async def call(self, raw: Mapping[str, object], ctx: ToolContext) -> ToolResult:
        try:
            args = self.args.model_validate(dict(raw))
        except ValidationError as exc:
            raise ToolError(f"invalid arguments for {self.name}: {_problems(exc)}") from exc
        return await self.run(args, ctx)


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool[Any]]) -> None:
        self._tools = {tool.name: tool for tool in tools}

    @property
    def names(self) -> list[str]:
        return list(self._tools)

    def get(self, name: str) -> Tool[Any] | None:
        return self._tools.get(name)

    def read_only(self) -> list[str]:
        return [tool.name for tool in self._tools.values() if tool.read_only]

    def schemas(self) -> list[dict[str, object]]:
        return [tool.schema() for tool in self._tools.values()]

    async def call(self, name: str, raw: Mapping[str, object], ctx: ToolContext) -> ToolResult:
        """Validate ``raw`` and run tool ``name``. Raises :class:`ToolError`."""
        tool = self._tools.get(name)
        if tool is None:
            raise ToolError(f"unknown tool {name!r}; the tools are {', '.join(self._tools)}")
        result = await tool.call(raw, ctx)
        if len(result.output) > MAX_OUTPUT_CHARS:
            cut = result.output[:MAX_OUTPUT_CHARS]
            return ToolResult(
                output=f"{cut}\n[output cut at {MAX_OUTPUT_CHARS} characters]",
                summary=result.summary,
            )
        return result


def _problems(exc: ValidationError) -> str:
    parts: list[str] = []
    for error in exc.errors():
        where = ".".join(str(part) for part in error["loc"]) or "arguments"
        parts.append(f"{where}: {error['msg']}")
    return "; ".join(parts)


__all__ = [
    "MAX_OUTPUT_CHARS",
    "Tool",
    "ToolContext",
    "ToolError",
    "ToolRegistry",
    "ToolResult",
]
